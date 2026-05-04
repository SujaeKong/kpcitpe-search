/**
 * Google Drive 해설지 폴더 트리를 자동으로 탐색해
 * data/mappings/explanation-files.json 을 갱신한다.
 *
 * 환경변수:
 *  - GOOGLE_SERVICE_ACCOUNT_JSON : Service Account JSON (문자열) 또는 파일경로
 *  - DRIVE_ROOT_FOLDER_ID         : 해설지 루트 폴더 ID (예: "01. 기출문제 & 모의고사" 폴더 ID)
 *
 * 카테고리 자동 인식 (루트 폴더 자식 폴더명 기반):
 *  - "01. 기출문제"               → 기출
 *  - "03. KPC 모의고사(해설집)"   → 모의 (KPC) — 해설집만 사용
 *  - "04. KPC 합숙"               → 합숙 (KPC)
 *  - 그 외 (모범답안 / JUD / 타학원) — 무시
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { google, drive_v3 } from 'googleapis';

const __filename = url.fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const OUT_FILE = path.join(ROOT, 'data', 'mappings', 'explanation-files.json');

// ===== 인증 =====

function loadCredentials(): unknown {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 필요합니다 (JSON 문자열 또는 파일 경로)');
  }
  // JSON 문자열인지 파일 경로인지 자동 판단
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  if (fs.existsSync(trimmed)) {
    return JSON.parse(fs.readFileSync(trimmed, 'utf8'));
  }
  throw new Error(
    `GOOGLE_SERVICE_ACCOUNT_JSON 값이 JSON도 파일경로도 아닙니다: ${trimmed.slice(0, 80)}...`,
  );
}

function makeDriveClient(): drive_v3.Drive {
  const creds = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds as any,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

// ===== 트리 탐색 =====

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PDF_MIME = 'application/pdf';

async function listChildren(drive: drive_v3.Drive, folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 1000,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name && f.mimeType) {
        // macOS에서 만든 한글 폴더명이 NFD(자모 분리)로 저장되어 있을 수 있어 NFC로 정규화
        out.push({ id: f.id, name: f.name.normalize('NFC').trim(), mimeType: f.mimeType });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/**
 * 폴더 트리에서 PDF만 모음. 깊이 제한(maxDepth)으로 폭주 방지.
 * 자식 폴더가 있는 케이스(예: 120회 합숙)도 한 단계 더 들어가서 PDF 발견.
 */
async function collectPdfs(
  drive: drive_v3.Drive,
  folderId: string,
  maxDepth = 2,
): Promise<DriveFile[]> {
  const result: DriveFile[] = [];
  async function walk(id: string, depth: number) {
    const children = await listChildren(drive, id);
    for (const c of children) {
      if (c.mimeType === PDF_MIME) result.push(c);
      else if (c.mimeType === FOLDER_MIME && depth < maxDepth) {
        await walk(c.id, depth + 1);
      }
    }
  }
  await walk(folderId, 0);
  return result;
}

// ===== 파일명 정규식 파서 =====

interface ExplanationEntry {
  id: string;
  name?: string;
}
interface MappingResult {
  기출: Record<string, Record<string, ExplanationEntry>>;
  합숙: Record<string, Record<string, ExplanationEntry>>;
  모의: Record<string, Record<string, Record<string, ExplanationEntry>>>;
}

const CERT_NORM = (raw: string): '정보관리' | '컴시응' | '공통' | null => {
  if (raw.includes('정보관리')) return '정보관리';
  if (raw.includes('컴시응') || raw.includes('컴퓨터시스템응용')) return '컴시응';
  if (raw === '공통' || raw.includes('공통')) return '공통';
  return null;
};

/**
 * 합숙 파일명 → (sessionKey)
 *  - 'KPC 138회 대비 합숙해설집_1일차_1교시_통합.pdf' → '1일차_1교시'
 *  - 공백/언더스코어 모두 허용
 */
function parseHapsuk(name: string): string | null {
  // 합숙해설집 키워드 + 일차/교시 추출
  if (!name.includes('합숙해설집')) return null;
  const m = name.match(/(\d+)\s*일차[\s_](\d+)\s*교시/);
  if (!m) return null;
  return `${m[1]}일차_${m[2]}교시`;
}

/**
 * 모의 파일명 → (round, session)
 * 신형: '[KPC기술사IMPACT실전모의고사]_제129회_해설집_202604_1교시.pdf'
 * 구형: '1교시해설-제22회(2010년10월)KPC기술사IMPACT실전모의고사_홍성우PE.pdf'
 *
 * 해설집/해설 키워드만 매핑 (모범답안/문제지 제외).
 */
function parseMoui(name: string): { round: string; session: string } | null {
  // 모범답안·문제지·문제 PDF 제외
  if (/모범답안|문제지|문제\s*\.pdf$|^\d+교시문제/.test(name)) return null;
  if (!/해설집|해설/.test(name)) return null;

  // 신형: _해설집_YYYYMM_N교시
  let m = name.match(/_해설집_(\d{4})(\d{2})_(\d+)교시/);
  if (m) return { round: `${m[1]}.${m[2]}`, session: m[3] };

  // 구형: N교시해설-제M회(YYYY년MM월)
  m = name.match(/(\d+)교시해설.*\((\d{4})년(\d{1,2})월\)/);
  if (m) return { round: `${m[2]}.${m[3].padStart(2, '0')}`, session: m[1] };

  return null;
}

/**
 * 기출 파일명 → (session, certScope).
 *
 * 변형이 매우 다양하므로 키워드 기반 일반 매처 사용:
 *  - 교시: 파일명 어디든 `N교시` (모자라면 `N`다음 공백/구분자) 추출
 *  - 종목: 긴 키워드 우선 (컴퓨터시스템응용 > 정보관리 > 공통),
 *          없으면 단어경계로 짧은 키워드 (응용 / 관리)
 *
 * 무시 패턴: 통합본, 기출분석, 동기회 등.
 */
function parseKichul(name: string): {
  session: string;
  certScope: '정보관리' | '컴시응' | '공통';
  isBowan: boolean;
} | null {
  // 종목·교시 단위가 아닌 통합본·분석본은 무시
  if (/_기출풀이\(\d+\)\.pdf$/.test(name)) return null;
  if (/^\d+\.\s+기출분석/.test(name)) return null;
  if (name.includes('동기회')) return null;

  const sessionMatch = name.match(/(\d+)\s*교시/);
  if (!sessionMatch) return null;
  const session = sessionMatch[1];

  let cert: '정보관리' | '컴시응' | '공통' | null = null;
  // 긴 키워드 우선 검사
  if (/컴퓨터시스템응용|시스템응용|컴시응|조직응용/.test(name)) cert = '컴시응';
  else if (/정보관리/.test(name)) cert = '정보관리';
  else if (/공통/.test(name)) cert = '공통';
  // fallback: 단어경계가 있는 짧은 키워드 (관리/응용)
  else if (/(?:^|[\s_\-])응용(?:$|[\s_\-.])/.test(name)) cert = '컴시응';
  else if (/(?:^|[\s_\-])관리(?:$|[\s_\-.])/.test(name)) cert = '정보관리';

  if (!cert) return null;

  return {
    session,
    certScope: cert,
    isBowan: /보완/.test(name),
  };
}

// ===== 폴더명에서 round 추출 =====

/**
 * 합숙/모의 폴더명에서 (YYYY.MM[-N]) 추출.
 * 예: '138회 (2026-02)', '제129회(26년04월)KPC기술사 모의고사 해설집',
 *     '제100회_KPC기술사모의고사_정보처리_모범답안(202205)'
 * 연월이 없으면 null (옛 회차 — 사용자 지시로 매핑 제외).
 */
function extractRoundFromFolderName(name: string): string | null {
  // (YYYY-MM) or (YYYY-MM-N)
  let m = name.match(/\((\d{4})-(\d{1,2})(?:-(\d+))?\)/);
  if (m) {
    const r = `${m[1]}.${m[2].padStart(2, '0')}`;
    return m[3] ? `${r}-${m[3]}` : r;
  }
  // (YY년MM월)
  m = name.match(/\((\d{2})년\s*(\d{1,2})월\)/);
  if (m) return `20${m[1]}.${m[2].padStart(2, '0')}`;
  // (YYYYMM)
  m = name.match(/\((\d{4})(\d{2})\)/);
  if (m) return `${m[1]}.${m[2]}`;
  return null;
}

/** 기출 폴더명에서 회차 추출 (예: '제138회 기출문제 해설집' → '138', '제089회 정보관리기술사' → '89'). */
function extractKichulRoundFromFolderName(name: string): string | null {
  const m = name.match(/제(\d+)회/);
  if (!m) return null;
  return String(parseInt(m[1], 10)); // zero-pad 제거
}

// ===== 카테고리 인식 =====

type Category = '기출' | '모의해설집' | '합숙' | null;

function classifyCategory(folderName: string): Category {
  if (folderName.includes('기출문제') && !folderName.includes('모의')) return '기출';
  if (folderName.includes('해설집') && folderName.includes('모의')) return '모의해설집';
  if (folderName.includes('합숙')) return '합숙';
  return null;
}

// ===== 메인 =====

interface SyncStats {
  기출_매핑: number;
  합숙_매핑: number;
  모의_매핑: number;
  스킵된_폴더: number;
  파싱_실패_파일: number;
}

async function syncMappings(): Promise<{ map: MappingResult; stats: SyncStats }> {
  const drive = makeDriveClient();
  const rootId = process.env.DRIVE_ROOT_FOLDER_ID;
  if (!rootId) throw new Error('DRIVE_ROOT_FOLDER_ID 환경변수 필요');

  const map: MappingResult = { 기출: {}, 합숙: {}, 모의: {} };
  const stats: SyncStats = {
    기출_매핑: 0,
    합숙_매핑: 0,
    모의_매핑: 0,
    스킵된_폴더: 0,
    파싱_실패_파일: 0,
  };

  console.log('▶ Drive 루트 폴더 자식 조회');
  const categoryFolders = await listChildren(drive, rootId);

  for (const cat of categoryFolders) {
    if (cat.mimeType !== FOLDER_MIME) continue;
    const category = classifyCategory(cat.name);
    if (!category) {
      console.log(`  ↪ 스킵: ${cat.name}`);
      continue;
    }
    console.log(`\n[${category}] ${cat.name}`);

    const roundFolders = await listChildren(drive, cat.id);
    for (const rf of roundFolders) {
      if (rf.mimeType !== FOLDER_MIME) continue;

      // 회차 폴더 안 PDF 수집 (자식 폴더 1단계까지 추적)
      const pdfs = await collectPdfs(drive, rf.id, 2);

      if (category === '기출') {
        const round = extractKichulRoundFromFolderName(rf.name);
        if (!round) {
          stats.스킵된_폴더++;
          continue;
        }
        const target = (map.기출[round] ??= {});
        let folderMatched = 0;
        const folderFails: string[] = [];
        for (const f of pdfs) {
          const parsed = parseKichul(f.name);
          if (!parsed) {
            stats.파싱_실패_파일++;
            if (folderFails.length < 2) folderFails.push(f.name);
            continue;
          }
          folderMatched++;
          const key = `${parsed.session}_${parsed.certScope}`;
          const wasEmpty = !target[key];
          // 보완본 우선: 같은 키에 보완본이 들어오면 덮어씀
          if (wasEmpty || parsed.isBowan) {
            target[key] = { id: f.id, name: f.name };
            if (wasEmpty) stats.기출_매핑++;
          }
        }
        // 폴더에 PDF가 있는데 한 건도 매칭 못 했으면 샘플 파일명 출력
        if (folderMatched === 0 && pdfs.length > 0) {
          console.log(`  · [기출 ${rf.name}] 매칭 0/${pdfs.length}, 샘플:`);
          for (const fn of folderFails) console.log(`      ${fn}`);
        }
      } else if (category === '합숙') {
        const round = extractRoundFromFolderName(rf.name);
        if (!round) {
          stats.스킵된_폴더++;
          continue; // 옛 회차 (연월 없음) — 사용자 지시로 제외
        }
        const target = (map.합숙[round] ??= {});
        for (const f of pdfs) {
          const sessionKey = parseHapsuk(f.name);
          if (!sessionKey) {
            stats.파싱_실패_파일++;
            continue;
          }
          if (!target[sessionKey]) {
            target[sessionKey] = { id: f.id, name: f.name };
            stats.합숙_매핑++;
          }
        }
      } else if (category === '모의해설집') {
        // 모의는 폴더명에서 round를 못 알아도 파일명에서 알 수 있음
        for (const f of pdfs) {
          const parsed = parseMoui(f.name);
          if (!parsed) {
            stats.파싱_실패_파일++;
            continue;
          }
          const academy = (map.모의['KPC'] ??= {});
          const round = (academy[parsed.round] ??= {});
          if (!round[parsed.session]) {
            round[parsed.session] = { id: f.id, name: f.name };
            stats.모의_매핑++;
          }
        }
      }
    }
  }

  return { map, stats };
}

function writeOutput(map: MappingResult): void {
  const out = {
    $comment:
      '해설지 PDF의 Google Drive 파일 ID 매핑. Auto-generated by scripts/sync-drive-mappings.ts. 수동 편집 시 다음 sync에 덮어쓰기됨.',
    $generatedAt: new Date().toISOString(),
    기출: map.기출,
    합숙: map.합숙,
    모의: { KPC: map.모의?.KPC ?? {}, ITPE: {} },
    자체: { KPC: {}, ITPE: {} },
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

async function main() {
  const { map, stats } = await syncMappings();
  writeOutput(map);
  console.log('\n━━━━━ Sync 결과 ━━━━━');
  console.log(`  기출  : ${stats.기출_매핑}건`);
  console.log(`  합숙  : ${stats.합숙_매핑}건`);
  console.log(`  모의  : ${stats.모의_매핑}건`);
  console.log(`  스킵 폴더 (회차 정보 없음): ${stats.스킵된_폴더}`);
  console.log(`  파싱 실패 파일: ${stats.파싱_실패_파일}`);
  console.log(`\n✔ ${path.relative(ROOT, OUT_FILE)} 갱신`);
}

main().catch((err) => {
  console.error('Drive sync 실패:', err);
  process.exit(1);
});
