/**
 * 통합 PDF에서 문항별 PDF 분리 + 사용자 Drive 업로드 + 자체검증.
 *
 * 인증 이중화:
 *  - 읽기(통합 PDF 다운로드): GOOGLE_SERVICE_ACCOUNT_JSON
 *  - 쓰기(_split 폴더 생성, 분할 PDF 업로드): GOOGLE_OAUTH_* (refresh_token)
 *    SA는 storage quota = 0이라 업로드 불가 → 사용자 OAuth로 사용자 Drive 할당량 사용.
 *
 * 분할 결과는 사용자 Drive의 SOURCE_ROOT/_split/{종류}/{회차}/ 아래에 업로드.
 * 파일명: {종류}_{회차}_{종목}_{교시}_{문항번호}_{핵심키워드}.pdf
 *
 * 자체검증: 업로드된 분할 PDF를 다시 다운받아 텍스트 추출, 문항번호 일치 확인.
 *
 * 환경변수:
 *  - GOOGLE_SERVICE_ACCOUNT_JSON
 *  - GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN
 *  - DRIVE_ROOT_FOLDER_ID (선택)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PDFDocument } from 'pdf-lib';
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const __filename = url.fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const SOURCE_ROOT_ID = process.env.DRIVE_ROOT_FOLDER_ID ?? '1gKPEW_eVdR086KXwPDZIeUfPvlQp9-rV';
const SPLIT_FOLDER_NAME = '_split';

// ===== 인증 =====

function loadSACredentials(): unknown {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 필요');
  const t = raw.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  if (fs.existsSync(t)) return JSON.parse(fs.readFileSync(t, 'utf8'));
  throw new Error('JSON도 파일경로도 아님');
}

function makeReadDrive() {
  const auth = new google.auth.GoogleAuth({
    credentials: loadSACredentials() as any,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

function makeWriteDrive() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN 필요');
  }
  const oauth = new OAuth2Client(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: oauth });
}

// ===== Drive 헬퍼 =====

async function ensureFolder(drive: any, name: string, parentId: string): Promise<string> {
  const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const list = await drive.files.list({ q, fields: 'files(id, name)' });
  if (list.data.files && list.data.files.length > 0) return list.data.files[0].id!;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });
  return created.data.id!;
}

async function findFileInFolder(
  drive: any,
  name: string,
  parentId: string,
): Promise<{ id: string; name: string } | null> {
  const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  const list = await drive.files.list({ q, fields: 'files(id, name)' });
  const f = list.data.files?.[0];
  return f ? { id: f.id!, name: f.name! } : null;
}

async function listFilesInFolder(
  drive: any,
  parentId: string,
): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  let pageToken: string | undefined;
  do {
    const list = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 100,
      pageToken,
    });
    for (const f of list.data.files ?? []) out.push({ id: f.id!, name: f.name! });
    pageToken = list.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function trashFile(drive: any, fileId: string): Promise<void> {
  await drive.files.update({ fileId, requestBody: { trashed: true } });
}

async function downloadPdf(drive: any, fileId: string): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

async function uploadPdf(
  drive: any,
  buf: Buffer,
  name: string,
  parentId: string,
): Promise<{ id: string; name: string }> {
  const { Readable } = await import('node:stream');
  const stream = Readable.from(buf);
  const created = await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media: { mimeType: 'application/pdf', body: stream },
    fields: 'id, name',
  });
  return { id: created.data.id!, name: created.data.name! };
}

// 누구나 링크 보면 열람 가능하게 설정 (사이트에서 iframe 열기용)
async function makePublic(drive: any, fileId: string): Promise<void> {
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });
}

// ===== 파일명 =====

function sanitizeFilenamePart(s: string, maxLen = 30): string {
  const cleaned = s
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
  return cleaned.slice(0, maxLen) || '_';
}

function extractTopic(title: string): string {
  const abbrevMatch = title.match(/[A-Z][A-Z0-9/-]{1,}/);
  if (abbrevMatch && abbrevMatch[0].length >= 3) {
    return sanitizeFilenamePart(abbrevMatch[0], 30);
  }
  const firstWords = title.split(/[,.\s]+/).slice(0, 3).join(' ');
  return sanitizeFilenamePart(firstWords, 30);
}

function buildFileName(args: {
  sourceType: '기출' | '합숙' | '모의' | '자체';
  round: string;
  certScope: string;
  session: string;
  sessionPart?: string | null;
  questionNumber: number;
  topic: string;
}): string {
  const sessionLabel = args.sessionPart ? `${args.session}_${args.sessionPart}` : args.session;
  return `${args.sourceType}_${args.round}_${args.certScope}_${sessionLabel}_${String(args.questionNumber).padStart(2, '0')}_${args.topic}.pdf`;
}

// ===== PDF 텍스트 페이지별 추출 =====

async function extractPageTexts(buf: Buffer): Promise<string[]> {
  const data = new Uint8Array(buf);
  const loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
  const doc = await loadingTask.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((it: any) => it.str).join(' ');
    out.push(text);
  }
  return out;
}

// ===== 문항 시작 페이지 검출 =====

interface QuestionRange {
  questionNumber: number;
  startPage: number;
  endPage: number;
}

/**
 * 다중 시그널 검출 — KPC 해설지 형식이 시기/작성자별로 다양해서 단일 패턴 불충분.
 *
 * 시그널 우선순위(첫 번째로 ≥3개 문항 검출되는 시그널 채택):
 *  1) munje:        "문 제 N." — 최신 합숙/기출/모의 (138회 합숙, 138회 기출, 129회 모의 등)
 *  2) bracketmunje: "[문제풀이] N." — 87회 등 옛 기출 형식
 *  3) kpc-domain:   "출 제 도 메 인" 키워드 + 페이지 본문 시작에 ") N 제목" — 옛 22회 등 모의
 *
 * 검증 실패(문항 검출 < 3) 시 ranges 빈 배열 반환 → 호출자가 분할 포기, 통합 PDF로 fallback.
 */
interface SignalConfig {
  name: string;
  extractNumbers: (pageText: string) => number[];
  validateSplit: (splitText: string, n: number) => boolean;
}

const SIGNALS: SignalConfig[] = [
  {
    name: 'munje',
    extractNumbers: (text) => {
      const nums: number[] = [];
      const re = /문\s*제\s*(\d{1,2})\s*\./g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 30) nums.push(n);
      }
      return nums;
    },
    validateSplit: (text, n) => new RegExp(`문\\s*제\\s*${n}\\s*\\.`).test(text),
  },
  {
    name: 'bracketmunje',
    extractNumbers: (text) => {
      const nums: number[] = [];
      const re = /\[\s*문\s*제\s*풀\s*이\s*\]\s*(\d{1,2})\s*\./g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 30) nums.push(n);
      }
      return nums;
    },
    validateSplit: (text, n) => new RegExp(`\\[\\s*문\\s*제\\s*풀\\s*이\\s*\\]\\s*${n}\\s*\\.`).test(text),
  },
  {
    name: 'kpc-domain',
    extractNumbers: (text) => {
      if (!/출\s*제\s*도\s*메\s*인/.test(text)) return [];
      const head = text.slice(0, 700);
      // ") N 제목" 또는 ") N M 제목" (10~19는 1과 0~9 사이 공백 변형 가능)
      const m = head.match(/\)\s*(\d)\s*(\d?)\s+[가-힣A-Za-z]/);
      if (!m) return [];
      const numStr = m[1] + (m[2] || '');
      const n = parseInt(numStr, 10);
      if (n >= 1 && n <= 30) return [n];
      return [];
    },
    validateSplit: (text, n) => /출\s*제\s*도\s*메\s*인/.test(text),
  },
];

function detectQuestionRangesWithSignal(pageTexts: string[]): {
  ranges: QuestionRange[];
  signal: string;
} {
  for (const sig of SIGNALS) {
    const startPageOf = new Map<number, number>();
    for (let i = 0; i < pageTexts.length; i++) {
      const nums = sig.extractNumbers(pageTexts[i]);
      for (const n of nums) {
        if (!startPageOf.has(n)) startPageOf.set(n, i + 1);
      }
    }
    if (startPageOf.size >= 3) {
      const sorted = [...startPageOf.entries()].sort((a, b) => a[1] - b[1]);
      const ranges: QuestionRange[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const [num, start] = sorted[i];
        const next = sorted[i + 1];
        const end = next ? next[1] - 1 : pageTexts.length;
        ranges.push({ questionNumber: num, startPage: start, endPage: end });
      }
      return {
        ranges: ranges.sort((a, b) => a.questionNumber - b.questionNumber),
        signal: sig.name,
      };
    }
  }
  return { ranges: [], signal: 'none' };
}

// ===== 페이지 추출 =====

async function extractPagesPdf(buf: Buffer, startPage: number, endPage: number): Promise<Buffer> {
  const src = await PDFDocument.load(buf);
  const dst = await PDFDocument.create();
  const indices: number[] = [];
  for (let i = startPage - 1; i <= endPage - 1; i++) indices.push(i);
  const copied = await dst.copyPages(src, indices);
  for (const p of copied) dst.addPage(p);
  const out = await dst.save();
  return Buffer.from(out);
}

// ===== 메인 — 한 PDF 처리 =====

interface Problem {
  id: string;
  sourceType: string;
  round: string;
  certScope: string;
  session: string;
  sessionPart?: string | null;
  questionNumber: number | null;
  questionLabel: string;
  title: string;
}

interface SplitTask {
  fileId: string;
  fileName: string;
  sourceType: '기출' | '합숙' | '모의' | '자체';
  round: string;
  certScope: '정보관리' | '컴시응' | '공통';
  session: string;
  sessionPart?: string | null;
  problems: Problem[];
}

interface UploadedQuestion {
  questionNumber: number;
  fileId: string;
  fileName: string;
  problemId: string;
  startPage: number;
  endPage: number;
  validated: boolean;
  validationNote?: string;
}

interface SplitResult {
  task: SplitTask;
  ok: boolean;
  uploaded: UploadedQuestion[];
  errors: string[];
  detectedRanges: QuestionRange[];
  detectionSignal: string;
  pageCount: number;
}

async function processSplitTask(
  readDrive: any,
  writeDrive: any,
  task: SplitTask,
  splitRootId: string,
): Promise<SplitResult> {
  const errors: string[] = [];
  let detectedRanges: QuestionRange[] = [];
  let detectionSignal = 'none';
  let pageCount = 0;
  const uploaded: UploadedQuestion[] = [];
  try {
    console.log(`\n▶ ${task.sourceType} ${task.round} ${task.certScope} ${task.session} ${task.sessionPart ?? ''}`);
    console.log(`   파일: ${task.fileName}`);

    const buf = await downloadPdf(readDrive, task.fileId);
    console.log(`   다운로드: ${buf.length} bytes`);

    const pageTexts = await extractPageTexts(buf);
    pageCount = pageTexts.length;
    console.log(`   페이지: ${pageCount}`);

    const detection = detectQuestionRangesWithSignal(pageTexts);
    detectedRanges = detection.ranges;
    detectionSignal = detection.signal;
    console.log(`   시그널: ${detectionSignal}`);
    console.log(`   감지된 문항: ${detectedRanges.length}개 — ${detectedRanges.map((r) => `${r.questionNumber}번:p${r.startPage}-${r.endPage}`).join(', ')}`);

    if (detectedRanges.length === 0) {
      errors.push(`검출 실패 — 어떤 시그널도 ≥3 문항 추출 못 함. 통합 PDF fallback 권장.`);
      return { task, ok: false, uploaded, errors, detectedRanges, detectionSignal, pageCount };
    }

    // 업로드 폴더 — _split/{종류}/{회차}/
    const typeFolderId = await ensureFolder(writeDrive, task.sourceType, splitRootId);
    const roundFolderId = await ensureFolder(writeDrive, task.round, typeFolderId);

    // OVERWRITE=1이면 같은 폴더 내 sessionPart에 해당하는 기존 파일 휴지통으로 이동.
    // 같은 (회차, 종목, 일차, 교시) prefix로만 정리해 다른 교시 파일은 보존.
    if (process.env.OVERWRITE === '1') {
      const sessionLabel = task.sessionPart ? `${task.session}_${task.sessionPart}` : task.session;
      const prefix = `${task.sourceType}_${task.round}_${task.certScope}_${sessionLabel}_`;
      const existing = await listFilesInFolder(writeDrive, roundFolderId);
      const toTrash = existing.filter((f) => f.name.startsWith(prefix));
      for (const f of toTrash) {
        await trashFile(writeDrive, f.id);
      }
      console.log(`   ⌫ OVERWRITE: prefix "${prefix}" 매칭 ${toTrash.length}개 휴지통 이동`);
    }

    // problems와 PDF 내부 문항번호가 다른 경우(87회 등) 대응:
    //   detectedRanges의 questionNumber 정렬 순서 ↔ problems의 questionNumber 정렬 순서로 1:1 매핑.
    //   파일명에는 problems의 questionNumber를 사용 (사이트 매핑이 그 번호로 키 생성).
    const sortedProblems = [...task.problems]
      .filter((p) => typeof p.questionNumber === 'number')
      .sort((a, b) => (a.questionNumber as number) - (b.questionNumber as number));
    const sortedRanges = [...detectedRanges].sort((a, b) => a.startPage - b.startPage);

    if (sortedRanges.length !== sortedProblems.length) {
      errors.push(
        `검출 ${sortedRanges.length}개 ≠ problems ${sortedProblems.length}개 — 매핑 안전하지 않음`,
      );
    }
    const pairCount = Math.min(sortedRanges.length, sortedProblems.length);

    for (let idx = 0; idx < pairCount; idx++) {
      const range = sortedRanges[idx];
      const problem = sortedProblems[idx];
      const topic = extractTopic(problem.title);
      const name = buildFileName({
        sourceType: task.sourceType,
        round: task.round,
        certScope: task.certScope,
        session: task.session,
        sessionPart: task.sessionPart,
        questionNumber: problem.questionNumber as number,
        topic,
      });

      // 이미 존재하면 스킵 (idempotent)
      const existing = await findFileInFolder(writeDrive, name, roundFolderId);
      let uploadedFile: { id: string; name: string };
      if (existing) {
        console.log(`   ↻ ${name} 이미 존재 (${existing.id})`);
        uploadedFile = existing;
      } else {
        const pageBuf = await extractPagesPdf(buf, range.startPage, range.endPage);
        uploadedFile = await uploadPdf(writeDrive, pageBuf, name, roundFolderId);
        await makePublic(writeDrive, uploadedFile.id);
        console.log(`   ✔ ${name} → ${uploadedFile.id} (p${range.startPage}-${range.endPage}, ${pageBuf.length} bytes)`);
      }

      // 자체검증 — 업로드된 분할 PDF에 시그널별 마커가 PDF 내부 번호(range.questionNumber)로 있는지 확인
      let validated = false;
      let validationNote: string | undefined;
      try {
        const verifyBuf = await downloadPdf(writeDrive, uploadedFile.id);
        const verifyTexts = await extractPageTexts(verifyBuf);
        const fullText = verifyTexts.join(' ');
        const sigCfg = SIGNALS.find((s) => s.name === detectionSignal);
        if (sigCfg && sigCfg.validateSplit(fullText, range.questionNumber)) {
          validated = true;
        } else {
          validationNote = `${detectionSignal} 시그널 마커(PDF내부 ${range.questionNumber}번)가 분할 PDF에 없음`;
        }
      } catch (verErr) {
        validationNote = `검증 실패: ${(verErr as Error).message}`;
      }

      uploaded.push({
        questionNumber: problem.questionNumber as number,
        fileId: uploadedFile.id,
        fileName: uploadedFile.name,
        problemId: problem.id,
        startPage: range.startPage,
        endPage: range.endPage,
        validated,
        validationNote,
      });
    }

    return { task, ok: errors.length === 0, uploaded, errors, detectedRanges, detectionSignal, pageCount };
  } catch (err) {
    errors.push((err as Error).message);
    return { task, ok: false, uploaded, errors, detectedRanges, detectionSignal, pageCount };
  }
}

// ===== 진입점 — 첫 테스트: 138회 합숙 1일차 1교시 =====

interface TestSpec {
  fileId: string;
  fileName: string;
  sourceType: '기출' | '합숙' | '모의' | '자체';
  round: string;
  certScope: '정보관리' | '컴시응' | '공통';
  session: string;
  sessionPart?: string | null;
  problemFilter: (p: Problem) => boolean;
}

const TEST_SPECS: TestSpec[] = [
  {
    fileId: '1RAstKItBKBU6Rh-egPgiTHiQuUygQSC1',
    fileName: 'KPC 138회 합숙해설집_1일차_1교시_통합.pdf',
    sourceType: '합숙',
    round: '2026.02',
    certScope: '공통',
    session: '1일차',
    sessionPart: '1교시',
    problemFilter: (p) =>
      p.sourceType === '합숙' &&
      p.round === '2026.02' &&
      p.session === '1일차' &&
      p.sessionPart === '1교시',
  },
  {
    fileId: '1te6VyAxWJeQF72TBVe705ICSqpl5P606',
    fileName: '87회-정보관리 문제풀이집-1교시 v2.0.pdf',
    sourceType: '기출',
    round: '87',
    certScope: '정보관리',
    session: '1',
    sessionPart: null,
    problemFilter: (p) =>
      p.sourceType === '기출' &&
      p.round === '87' &&
      p.certScope === '정보관리' &&
      p.session === '1',
  },
  {
    fileId: '1JeQd7R44XjECeZyOLqgqXETnPTWOBE9u',
    fileName: '1교시해설-제22회(2010년10월)KPC기술사IMPACT실전모의고사.pdf',
    sourceType: '모의',
    round: '2010.10-1',
    certScope: '공통',
    session: '1',
    sessionPart: null,
    problemFilter: (p) =>
      p.sourceType === '모의' &&
      p.round === '2010.10-1' &&
      p.session === '1',
  },
];

async function main() {
  const readDrive = makeReadDrive();
  const writeDrive = makeWriteDrive();

  const splitRootId = await ensureFolder(writeDrive, SPLIT_FOLDER_NAME, SOURCE_ROOT_ID);
  console.log(`_split 폴더: ${splitRootId}`);

  const problemsRaw = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data', 'problems.json'), 'utf8'),
  ) as Problem[];

  const allResults: SplitResult[] = [];
  for (const spec of TEST_SPECS) {
    const problems = problemsRaw.filter(spec.problemFilter);
    console.log(`\n=== ${spec.sourceType} ${spec.round} ${spec.certScope} ${spec.session}${spec.sessionPart ? ` ${spec.sessionPart}` : ''} ===`);
    console.log(`문항: ${problems.length}개`);
    if (problems.length === 0) {
      console.log('⚠ problems.json에 매칭 없음, 스킵');
      continue;
    }

    const task: SplitTask = {
      fileId: spec.fileId,
      fileName: spec.fileName,
      sourceType: spec.sourceType,
      round: spec.round,
      certScope: spec.certScope,
      session: spec.session,
      sessionPart: spec.sessionPart,
      problems,
    };
    const result = await processSplitTask(readDrive, writeDrive, task, splitRootId);
    allResults.push(result);

    console.log(`결과: signal=${result.detectionSignal}, 검출=${result.detectedRanges.length}, 업로드=${result.uploaded.length}, 검증OK=${result.uploaded.filter((u) => u.validated).length}`);
    if (result.errors.length > 0) {
      console.log('에러:');
      for (const e of result.errors) console.log(`  - ${e}`);
    }
    console.log('자체검증:');
    for (const u of result.uploaded) {
      const flag = u.validated ? '✔' : '✘';
      console.log(`  ${flag} ${u.questionNumber}번 → p${u.startPage}-${u.endPage} ${u.fileName}${u.validationNote ? ` [${u.validationNote}]` : ''}`);
    }
  }

  fs.mkdirSync(path.join(ROOT, 'tmp-split'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'tmp-split', 'split-result.json'),
    JSON.stringify(allResults, null, 2),
    'utf8',
  );
  console.log(`\n━━━━━ 최종 ━━━━━`);
  for (const r of allResults) {
    const valid = r.uploaded.filter((u) => u.validated).length;
    console.log(`${r.task.sourceType} ${r.task.round}: ${r.detectedRanges.length}검출 / ${r.uploaded.length}업로드 / ${valid}검증OK / signal=${r.detectionSignal}`);
  }
  console.log('✔ tmp-split/split-result.json 저장');
}

main().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
