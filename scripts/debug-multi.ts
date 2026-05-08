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
  { label: '기출 87회 1교시 정보관리 (옛, 13문항/47p)', fileId: '1te6VyAxWJeQF72TBVe705ICSqpl5P606' },
  { label: '모의 2010.10 1교시 (옛, 13문항/35p)', fileId: '1JeQd7R44XjECeZyOLqgqXETnPTWOBE9u' },
];

async function dumpPdfHead(readDrive: any, fileId: string, label: string) {
  console.log(`\n━━━━━ ${label} (${fileId}) ━━━━━`);
  try {
    const res = await readDrive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const buf = Buffer.from(res.data as ArrayBuffer);
    const data = new Uint8Array(buf);
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    console.log(`다운로드: ${buf.length} bytes, 페이지: ${doc.numPages}\n`);

    // 풀이부 깊이 분석 위해 모든 페이지 덤프 (각 600자)
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items = tc.items as any[];
      const fullText = items.map((it) => it.str).join(' ');
      const head = fullText.slice(0, 500).replace(/\s+/g, ' ').trim();

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

      console.log(`━ p${i} ━`);
      console.log(`  상단: ${tops || '(없음)'}`);
      console.log(`  하단: ${bottoms || '(없음)'}`);
      console.log(`  본문첫: ${head}`);
      console.log(`  마커: ${hits.length ? hits.slice(0, 10).join(' / ') : '(없음)'}`);
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
