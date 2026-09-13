/**
 * 해설지 프록시 테스트용 서비스계정(SA) 대역 — 실제 RSA 키로 JWT 서명을 검증할 수 있게 한다.
 */
import { vi } from 'vitest';

export const TOKEN_URI = 'https://oauth2.test/token';

export async function makeServiceAccount() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  return {
    json: JSON.stringify({ client_email: 'kpc-bot@test.iam.gserviceaccount.com', private_key: pem, token_uri: TOKEN_URI }),
    publicKey,
  };
}

/** Google 토큰 교환 + Drive files.get 대역. 호출 기록은 fetchMock.mock.calls */
export function stubGoogleFetch(opts: { tokenStatus?: number; expiresIn?: number; driveStatus?: number } = {}) {
  let issued = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === TOKEN_URI) {
      if ((opts.tokenStatus ?? 200) !== 200) return new Response('denied', { status: opts.tokenStatus });
      issued++;
      return Response.json({ access_token: `access-${issued}`, expires_in: opts.expiresIn ?? 3600 });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files/')) {
      const status = opts.driveStatus ?? 200;
      return status === 200
        ? new Response('%PDF-1.4 해설지', { headers: { 'content-type': 'application/pdf' } })
        : new Response(JSON.stringify({ error: { message: 'File not found: secret-detail' } }), { status });
    }
    throw new Error(`예상 밖 fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function base64UrlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}
