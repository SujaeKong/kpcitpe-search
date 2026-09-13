/**
 * 사용자별 API 응답의 캐시 정책 + 해설지/관리자 게이트.
 * 로그인 상태·동의 여부·사용자 목록은 사람마다 다르므로 브라우저/중간 캐시에 남으면 안 된다
 * (로그인·로그아웃·동의 직후 옛 상태가 보이는 문제 방지).
 */
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../src/lib/auth';
import { signJwt } from '../../src/lib/jwt';
import { GET as adminUsersCsvGET } from '../../src/pages/api/admin/users.csv';
import { GET as adminUsersGET } from '../../src/pages/api/admin/users';
import { GET as explanationGET } from '../../src/pages/api/explanation';
import { GET as meGET } from '../../src/pages/api/me';
import { createFakeD1, makeUser } from '../helpers/fake-d1';
import type { UserRow } from '../../src/lib/db';

const JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const ADMIN_EMAIL = 'admin@example.com';
const VALID_FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

interface CallOptions {
  /** 세션 쿠키로 로그인시킬 사용자 */
  as?: UserRow;
  users?: UserRow[];
}

async function call(handler: (ctx: any) => Response | Promise<Response>, pathWithQuery: string, opts: CallOptions = {}) {
  const url = new URL(pathWithQuery, 'https://test.local');
  const headers = new Headers();
  if (opts.as) {
    const token = await signJwt(
      { sub: `naver:${opts.as.naver_id}`, name: opts.as.name ?? undefined, email: opts.as.email ?? undefined },
      JWT_SECRET,
    );
    headers.set('cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}`);
  }
  const users = opts.users ?? (opts.as ? [opts.as] : []);
  const locals = { runtime: { env: { JWT_SECRET, ADMIN_EMAILS: ADMIN_EMAIL, DB: createFakeD1(users) } } };
  return handler({ request: new Request(url, { headers }), url, locals });
}

function expectNoStore(res: Response) {
  expect(res.headers.get('cache-control') ?? '(없음)').toMatch(/no-store/);
}

describe('/api/me', () => {
  it('A1: 비로그인 → user:null, no-store', async () => {
    const res = await call(meGET, '/api/me');
    expect(await res.json()).toEqual({ user: null });
    expectNoStore(res);
  });

  it('A2: 로그인 + 수신동의 → marketingConsent:true, no-store', async () => {
    const user = makeUser({ marketing_consent: 1 });
    const res = await call(meGET, '/api/me', { as: user });
    const body = await res.json();
    expect(body.user).toMatchObject({ sub: 'naver:1001', email: user.email, marketingConsent: true });
    expectNoStore(res);
  });

  it('A3: 로그인 + 미동의 → marketingConsent:false', async () => {
    const res = await call(meGET, '/api/me', { as: makeUser({ marketing_consent: 0 }) });
    expect((await res.json()).user.marketingConsent).toBe(false);
  });
});

describe('/api/explanation 게이트', () => {
  it('A4: 비로그인 → 401', async () => {
    const res = await call(explanationGET, `/api/explanation?fileId=${VALID_FILE_ID}`);
    expect(res.status).toBe(401);
  });

  it('A5: 로그인 + 미동의 → 403 (Drive 호출 전에 차단)', async () => {
    const res = await call(explanationGET, `/api/explanation?fileId=${VALID_FILE_ID}`, {
      as: makeUser({ marketing_consent: 0 }),
    });
    expect(res.status).toBe(403);
  });
});

describe('/api/admin/*', () => {
  const admin = makeUser({ id: 9, naver_id: '9009', email: ADMIN_EMAIL, marketing_consent: 1 });
  const member = makeUser();

  it('A6: 비관리자 → users 403, users.csv 403', async () => {
    expect((await call(adminUsersGET, '/api/admin/users', { as: member })).status).toBe(403);
    expect((await call(adminUsersCsvGET, '/api/admin/users.csv', { as: member })).status).toBe(403);
  });

  it('A7: 관리자 users 목록 → 200, no-store', async () => {
    const res = await call(adminUsersGET, '/api/admin/users', { as: admin, users: [admin, member] });
    expect(res.status).toBe(200);
    expect((await res.json()).stats.total).toBe(2);
    expectNoStore(res);
  });

  it('A8: 관리자 users.csv (동의자만) → 200, no-store', async () => {
    const res = await call(adminUsersCsvGET, '/api/admin/users.csv?consent=1', { as: admin, users: [admin, member] });
    expect(res.status).toBe(200);
    expect((await res.text()).trim().split('\n')).toHaveLength(2); // 헤더 + 동의자 1명
    expectNoStore(res);
  });
});
