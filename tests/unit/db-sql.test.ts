/**
 * 사용자 DB SQL을 실제 SQLite(sql.js)로 실행 — D1도 SQLite라 스키마·upsert·동의 갱신 동작을 그대로 검증.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callApi, TEST_ENV } from '../helpers/api-context';
import { makeUser } from '../helpers/fake-d1';
import { createSqliteD1 } from '../helpers/sqlite-d1';

// ensureSchema가 모듈 전역 플래그를 쓰므로 DB마다 새로 import
async function freshDb() {
  vi.resetModules();
  const mod = await import('../../src/lib/db');
  return { ...mod, d1: await createSqliteD1() };
}

const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  return Math.floor(new Date(iso).getTime() / 1000);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('사용자 DB (SQLite)', () => {
  it('Q1: 스키마 생성은 여러 번 호출해도 안전하고 users 테이블·naver_id 인덱스를 만든다', async () => {
    const { ensureSchema, d1 } = await freshDb();
    await ensureSchema(d1 as any);
    await d1.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER)'); // 이미 있으면 무시
    const objects = d1.query("SELECT type, name FROM sqlite_master WHERE name IN ('users', 'idx_users_naver_id') ORDER BY name");
    expect(objects).toEqual([
      { type: 'index', name: 'idx_users_naver_id' },
      { type: 'table', name: 'users' },
    ]);
  });

  it('Q2: 신규 로그인 → 가입·최근 로그인 시각이 같고 수신동의는 0', async () => {
    const { upsertUser, d1 } = await freshDb();
    const t = at('2026-09-01T00:00:00Z');
    const row = await upsertUser(d1 as any, { naverId: 'n1', email: 'a@example.com', name: '가나다' });
    expect(row).toMatchObject({ naver_id: 'n1', email: 'a@example.com', name: '가나다', joined_at: t, last_login_at: t, marketing_consent: 0, marketing_consent_at: null });
  });

  it('Q3: 재로그인 → 가입 시각 유지, 최근 로그인 갱신, 이메일이 비어 오면 기존 값 유지, 이름은 새 값', async () => {
    const { upsertUser, d1 } = await freshDb();
    const joined = at('2026-09-01T00:00:00Z');
    await upsertUser(d1 as any, { naverId: 'n1', email: 'a@example.com', name: '옛이름' });
    const later = at('2026-09-10T12:00:00Z');
    const row = await upsertUser(d1 as any, { naverId: 'n1', email: null, name: '새이름' });
    expect(row).toMatchObject({ joined_at: joined, last_login_at: later, email: 'a@example.com', name: '새이름' });
    expect(d1.query('SELECT COUNT(*) AS n FROM users')).toEqual([{ n: 1 }]);
  });

  it('Q4: 수신동의 → 1 + 동의 시각, 철회 → 0 + 시각 null (다른 사용자에게 영향 없음)', async () => {
    const { upsertUser, setMarketingConsent, getUserByNaverId, d1 } = await freshDb();
    at('2026-09-01T00:00:00Z');
    await upsertUser(d1 as any, { naverId: 'n1', email: null, name: null });
    await upsertUser(d1 as any, { naverId: 'n2', email: null, name: null });
    const agreedAt = at('2026-09-02T00:00:00Z');
    await setMarketingConsent(d1 as any, 'n1', true);
    expect(await getUserByNaverId(d1 as any, 'n1')).toMatchObject({ marketing_consent: 1, marketing_consent_at: agreedAt });
    expect(await getUserByNaverId(d1 as any, 'n2')).toMatchObject({ marketing_consent: 0, marketing_consent_at: null });
    await setMarketingConsent(d1 as any, 'n1', false);
    expect(await getUserByNaverId(d1 as any, 'n1')).toMatchObject({ marketing_consent: 0, marketing_consent_at: null });
    expect(await getUserByNaverId(d1 as any, 'unknown')).toBeNull();
  });

  it('Q5: 관리자 CSV(동의자만)가 실제 SQL로 동의자만 가입 최신순으로 내보낸다', async () => {
    const { upsertUser, setMarketingConsent, d1 } = await freshDb();
    at('2026-09-01T00:00:00Z');
    await upsertUser(d1 as any, { naverId: 'old', email: 'old@example.com', name: '먼저' });
    at('2026-09-05T00:00:00Z');
    await upsertUser(d1 as any, { naverId: 'new', email: 'new@example.com', name: '나중' });
    await upsertUser(d1 as any, { naverId: 'no', email: 'no@example.com', name: '미동의' });
    await setMarketingConsent(d1 as any, 'old', true);
    await setMarketingConsent(d1 as any, 'new', true);
    vi.useRealTimers();

    const { GET } = await import('../../src/pages/api/admin/users.csv');
    const admin = makeUser({ email: TEST_ENV.ADMIN_EMAILS });
    const { res } = await callApi(GET, '/api/admin/users.csv?consent=1', { as: admin, db: d1 as any });
    const rows = (await res.text()).replace(/^﻿/, '').trim().split('\n').slice(1);
    expect(rows.map((r) => r.split(',')[1])).toEqual(['new', 'old']);
  });
});
