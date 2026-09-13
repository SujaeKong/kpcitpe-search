/**
 * 사용자별 API 응답의 캐시 정책 + 해설지/관리자 게이트.
 * 로그인 상태·동의 여부·사용자 목록은 사람마다 다르므로 브라우저/중간 캐시에 남으면 안 된다
 * (로그인·로그아웃·동의 직후 옛 상태가 보이는 문제 방지).
 */
import { describe, expect, it } from 'vitest';
import { GET as adminUsersCsvGET } from '../../src/pages/api/admin/users.csv';
import { GET as adminUsersGET } from '../../src/pages/api/admin/users';
import { GET as explanationGET } from '../../src/pages/api/explanation';
import { GET as meGET } from '../../src/pages/api/me';
import { callApi, expectNoStoreHeader, TEST_ENV } from '../helpers/api-context';
import { makeUser } from '../helpers/fake-d1';

const VALID_FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('/api/me', () => {
  it('A1: 비로그인 → user:null, no-store', async () => {
    const { res } = await callApi(meGET, '/api/me');
    expect(await res.json()).toEqual({ user: null });
    expect(expectNoStoreHeader(res)).toMatch(/no-store/);
  });

  it('A2: 로그인 + 수신동의 → marketingConsent:true, no-store', async () => {
    const user = makeUser({ marketing_consent: 1 });
    const { res } = await callApi(meGET, '/api/me', { as: user });
    expect((await res.json()).user).toMatchObject({ sub: 'naver:1001', email: user.email, marketingConsent: true });
    expect(expectNoStoreHeader(res)).toMatch(/no-store/);
  });

  it('A3: 로그인 + 미동의 → marketingConsent:false', async () => {
    const { res } = await callApi(meGET, '/api/me', { as: makeUser({ marketing_consent: 0 }) });
    expect((await res.json()).user.marketingConsent).toBe(false);
  });
});

describe('/api/explanation 게이트', () => {
  it('A4: 비로그인 → 401', async () => {
    const { res } = await callApi(explanationGET, `/api/explanation?fileId=${VALID_FILE_ID}`);
    expect(res.status).toBe(401);
  });

  it('A5: 로그인 + 미동의 → 403 (Drive 호출 전에 차단)', async () => {
    const { res } = await callApi(explanationGET, `/api/explanation?fileId=${VALID_FILE_ID}`, {
      as: makeUser({ marketing_consent: 0 }),
    });
    expect(res.status).toBe(403);
  });
});

describe('/api/admin/*', () => {
  const admin = makeUser({ id: 9, naver_id: '9009', email: TEST_ENV.ADMIN_EMAILS, marketing_consent: 1 });
  const member = makeUser();

  it('A6: 비관리자 → users 403, users.csv 403', async () => {
    expect((await callApi(adminUsersGET, '/api/admin/users', { as: member })).res.status).toBe(403);
    expect((await callApi(adminUsersCsvGET, '/api/admin/users.csv', { as: member })).res.status).toBe(403);
  });

  it('A7: 관리자 users 목록 → 200, no-store', async () => {
    const { res } = await callApi(adminUsersGET, '/api/admin/users', { as: admin, users: [admin, member] });
    expect(res.status).toBe(200);
    expect((await res.json()).stats.total).toBe(2);
    expect(expectNoStoreHeader(res)).toMatch(/no-store/);
  });

  it('A8: 관리자 users.csv (동의자만) → 200, no-store', async () => {
    const { res } = await callApi(adminUsersCsvGET, '/api/admin/users.csv?consent=1', { as: admin, users: [admin, member] });
    expect(res.status).toBe(200);
    expect((await res.text()).trim().split('\n')).toHaveLength(2); // 헤더 + 동의자 1명
    expect(expectNoStoreHeader(res)).toMatch(/no-store/);
  });
});
