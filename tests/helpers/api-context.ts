/**
 * Astro API 핸들러를 서버 없이 직접 호출하는 도우미.
 * locals.runtime.env(Cloudflare 런타임)와 D1 대역, 세션 쿠키를 채워 준다.
 */
import { SESSION_COOKIE } from '../../src/lib/auth';
import type { UserRow } from '../../src/lib/db';
import { signJwt } from '../../src/lib/jwt';
import { createFakeD1, type FakeD1 } from './fake-d1';

export const TEST_ENV = {
  JWT_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  ADMIN_EMAILS: 'admin@example.com',
  NAVER_CLIENT_ID: 'test-naver-client',
  NAVER_CLIENT_SECRET: 'test-naver-secret',
  PUBLIC_SITE_URL: 'https://kpcitpe-search.test',
};

export function sessionTokenFor(user: Pick<UserRow, 'naver_id' | 'name' | 'email'>, secret = TEST_ENV.JWT_SECRET) {
  return signJwt(
    { sub: `naver:${user.naver_id}`, name: user.name ?? undefined, email: user.email ?? undefined },
    secret,
  );
}

export interface CallOptions {
  /** 이 사용자로 로그인한 세션 쿠키를 붙임 */
  as?: UserRow;
  /** D1에 들어 있을 사용자 (기본: as 사용자 1명) */
  users?: UserRow[];
  /** 추가 쿠키 문자열 (예: 'kpc_oauth_state=...') */
  cookie?: string;
  method?: string;
  body?: unknown;
  /** 환경변수 덮어쓰기 (undefined로 미설정 흉내) */
  env?: Record<string, string | undefined>;
  db?: FakeD1;
}

type Handler = (ctx: any) => Response | Promise<Response>;

export async function callApi(handler: Handler, pathWithQuery: string, opts: CallOptions = {}) {
  const url = new URL(pathWithQuery, TEST_ENV.PUBLIC_SITE_URL);
  const headers = new Headers();
  const cookies: string[] = [];
  if (opts.as) cookies.push(`${SESSION_COOKIE}=${encodeURIComponent(await sessionTokenFor(opts.as))}`);
  if (opts.cookie) cookies.push(opts.cookie);
  if (cookies.length) headers.set('cookie', cookies.join('; '));

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  const db = opts.db ?? createFakeD1(opts.users ?? (opts.as ? [opts.as] : []));
  const env = { ...TEST_ENV, ...opts.env, DB: db };
  const request = new Request(url, { method: opts.method ?? 'GET', headers, body });
  const res = await handler({ request, url, locals: { runtime: { env } } });
  return { res, db };
}

export function expectNoStoreHeader(res: Response): string {
  return res.headers.get('cache-control') ?? '(없음)';
}
