/**
 * Cloudflare Worker 런타임에서 Google Drive 파일을 읽기 위한 헬퍼.
 *
 * **서비스계정(SA)** 인증 사용 — drive.readonly 스코프로 공개/공유된 모든 파일을 읽는다.
 * OAuth Delegation(drive.file)은 "앱이 만든 파일(분할본)"만 접근 가능해서, 수동 업로드된
 * 통합본 해설지(전체의 약 63%)를 못 읽어 502가 났다. SA는 분할본·통합본 모두 읽으며,
 * refresh token처럼 만료되지도 않는다(JWT를 매번 서명해 토큰 교환).
 *
 * SA는 sync-drive가 쓰는 GOOGLE_SERVICE_ACCOUNT_JSON과 동일.
 */

interface SAEnv {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

// 같은 isolate 안에서 access_token 재사용.
let cachedToken: { value: string; expiresAt: number } | null = null;

function base64urlFromString(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function parseSA(env: SAEnv): ServiceAccount {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 미설정');
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  if (!sa.client_email || !sa.private_key || !sa.token_uri) throw new Error('SA JSON 필드 누락');
  return sa;
}

async function getAccessToken(env: SAEnv): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const sa = parseSA(env);
  const iat = Math.floor(now / 1000);
  const header = base64urlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64urlFromString(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: sa.token_uri,
      iat,
      exp: iat + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64urlFromBytes(new Uint8Array(sig))}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`SA 토큰 교환 실패: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/** Drive 파일 ID 형식 검증 (영숫자/_/-). */
export function isValidDriveFileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{10,}$/.test(id);
}

/** Drive 파일 바이트를 스트리밍으로 가져옴. */
export async function fetchDriveFile(fileId: string, env: SAEnv): Promise<Response> {
  const token = await getAccessToken(env);
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId,
  )}?alt=media&supportsAllDrives=true`;
  return fetch(url, { headers: { authorization: `Bearer ${token}` } });
}
