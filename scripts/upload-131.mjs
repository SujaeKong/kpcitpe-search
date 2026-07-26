/**
 * 131회 모의 해설지 4개(1~4교시)를 Drive에 업로드 + refresh token 발급 (일회성).
 *
 * 한 번의 실행 = 한 번의 브라우저 동의로:
 *   1) OAuth refresh token 발급 (loopback 127.0.0.1 플로우, drive.file 스코프)
 *   2) '03. KPC 모의고사(해설집)' 아래 '제131회(26년07월)KPC기술사 모의고사 해설집' 폴더 생성
 *   3) 로컬 해설지 PDF 4개를 업로드 — 단, 파일명의 "해설지"→"해설집"으로 정규화해서 올림
 *      (sync-drive-mappings.ts parseMoui 패턴 A가 '_해설집_YYYYMM_N교시'만 인식하기 때문)
 *   4) fileId 4개 + refresh token 출력
 *
 * client_id/secret은 .secrets/client_secret_pdf_uploader.json에서 자동 로드.
 * 사용:  node scripts/upload-131.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── client credentials ──
const secretPath = path.join(ROOT, '.secrets', 'client_secret_pdf_uploader.json');
const secretJson = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
const cfg = secretJson.web ?? secretJson.installed;
const CLIENT_ID = cfg.client_id;
const CLIENT_SECRET = cfg.client_secret;

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

// ── 업로드 대상 ──
const MOUI_ROOT_ID = '1bFJHC87wVLKgQDnYOB-AsXb5yMD1m6Cg'; // 03. KPC 모의고사(해설집)
const FOLDER_NAME = '제131회(26년07월)KPC기술사 모의고사 해설집';
const DL = '/Users/sujaekong/Downloads';
const SESSIONS = [1, 2, 3, 4];
const FILES = SESSIONS.map((s) => ({
  localPath: `${DL}/[KPC기술사IMPACT실전모의고사]_제131회_해설지_202607_${s}교시.pdf`,
  // Drive 제목: 해설지 → 해설집 (parseMoui 패턴 A 매칭)
  driveTitle: `[KPC기술사IMPACT실전모의고사]_제131회_해설집_202607_${s}교시.pdf`,
  session: s,
}));

for (const f of FILES) {
  if (!fs.existsSync(f.localPath)) throw new Error(`로컬 파일 없음: ${f.localPath}`);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
    }),
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
  const q = encodeURIComponent(
    `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const list = await driveGet(token, `${api}/files?q=${q}&fields=files(id,name)&supportsAllDrives=true`);
  if (list.files?.length) return list.files[0].id;
  const r = await fetch(`${api}/files?fields=id&supportsAllDrives=true`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!r.ok) throw new Error(`폴더 생성 실패 ${r.status}: ${await r.text()}`);
  return (await r.json()).id;
}

async function findFile(token, name, parentId) {
  const q = encodeURIComponent(
    `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`,
  );
  const list = await driveGet(token, `${api}/files?q=${q}&fields=files(id,name)&supportsAllDrives=true`);
  return list.files?.[0] ?? null;
}

async function uploadFile(token, localPath, title, parentId) {
  const existing = await findFile(token, title, parentId);
  if (existing) return { id: existing.id, name: existing.name, skipped: true };
  const meta = JSON.stringify({ name: title, parents: [parentId] });
  const body = fs.readFileSync(localPath);
  const boundary = 'kpc131boundary' + Date.now();
  const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const post = `\r\n--${boundary}--`;
  const payload = Buffer.concat([Buffer.from(pre, 'utf8'), body, Buffer.from(post, 'utf8')]);
  const r = await fetch(`${upl}/files?uploadType=multipart&fields=id,name&supportsAllDrives=true`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body: payload,
  });
  if (!r.ok) throw new Error(`업로드 실패(${title}) ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { id: j.id, name: j.name, skipped: false };
}

async function doWork(tokens) {
  const token = tokens.access_token;
  const folderId = await ensureFolder(token, FOLDER_NAME, MOUI_ROOT_ID);
  console.log(`\n📁 폴더: "${FOLDER_NAME}" (${folderId})`);
  const out = [];
  for (const f of FILES) {
    const res = await uploadFile(token, f.localPath, f.driveTitle, folderId);
    console.log(`  ${res.skipped ? '↻ 이미존재' : '✔ 업로드'} [${f.session}교시] ${res.name} → ${res.id}`);
    out.push({ session: f.session, fileId: res.id, fileName: res.name });
  }

  console.log('\n========================================');
  console.log('✅ 업로드 완료 — 아래 정보를 Claude에게 그대로 붙여넣으세요');
  console.log('========================================');
  console.log('FOLDER_ID=' + folderId);
  for (const o of out) console.log(`SESSION_${o.session}=${o.fileId}`);
  console.log('REFRESH_TOKEN=' + (tokens.refresh_token || '(없음 — 이미 동의한 앱이면 미발급)'));
  console.log('========================================');
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, REDIRECT_URI);
  const code = reqUrl.searchParams.get('code');
  const err = reqUrl.searchParams.get('error');
  if (err) {
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h2>동의 거부/오류: ${err}</h2>`);
    console.error('\n❌ 동의 거부/오류:', err);
    server.close(); process.exit(1);
  }
  if (!code) { res.writeHead(400); res.end('code 없음'); return; }
  try {
    const tokens = await exchangeCode(code);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h2>✅ 완료</h2><p>터미널로 돌아가세요. 업로드가 진행됩니다.</p>');
    await doWork(tokens);
    server.close(); process.exit(0);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h2>오류</h2><pre>${(e && e.message) || e}</pre>`);
    console.error('\n❌', (e && e.message) || e);
    server.close(); process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('브라우저로 Google 동의 화면을 엽니다... (열리지 않으면 아래 URL 직접 접속)\n');
  console.log(authUrl + '\n');
  openBrowser(authUrl);
});
