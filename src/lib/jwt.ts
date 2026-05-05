/**
 * Web Crypto API 기반 HMAC-SHA256 JWT (Cloudflare Workers 호환).
 * 외부 라이브러리 없이 동작.
 */

export interface JwtPayload {
  sub: string;       // 사용자 식별자 (예: naver:{naverId})
  name?: string;
  email?: string;
  iat: number;       // issued at
  exp: number;       // expires at (epoch sec)
}

const TEXT_ENCODER = new TextEncoder();

function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === 'string') bytes = TEXT_ENCODER.encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = input;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, ttlSec = 60 * 60 * 24 * 7): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + ttlSec };
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, TEXT_ENCODER.encode(data));
  const sigB64 = base64UrlEncode(sig);
  return `${data}.${sigB64}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const key = await importKey(secret);
  const sig = base64UrlDecode(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sig.buffer as ArrayBuffer, TEXT_ENCODER.encode(data));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
