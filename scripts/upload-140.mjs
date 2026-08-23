/**
 * 140회 대비 합숙 해설지 6개(1~3일차 × 1~2교시)를 Drive에 업로드 + refresh token 발급 (일회성).
 *
 * 한 번의 브라우저 동의로:
 *   1) OAuth refresh token 발급 (loopback 127.0.0.1, drive.file)
 *   2) '04. KPC 합숙' 아래 '140회 (2026-08)' 폴더 생성
 *      (sync가 폴더명 (2026-08) → round '2026.08' 추출)
 *   3) 로컬 합숙 해설지 6개 업로드 — 파일명을 138 규약으로 정규화:
 *      'N일차 합숙해설집_M교시_통합.pdf' → 'KPC 140회 대비 합숙해설집_N일차_M교시_통합.pdf'
 *      (parseHapsuk 정규식 `N일차<sep>M교시`가 인접해야 매칭)
 *   4) fileId 6개 + refresh token 출력
 *
 * 사용:  node scripts/upload-140.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const secretPath = path.join(ROOT, '.secrets', 'client_secret_pdf_uploader.json');
const cfg = (JSON.parse(fs.readFileSync(secretPath, 'utf8')).web) ?? {};
const CLIENT_ID = cfg.client_id;
const CLIENT_SECRET = cfg.client_secret;

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

const HAPSUK_ROOT_ID = '1ZzSqSJpXvHaXuufIfV1WyhvXu8x1v2ey'; // 04. KPC 합숙
const FOLDER_NAME = '140회 (2026-08)';
const DL = '/Users/sujaekong/Downloads';
const FILES = [];
for (const day of [1, 2, 3]) {
  for (const kyo of [1, 2]) {
    FILES.push({
      localPath: `${DL}/${day}일차 합숙해설집_${kyo}교시_통합.pdf`,
      driveTitle: `KPC 140회 대비 합숙해설집_${day}일차_${kyo}교시_통합.pdf`,
      day, kyo,
    });
  }
}
for (const f of FILES) if (!fs.existsSync(f.localPath)) throw new Error(`로컬 파일 없음: ${f.localPath}`);

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent',
  });

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
  });
  if (!res.ok) throw new Error(`토큰 교환 실패 ${res.status}: ${await res.text()}`);
  return res.json();
}

const api = 'https://www.googleapis.com/drive/v3';
const upl = 'https://www.googleapis.com/upload/drive/v3';
async function driveGet(token, url) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}: ${await r.text()}`);
  return r.json();
}
async function ensureFolder(token, name, parentId) {
  const q = encodeURIComponent(`'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const list = await driveGet(token, `${api}/files?q=${q}&fields=files(id,name)&supportsAllDrives=true`);
  if (list.files?.length) return list.files[0].id;
  const r = await fetch(`${api}/files?fields=id&supportsAllDrives=true`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!r.ok) throw new Error(`폴더 생성 실패 ${r.status}: ${await r.text()}`);
  return (await r.json()).id;
}
async function findFile(token, name, parentId) {
  const q = encodeURIComponent(`'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`);
  const list = await driveGet(token, `${api}/files?q=${q}&fields=files(id,name)&supportsAllDrives=true`);
  return list.files?.[0] ?? null;
}
async function uploadFile(token, localPath, title, parentId) {
  const existing = await findFile(token, title, parentId);
  if (existing) return { id: existing.id, name: existing.name, skipped: true };
  const meta = JSON.stringify({ name: title, parents: [parentId] });
  const body = fs.readFileSync(localPath);
  const boundary = 'kpc140boundary' + Date.now();
  const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const post = `\r\n--${boundary}--`;
  const payload = Buffer.concat([Buffer.from(pre, 'utf8'), body, Buffer.from(post, 'utf8')]);
  // 대용량(6~7MB) 업로드 간헐 실패 대비 3회 재시도
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${upl}/files?uploadType=multipart&fields=id,name&supportsAllDrives=true`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` }, body: payload,
      });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      const j = await r.json();
      return { id: j.id, name: j.name, skipped: false };
    } catch (e) {
      lastErr = e;
      console.log(`   ⚠ 업로드 재시도 ${attempt}/3 (${title}): ${e.message || e}`);
      await new Promise((res) => setTimeout(res, 1500 * attempt));
    }
  }
  throw new Error(`업로드 최종 실패(${title}): ${lastErr?.message || lastErr}`);
}

async function doWork(tokens) {
  // refresh token을 먼저 출력 (이후 업로드가 실패해도 토큰은 확보)
  console.log('\nREFRESH_TOKEN=' + (tokens.refresh_token || '(없음)'));
  const token = tokens.access_token;
  const folderId = await ensureFolder(token, FOLDER_NAME, HAPSUK_ROOT_ID);
  console.log(`📁 폴더: "${FOLDER_NAME}" (${folderId})`);
  const out = [];
  for (const f of FILES) {
    const res = await uploadFile(token, f.localPath, f.driveTitle, folderId);
    console.log(`  ${res.skipped ? '↻ 이미존재' : '✔ 업로드'} [${f.day}일차 ${f.kyo}교시] ${res.name} → ${res.id}`);
    out.push({ key: `${f.day}일차_${f.kyo}교시`, fileId: res.id });
  }
  console.log('\n========================================');
  console.log('✅ 업로드 완료 — 아래 정보를 Claude에게 그대로 붙여넣으세요');
  console.log('========================================');
  console.log('FOLDER_ID=' + folderId);
  for (const o of out) console.log(`${o.key}=${o.fileId}`);
  console.log('REFRESH_TOKEN=' + (tokens.refresh_token || '(없음)'));
  console.log('========================================');
}

// 콜백 code를 받으면 즉시 브라우저에 응답하고 서버를 닫은 뒤, 업로드는 그 다음에 수행.
function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, REDIRECT_URI);
      if (reqUrl.pathname !== '/') { res.writeHead(204); res.end(); return; } // favicon 등 무시
      const code = reqUrl.searchParams.get('code');
      const err = reqUrl.searchParams.get('error');
      res.writeHead(err ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(err ? `<h2>동의 오류: ${err}</h2>` : '<h2>✅ 완료</h2><p>터미널로 돌아가세요. 업로드가 진행됩니다.</p>');
      server.close();
      if (err) reject(new Error(`동의 오류: ${err}`));
      else if (!code) reject(new Error('code 없음'));
      else resolve(code);
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log('브라우저로 Google 동의 화면을 엽니다...\n' + authUrl + '\n');
      openBrowser(authUrl);
    });
  });
}

(async () => {
  try {
    const code = await waitForCode();
    const tokens = await exchangeCode(code);
    await doWork(tokens);
    process.exit(0);
  } catch (e) {
    console.error('\n❌', (e && e.message) || e);
    process.exit(1);
  }
})();
