/**
 * 디버그용 — 통합 PDF 페이지별 텍스트 첫/끝 부분 출력.
 * 분할 검출 알고리즘의 진짜 시그널 식별을 위해 사용.
 *
 * 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { google } from 'googleapis';
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const __filename = url.fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

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

async function main() {
  const drive = makeReadDrive();
  const fileId = '1RAstKItBKBU6Rh-egPgiTHiQuUygQSC1';
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  const buf = Buffer.from(res.data as ArrayBuffer);
  console.log(`다운로드: ${buf.length} bytes`);

  const data = new Uint8Array(buf);
  const loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
  const doc = await loadingTask.promise;
  console.log(`페이지: ${doc.numPages}\n`);

  // 페이지별 첫 250자 + 끝 150자 + 텍스트 아이템들의 좌표 (특히 모서리 영역)
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const texts = tc.items as any[];
    const fullText = texts.map((it) => it.str).join(' ');
    const head = fullText.slice(0, 250).replace(/\s+/g, ' ').trim();
    const tail = fullText.slice(-200).replace(/\s+/g, ' ').trim();

    // 우측 하단 영역 추출 — viewport 크기 기반
    const viewport = page.getViewport({ scale: 1 });
    const W = viewport.width;
    const H = viewport.height;
    const cornerItems = texts.filter((it) => {
      const x = it.transform?.[4] ?? 0;
      const y = it.transform?.[5] ?? 0;
      // 우측 하단 1/4 영역 (페이지 번호가 있을 위치)
      return x > W * 0.6 && y < H * 0.15 && it.str?.trim().length > 0;
    });
    const corners = cornerItems.map((it) => `[${it.str}]`).join('');

    // 좌측 하단도 확인 (간혹 좌측에 있음)
    const leftCornerItems = texts.filter((it) => {
      const x = it.transform?.[4] ?? 0;
      const y = it.transform?.[5] ?? 0;
      return x < W * 0.4 && y < H * 0.15 && it.str?.trim().length > 0;
    });
    const lcorners = leftCornerItems.map((it) => `[${it.str}]`).join('');

    // 상단 (헤더 영역)
    const topItems = texts.filter((it) => {
      const y = it.transform?.[5] ?? 0;
      return y > H * 0.9 && it.str?.trim().length > 0;
    });
    const tops = topItems.map((it) => `[${it.str}]`).join('');

    console.log(`━━ 페이지 ${i} (${W}×${H}) ━━`);
    console.log(`  상단: ${tops || '(없음)'}`);
    console.log(`  좌측하단: ${lcorners || '(없음)'}`);
    console.log(`  우측하단: ${corners || '(없음)'}`);
    console.log(`  본문첫: ${head}`);
    console.log(`  본문끝: ...${tail}`);
    console.log('');
  }

  fs.mkdirSync(path.join(ROOT, 'tmp-split'), { recursive: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
