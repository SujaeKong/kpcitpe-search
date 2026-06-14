/**
 * OAuth refresh token 재발급 헬퍼 (데스크톱 클라이언트용 로컬 루프백 플로우).
 *
 * 의존성 없음 — Node 20+ 내장 http + fetch만 사용. 프로젝트 밖에서도 실행 가능.
 *
 * 사용법:
 *   node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
 *   # 또는 환경변수로
 *   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/get-refresh-token.mjs
 *
 * 동작: 로컬 서버를 띄우고 브라우저로 Google 동의 화면을 연다 →
 *       동의하면 refresh token을 출력하고, GitHub 시크릿 갱신 명령을 안내한다.
 *
 * scope: drive.file (split-pdfs 업로드 + /api/explanation 읽기에 충분)
 * 데스크톱 클라이언트는 loopback(127.0.0.1) redirect를 자동 허용하므로
 * Console에서 redirect URI를 따로 등록할 필요가 없다.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { URL, URLSearchParams } from 'node:url';

const CLIENT_ID = process.argv[2] || process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.argv[3] || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PORT = 53682; // 임의의 고정 loopback 포트

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('사용법: node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>');
  console.error('(Google Cloud Console → Google Auth Platform → Clients 탭에서 복사)');
  process.exit(1);
}

const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // 매번 새 refresh token을 강제로 발급
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
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`토큰 교환 실패 ${res.status}: ${await res.text()}`);
  return res.json();
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, REDIRECT_URI);
  const code = reqUrl.searchParams.get('code');
  const err = reqUrl.searchParams.get('error');

  if (err) {
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h2>동의 거부/오류: ${err}</h2><p>터미널로 돌아가세요.</p>`);
    console.error('\n❌ 동의 거부 또는 오류:', err);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400);
    res.end('code 없음');
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h2>✅ 완료</h2><p>터미널에 refresh token이 출력되었습니다. 이 창은 닫으셔도 됩니다.</p>');

    if (!tokens.refresh_token) {
      console.error(
        '\n⚠️ refresh_token이 응답에 없습니다. (이미 동의한 적이 있으면 발급 안 될 수 있음)\n' +
          '   해결: https://myaccount.google.com/permissions 에서 이 앱 액세스 제거 후 재실행.',
      );
      server.close();
      process.exit(1);
    }

    // 자기검증 — 이 클라이언트로 실제 kpcitpe 해설지 파일을 읽을 수 있는지 확인.
    // drive.file 스코프는 "이 앱(클라이언트)이 만든 파일"만 접근 가능하므로,
    // 파일을 만든 원래 클라이언트가 아니면 404가 난다.
    const SAMPLE_FILE_ID = '1v3YKvlPdB3BykjHtRhj76gXWZterTPk8'; // 기출_87_컴시응_1_01
    let verifyMsg = '';
    try {
      const vr = await fetch(
        `https://www.googleapis.com/drive/v3/files/${SAMPLE_FILE_ID}?fields=id,name&supportsAllDrives=true`,
        { headers: { authorization: `Bearer ${tokens.access_token}` } },
      );
      if (vr.ok) {
        const f = await vr.json();
        verifyMsg = `✅ 검증 통과 — 이 클라이언트로 해설지 파일 읽기 성공 ("${f.name}").\n   → 올바른 클라이언트입니다.`;
      } else {
        verifyMsg =
          `⚠️ 검증 실패 (${vr.status}) — 이 클라이언트로는 kpcitpe 해설지 파일을 못 읽습니다.\n` +
          '   drive.file은 "그 파일을 만든 클라이언트"만 접근 가능하므로,\n' +
          '   GitHub 시크릿에 들어있던 원래 OAuth 클라이언트로 다시 실행하세요.';
      }
    } catch {
      verifyMsg = '⚠️ 검증 요청 중 네트워크 오류 (토큰 자체는 발급됨).';
    }

    console.log('\n========================================');
    console.log('✅ REFRESH TOKEN 발급 완료');
    console.log('========================================');
    console.log(tokens.refresh_token);
    console.log('========================================');
    console.log('\n' + verifyMsg);
    console.log('\n검증 통과 시, 다음 명령으로 GitHub 시크릿을 갱신하세요 (repo 디렉토리에서):\n');
    console.log(`  printf '%s' '${tokens.refresh_token}' | gh secret set GOOGLE_OAUTH_REFRESH_TOKEN\n`);
    console.log('갱신 후 알려주시면 서버 프록시 재활성화 + 비공개화를 진행합니다.');
    server.close();
    process.exit(0);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h2>오류</h2><pre>${(e && e.message) || e}</pre>`);
    console.error('\n❌', (e && e.message) || e);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('브라우저로 Google 동의 화면을 엽니다...');
  console.log('열리지 않으면 아래 URL을 직접 붙여넣으세요:\n');
  console.log(authUrl + '\n');
  openBrowser(authUrl);
});
