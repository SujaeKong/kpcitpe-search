/**
 * 두 가지 진단:
 *  1) OAuth 사용자가 보는 모든 _split 폴더 위치/내용 출력
 *  2) 다른 형식 PDF 샘플 다수의 페이지 1~2 헤더/본문 덤프 (마커 형식 비교)
 */
import fs from 'node:fs';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function loadSACredentials(): unknown {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON!;
  return raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(raw.trim(), 'utf8'));
}

function makeReadDrive() {
  const auth = new google.auth.GoogleAuth({
    credentials: loadSACredentials() as any,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

function makeWriteDrive() {
  const oauth = new OAuth2Client(
    process.env.GOOGLE_OAUTH_CLIENT_ID!,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
  );
  oauth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN! });
  return google.drive({ version: 'v3', auth: oauth });
}

async function diagnoseSplitFolders(writeDrive: any) {
  console.log('━━━━━ _split 폴더 진단 (OAuth 사용자 시야) ━━━━━');
  const list = await writeDrive.files.list({
    q: `name = '_split' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, parents, owners, createdTime, modifiedTime)',
    pageSize: 50,
  });
  const folders = list.data.files ?? [];
  console.log(`찾은 _split 폴더: ${folders.length}개\n`);

  for (const f of folders) {
    console.log(`■ ${f.name} (id: ${f.id})`);
    console.log(`  parents: ${(f.parents ?? []).join(', ')}`);
    console.log(`  owner: ${(f.owners ?? []).map((o: any) => o.emailAddress).join(', ')}`);
    console.log(`  created: ${f.createdTime}`);
    console.log(`  modified: ${f.modifiedTime}`);

    // 부모 폴더 이름
    for (const pid of f.parents ?? []) {
      try {
        const p = await writeDrive.files.get({ fileId: pid, fields: 'id, name' });
        console.log(`  parent name: "${p.data.name}" (${p.data.id})`);
      } catch (e) {
        console.log(`  parent ${pid}: 조회 실패 — ${(e as Error).message}`);
      }
    }

    // 내부 파일 개수 (재귀 안 함, 직접 자식만)
    let total = 0;
    let pageToken: string | undefined;
    do {
      const sub = await writeDrive.files.list({
        q: `'${f.id}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 100,
        pageToken,
      });
      total += sub.data.files?.length ?? 0;
      pageToken = sub.data.nextPageToken ?? undefined;
    } while (pageToken);
    console.log(`  직접 자식: ${total}개`);

    // 휴지통 파일 (trashed=true 직접 조회)
    let trashedCount = 0;
    pageToken = undefined;
    do {
      const sub = await writeDrive.files.list({
        q: `'${f.id}' in parents and trashed = true`,
        fields: 'nextPageToken, files(id)',
        pageSize: 100,
        pageToken,
      });
      trashedCount += sub.data.files?.length ?? 0;
      pageToken = sub.data.nextPageToken ?? undefined;
    } while (pageToken);
    console.log(`  휴지통: ${trashedCount}개`);
    console.log('');
  }
}

const SAMPLES = [
  { label: '기출 138 컴시응 2교시 (7검출 vs 6문항)', fileId: '1CxygHAGV6U_yrEQgkGJWstDz9qMPHdqP' },
  { label: '기출 138 컴시응 3교시 (7검출 vs 6문항)', fileId: '14RV-yz8KrAIjTzT00TGVCfHPLmFGpe1X' },
];

async function dumpPdfHead(readDrive: any, fileId: string, label: string) {
  console.log(`\n━━━━━ ${label} (${fileId}) ━━━━━`);
  try {
    const res = await readDrive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const buf = Buffer.from(res.data as ArrayBuffer);
    const data = new Uint8Array(buf);
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    console.log(`다운로드: ${buf.length} bytes, 페이지: ${doc.numPages}\n`);

    // 모든 페이지 — "문 제 N." 매칭 위치 보고 + 페이지 시작 200자
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items = tc.items as any[];
      const fullText = items.map((it) => it.str).join(' ');
      const head = fullText.slice(0, 200).replace(/\s+/g, ' ').trim();
      // "문 제 N." 매칭 위치 모두 추출 (페이지 어디든)
      const allMunje: Array<{ pos: number; n: number; context: string }> = [];
      const munjeRe = /문\s*제\s*((?:\d\s*){1,2})\./g;
      let mm: RegExpExecArray | null;
      while ((mm = munjeRe.exec(fullText)) !== null) {
        const numStr = mm[1].replace(/\s/g, '');
        const n = parseInt(numStr, 10);
        if (n >= 1 && n <= 30) {
          const ctx = fullText.slice(Math.max(0, mm.index - 30), mm.index + 80).replace(/\s+/g, ' ');
          allMunje.push({ pos: mm.index, n, context: ctx });
        }
      }

      const viewport = page.getViewport({ scale: 1 });
      const W = viewport.width;
      const H = viewport.height;
      const topItems = items.filter((it) => {
        const y = it.transform?.[5] ?? 0;
        return y > H * 0.9 && it.str?.trim().length > 0;
      });
      const tops = topItems.map((it) => `[${it.str}]`).join('');

      const bottomItems = items.filter((it) => {
        const y = it.transform?.[5] ?? 0;
        return y < H * 0.08 && it.str?.trim().length > 0;
      });
      const bottoms = bottomItems.map((it) => `[${it.str}]`).join('');

      // 다양한 마커 후보 패턴 모두 시도
      const patterns: Array<[string, RegExp]> = [
        ['문제N.', /문\s*제\s*(\d{1,2})\s*\./g],
        ['[N]', /\[\s*(\d{1,2})\s*\]/g],
        ['<N>', /<\s*(\d{1,2})\s*>/g],
        ['Q.N', /Q\s*[\.\-]\s*(\d{1,2})/g],
        ['N번)', /(\d{1,2})\s*번\s*\)/g],
        ['N번.', /(\d{1,2})\s*번\s*[:\.]/g],
        ['(N)', /\((\d{1,2})\)/g],
        ['【N】', /【\s*(\d{1,2})\s*】/g],
        ['N.제목', /(?:^|\n|\s{2,})(\d{1,2})\.\s*[가-힣]{2,}/g],
        ['답)/풀이)', /(?:답|풀이|해설)\s*[\)\]:\.]/g],
        ['※문제N', /※\s*문제\s*(\d{1,2})/g],
      ];
      const hits: string[] = [];
      for (const [tag, re] of patterns) {
        const matches = [...fullText.matchAll(re)].slice(0, 4).map((mm) => `${tag}=${JSON.stringify(mm[0])}`);
        if (matches.length) hits.push(...matches);
      }

      console.log(`━ p${i} (총 ${doc.numPages}p) ━`);
      console.log(`  상단: ${tops || '(없음)'}`);
      console.log(`  본문첫: ${head}`);
      if (allMunje.length > 0) {
        console.log(`  문제마커 ${allMunje.length}개:`);
        for (const mj of allMunje) {
          console.log(`    [pos=${mj.pos}] N=${mj.n}: "${mj.context}"`);
        }
      }
    }
  } catch (err) {
    console.log(`실패: ${(err as Error).message}`);
  }
}

async function main() {
  const readDrive = makeReadDrive();
  for (const s of SAMPLES) {
    await dumpPdfHead(readDrive, s.fileId, s.label);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
