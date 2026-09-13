/**
 * 관리자 API: 사용자 통계(최근 7일), CSV 내보내기(BOM·이스케이프·파일명·수식 주입 방지).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as usersCsvGET } from '../../src/pages/api/admin/users.csv';
import { GET as usersGET } from '../../src/pages/api/admin/users';
import { callApi, TEST_ENV } from '../helpers/api-context';
import { makeUser } from '../helpers/fake-d1';

const DAY = 24 * 60 * 60;
const now = Math.floor(Date.now() / 1000);
const admin = makeUser({ id: 1, naver_id: '9001', email: TEST_ENV.ADMIN_EMAILS, name: '관리자', joined_at: now - 30 * DAY });

afterEach(() => {
  vi.useRealTimers();
});

async function csvOf(users: ReturnType<typeof makeUser>[], query = '') {
  const { res } = await callApi(usersCsvGET, `/api/admin/users.csv${query}`, { as: admin, users });
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  return { res, bytes, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) };
}

describe('/api/admin/users 통계', () => {
  it('C1: 최근 7일 신규는 7일 경계 안쪽만, 동의자 수는 marketing_consent=1', async () => {
    const users = [
      admin,
      makeUser({ id: 2, naver_id: '2', joined_at: now - 6 * DAY, marketing_consent: 1 }),
      makeUser({ id: 3, naver_id: '3', joined_at: now - 7 * DAY + 60 }),
      makeUser({ id: 4, naver_id: '4', joined_at: now - 8 * DAY, marketing_consent: 1 }),
    ];
    const { res } = await callApi(usersGET, '/api/admin/users', { as: admin, users });
    expect((await res.json()).stats).toEqual({ total: 4, consentCount: 2, recentCount: 2 });
  });
});

describe('/api/admin/users.csv', () => {
  it('C2: 엑셀 한글 깨짐 방지 UTF-8 BOM, 전체/동의자 헤더, 날짜 파일명', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T09:00:00Z'));
    const all = await csvOf([admin]);
    expect([...all.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(all.text.slice(1).split('\n')[0]).toBe('id,naver_id,email,name,joined_at,last_login_at,consent,consent_at');
    expect(all.res.headers.get('content-disposition')).toBe('attachment; filename="kpcitpe-users-2026-09-14.csv"');

    const consentOnly = await csvOf([admin], '?consent=1');
    expect(consentOnly.text.slice(1).split('\n')[0]).toBe('id,naver_id,email,name,joined_at,last_login_at,consent_at');
    expect(consentOnly.res.headers.get('content-disposition')).toBe('attachment; filename="kpcitpe-users-consent-2026-09-14.csv"');
  });

  it('C3: 쉼표·따옴표·줄바꿈이 든 값은 따옴표로 감싸고 따옴표는 두 번', async () => {
    const { text } = await csvOf([makeUser({ id: 7, naver_id: '7', name: '홍, "길동"\n2세', email: null })]);
    expect(text).toContain('"홍, ""길동""\n2세"');
    expect(text).toMatch(/^﻿?id,.*\n7,7,,"홍/m);
  });

  it('C4: =·+·-·@로 시작하는 값은 작은따옴표를 붙여 엑셀 수식 실행 차단 (CSV Injection)', async () => {
    const { text } = await csvOf([
      makeUser({ id: 8, naver_id: '8', name: '=HYPERLINK("http://evil.example","클릭")', email: '+cmd@evil.example' }),
      makeUser({ id: 9, naver_id: '9', name: '@SUM(1+1)', email: '-2+3@evil.example' }),
    ]);
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""클릭"")"`);
    expect(text).toContain(`'+cmd@evil.example`);
    expect(text).toContain(`'@SUM(1+1)`);
    expect(text).toContain(`'-2+3@evil.example`);
    expect(text).not.toMatch(/(^|,)[=+@-]/m);
  });
});
