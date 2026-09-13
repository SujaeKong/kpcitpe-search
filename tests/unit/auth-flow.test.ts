/**
 * 인증 흐름: JWT, 세션 쿠키, 네이버 로그인/콜백/로그아웃, 수신동의.
 * 특히 로그인·로그아웃 후 돌아갈 주소가 외부 사이트로 새지 않는지(open redirect),
 * 깨진 세션 쿠키가 500을 내지 않는지 확인한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdmin } from '../../src/lib/admin';
import { clearSessionCookieHeader, readSessionCookie, safeReturnPath, setSessionCookieHeader } from '../../src/lib/auth';
import { isValidDriveFileId } from '../../src/lib/google-drive';
import { signJwt, verifyJwt } from '../../src/lib/jwt';
import { GET as logoutGET } from '../../src/pages/api/auth/logout';
import { GET as callbackGET } from '../../src/pages/api/auth/naver/callback';
import { GET as loginGET } from '../../src/pages/api/auth/naver/login';
import { POST as consentPOST } from '../../src/pages/api/consent';
import { GET as explanationGET } from '../../src/pages/api/explanation';
import { GET as meGET } from '../../src/pages/api/me';
import { callApi, TEST_ENV } from '../helpers/api-context';
import { createFakeD1, makeUser } from '../helpers/fake-d1';

const SITE = TEST_ENV.PUBLIC_SITE_URL;
const EXTERNAL_RETURNS = ['//evil.example/phish', '/\\evil.example', 'https://evil.example', '/\t/evil.example', '/..//evil.example'];

/** Location이 우리 사이트 안의 경로인지 (브라우저 URL 해석 기준) */
function expectSameSite(location: string | null) {
  expect(location).toBeTruthy();
  expect(new URL(location!, SITE).origin, `Location: ${JSON.stringify(location)}`).toBe(SITE);
}

function cookieValue(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    const m = c.match(new RegExp(`^${name}=([^;]*)`));
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JWT', () => {
  const payload = { sub: 'naver:1001', name: '홍길동', email: 'hong@example.com' };

  it('J1: 서명한 토큰을 검증하면 payload와 만료(7일)가 나온다', async () => {
    const decoded = await verifyJwt(await signJwt(payload, TEST_ENV.JWT_SECRET), TEST_ENV.JWT_SECRET);
    expect(decoded).toMatchObject(payload);
    expect(decoded!.exp - decoded!.iat).toBe(60 * 60 * 24 * 7);
  });

  it('J2: 다른 비밀키로는 검증 실패', async () => {
    expect(await verifyJwt(await signJwt(payload, TEST_ENV.JWT_SECRET), 'other-secret')).toBeNull();
  });

  it('J3: payload를 바꿔치기하면 검증 실패', async () => {
    const [h, , s] = (await signJwt(payload, TEST_ENV.JWT_SECRET)).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, sub: 'naver:9999', iat: 0, exp: 9e9 })).toString('base64url');
    expect(await verifyJwt(`${h}.${forged}.${s}`, TEST_ENV.JWT_SECRET)).toBeNull();
  });

  it('J4: 만료된 토큰은 검증 실패', async () => {
    expect(await verifyJwt(await signJwt(payload, TEST_ENV.JWT_SECRET, -10), TEST_ENV.JWT_SECRET)).toBeNull();
  });

  it('J5: 형식이 깨진 토큰(조각 수 오류, base64 아닌 서명)은 예외 없이 null', async () => {
    const [h, p] = (await signJwt(payload, TEST_ENV.JWT_SECRET)).split('.');
    await expect(verifyJwt('abc.def', TEST_ENV.JWT_SECRET)).resolves.toBeNull();
    await expect(verifyJwt(`${h}.${p}.@@@not-base64@@@`, TEST_ENV.JWT_SECRET)).resolves.toBeNull();
    await expect(verifyJwt(`${h}.%%%.${'a'.repeat(43)}`, TEST_ENV.JWT_SECRET)).resolves.toBeNull();
  });
});

describe('세션 쿠키 / 관리자 / fileId 헬퍼', () => {
  it('J6: 여러 쿠키 중 kpc_session만 정확히 읽는다 (이름 접두 일치는 무시)', () => {
    const req = (cookie?: string) => new Request(SITE, { headers: cookie ? { cookie } : {} });
    expect(readSessionCookie(req('a=1; kpc_session=abc%20d; b=2'))).toBe('abc d');
    expect(readSessionCookie(req('xkpc_session=zzz'))).toBeNull();
    expect(readSessionCookie(req())).toBeNull();
  });

  it('J7: 세션 쿠키는 HttpOnly·Secure·SameSite=Lax·7일, 로그아웃 쿠키는 즉시 만료', () => {
    const set = setSessionCookieHeader('tok');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${60 * 60 * 24 * 7}`]) {
      expect(set).toContain(flag);
    }
    expect(clearSessionCookieHeader()).toContain('Max-Age=0');
  });

  it('J8: isAdmin은 대소문자·공백을 무시하고, 이메일/목록이 없으면 거부', () => {
    const env = { ADMIN_EMAILS: ' Admin@Example.com , ops@example.com' };
    expect(isAdmin({ sub: 'naver:1', email: 'admin@example.COM' }, env)).toBe(true);
    expect(isAdmin({ sub: 'naver:1', email: 'user@example.com' }, env)).toBe(false);
    expect(isAdmin({ sub: 'naver:1' }, env)).toBe(false);
    expect(isAdmin({ sub: 'naver:1', email: 'admin@example.com' }, {})).toBe(false);
    expect(isAdmin(null, env)).toBe(false);
  });

  it('J10: safeReturnPath — 내부 경로는 유지(쿼리·해시 포함), 외부로 해석되는 값은 "/"', () => {
    expect(safeReturnPath('/rounds/?q=AI#top')).toBe('/rounds/?q=AI#top');
    expect(safeReturnPath('/?q=쿠버네티스')).toBe(`/?q=${encodeURIComponent('쿠버네티스')}`);
    for (const bad of [...EXTERNAL_RETURNS, null, undefined, '', 'rounds/', 'javascript:alert(1)']) {
      expect(safeReturnPath(bad), JSON.stringify(bad)).toBe('/');
    }
  });

  it('J9: Drive fileId 검증은 경로 조작·짧은 값·공백을 거부', () => {
    expect(isValidDriveFileId('1AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe(true);
    for (const bad of ['', 'short', '../../etc/passwd', 'abc def ghij', '1AbCd?alt=media&x']) {
      expect(isValidDriveFileId(bad), bad).toBe(false);
    }
  });
});

describe('깨진 세션 쿠키', () => {
  const brokenCookie = 'kpc_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.@@@';

  it('F1: /api/me → 500이 아니라 비로그인(user:null)으로 응답', async () => {
    const { res } = await callApi(meGET, '/api/me', { cookie: brokenCookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it('F2: /api/explanation → 401', async () => {
    const { res } = await callApi(explanationGET, '/api/explanation?fileId=1AbCdEfGhIjKlMnOpQrStUvWxYz012345', {
      cookie: brokenCookie,
    });
    expect(res.status).toBe(401);
  });
});

describe('로그아웃', () => {
  it('F3: 세션 쿠키를 지우고 return 경로(쿼리 포함)로 돌려보낸다', async () => {
    const { res } = await callApi(logoutGET, `/api/auth/logout?return=${encodeURIComponent('/rounds/?q=AI')}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/rounds/?q=AI');
    expect(res.headers.getSetCookie().join('\n')).toMatch(/kpc_session=;.*Max-Age=0/);
  });

  it.each(EXTERNAL_RETURNS)('F4: return=%j 같은 외부 주소로는 보내지 않는다', async (external) => {
    const { res } = await callApi(logoutGET, `/api/auth/logout?return=${encodeURIComponent(external)}`);
    expectSameSite(res.headers.get('location'));
  });
});

describe('네이버 로그인', () => {
  it('F5: 네이버 인가 URL로 보내고 state|return을 HttpOnly 쿠키(10분)에 저장', async () => {
    const { res } = await callApi(loginGET, `/api/auth/naver/login?return=${encodeURIComponent('/rounds/')}`);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://nid.naver.com/oauth2.0/authorize');
    expect(location.searchParams.get('client_id')).toBe(TEST_ENV.NAVER_CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe(`${SITE}/api/auth/naver/callback`);
    const state = location.searchParams.get('state')!;
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(cookieValue(res, 'kpc_oauth_state')).toBe(`${state}|/rounds/`);
    expect(res.headers.getSetCookie()[0]).toMatch(/HttpOnly.*Max-Age=600/);
  });

  it('F6: OAuth 환경변수가 없으면 500', async () => {
    const { res } = await callApi(loginGET, '/api/auth/naver/login', { env: { NAVER_CLIENT_ID: undefined } });
    expect(res.status).toBe(500);
  });

  it('F7: 콜백 — 거부/파라미터 누락/state 쿠키 없음/state 불일치는 400', async () => {
    const cases: [string, string?][] = [
      ['/api/auth/naver/callback?error=access_denied'],
      ['/api/auth/naver/callback?code=c'],
      ['/api/auth/naver/callback?code=c&state=abc'],
      ['/api/auth/naver/callback?code=c&state=abc', `kpc_oauth_state=${encodeURIComponent('zzz|/')}`],
    ];
    for (const [path, cookie] of cases) {
      const { res } = await callApi(callbackGET, path, { cookie });
      expect(res.status, `${path} ${cookie ?? ''}`).toBe(400);
    }
  });

  function stubNaver(id = '2002') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const target = String(input);
        if (target.startsWith('https://nid.naver.com/oauth2.0/token')) return Response.json({ access_token: 'naver-access' });
        if (target === 'https://openapi.naver.com/v1/nid/me') {
          return Response.json({ response: { id, name: '신규 회원', email: 'new@example.com' } });
        }
        throw new Error(`예상 밖 fetch: ${target}`);
      }),
    );
  }

  it('F8: 콜백 성공 → D1 upsert, 유효한 세션 쿠키, state 쿠키 삭제, return 경로(한글은 인코딩)로 이동', async () => {
    stubNaver('2002');
    const db = createFakeD1();
    const { res } = await callApi(callbackGET, '/api/auth/naver/callback?code=c&state=abc', {
      cookie: `kpc_oauth_state=${encodeURIComponent('abc|/?q=쿠버네티스')}`,
      db,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/?q=${encodeURIComponent('쿠버네티스')}`);
    expect(db.users.map((u) => u.naver_id)).toEqual(['2002']);
    const session = await verifyJwt(cookieValue(res, 'kpc_session')!, TEST_ENV.JWT_SECRET);
    expect(session).toMatchObject({ sub: 'naver:2002', email: 'new@example.com' });
    expect(res.headers.getSetCookie().join('\n')).toMatch(/kpc_oauth_state=;.*Max-Age=0/);
  });

  it.each(EXTERNAL_RETURNS)('F9: 콜백 — state 쿠키의 return=%j 가 외부 주소면 사이트 안으로만 이동', async (external) => {
    stubNaver();
    const { res } = await callApi(callbackGET, '/api/auth/naver/callback?code=c&state=abc', {
      cookie: `kpc_oauth_state=${encodeURIComponent(`abc|${external}`)}`,
    });
    expect(res.status).toBe(302);
    expectSameSite(res.headers.get('location'));
  });
});

describe('/api/consent', () => {
  it('F10: 비로그인 401, 잘못된 본문 400', async () => {
    expect((await callApi(consentPOST, '/api/consent', { method: 'POST', body: { consent: true } })).res.status).toBe(401);
    const user = makeUser();
    expect((await callApi(consentPOST, '/api/consent', { as: user, method: 'POST', body: '{broken' })).res.status).toBe(400);
    expect((await callApi(consentPOST, '/api/consent', { as: user, method: 'POST', body: { consent: 'yes' } })).res.status).toBe(400);
  });

  it('F11: 동의 → D1 반영 → /api/me가 marketingConsent:true, 철회 → false', async () => {
    const user = makeUser({ marketing_consent: 0 });
    const db = createFakeD1([user]);

    const agreed = await callApi(consentPOST, '/api/consent', { as: user, db, method: 'POST', body: { consent: true } });
    expect(await agreed.res.json()).toEqual({ ok: true, marketingConsent: true });
    expect(db.users[0].marketing_consent_at).toBeTypeOf('number');
    expect((await (await callApi(meGET, '/api/me', { as: user, db })).res.json()).user.marketingConsent).toBe(true);

    await callApi(consentPOST, '/api/consent', { as: user, db, method: 'POST', body: { consent: false } });
    expect(db.users[0]).toMatchObject({ marketing_consent: 0, marketing_consent_at: null });
    expect((await (await callApi(meGET, '/api/me', { as: user, db })).res.json()).user.marketingConsent).toBe(false);
  });
});
