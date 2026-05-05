/**
 * 인증 헬퍼 — 쿠키 read/write + JWT 검증.
 * Astro endpoint와 middleware에서 공용.
 */
import { signJwt, verifyJwt, type JwtPayload } from './jwt';

export const SESSION_COOKIE = 'kpc_session';
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7일

export interface AppUser {
  sub: string;
  name?: string;
  email?: string;
}

interface Env {
  JWT_SECRET?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  PUBLIC_SITE_URL?: string;
}

/** runtime.env (Cloudflare) 또는 process.env (로컬 dev/SSG) 폴백 */
export function getEnv(locals: any): Env {
  const runtimeEnv = locals?.runtime?.env ?? {};
  return {
    JWT_SECRET: runtimeEnv.JWT_SECRET ?? process.env.JWT_SECRET,
    NAVER_CLIENT_ID: runtimeEnv.NAVER_CLIENT_ID ?? process.env.NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET: runtimeEnv.NAVER_CLIENT_SECRET ?? process.env.NAVER_CLIENT_SECRET,
    PUBLIC_SITE_URL: runtimeEnv.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL,
  };
}

export function readSessionCookie(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function readSessionUser(req: Request, env: Env): Promise<AppUser | null> {
  if (!env.JWT_SECRET) return null;
  const token = readSessionCookie(req);
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  return { sub: payload.sub, name: payload.name, email: payload.email };
}

export async function makeSessionCookieValue(user: AppUser, env: Env): Promise<string> {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET 필요');
  return signJwt({ sub: user.sub, name: user.name, email: user.email }, env.JWT_SECRET, SESSION_TTL_SEC);
}

export function setSessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
