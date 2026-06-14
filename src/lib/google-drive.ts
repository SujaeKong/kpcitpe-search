/**
 * Cloudflare Worker 런타임에서 비공개 Google Drive 파일을 읽기 위한 헬퍼.
 *
 * OAuth Delegation refresh_token → access_token 교환만 하면 되므로(서비스계정 RS256
 * 서명 불필요), Worker에서 fetch 한 번으로 구현 가능. 이 토큰은 split-pdfs.ts가
 * 해설지 PDF를 업로드할 때 쓴 것과 동일한 신원이라, Drive를 완전 비공개로 바꿔도
 * 소유자 자격으로 읽을 수 있음. 스코프가 drive.file이라 "앱이 만든 파일"
 * (= 우리 해설지 PDF)만 접근 가능 → 임의 fileId 요청으로 다른 Drive 파일을
 * 빼낼 수 없음(스코프 자체가 화이트리스트).
 */

interface OAuthEnv {
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
}

// 같은 isolate 안에서 access_token 재사용 (요청마다 갱신하면 낭비 + 레이트리밋).
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(env: OAuthEnv): Promise<string> {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN } = env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN 미설정');
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }
  const body = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`OAuth 토큰 갱신 실패: ${res.status}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

/** Drive 파일 ID 형식 검증 (영숫자/_/-). 잘못된 입력으로 외부 요청 만들지 않도록. */
export function isValidDriveFileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{10,}$/.test(id);
}

/**
 * Drive 파일 바이트를 스트리밍으로 가져옴. 반환 Response.body를 그대로
 * 클라이언트 Response에 흘려보내면 메모리에 전체 버퍼링 없이 전달됨.
 */
export async function fetchDriveFile(fileId: string, env: OAuthEnv): Promise<Response> {
  const token = await getAccessToken(env);
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId,
  )}?alt=media&supportsAllDrives=true`;
  return fetch(url, { headers: { authorization: `Bearer ${token}` } });
}
