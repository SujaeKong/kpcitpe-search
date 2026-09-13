/**
 * API 핸들러 테스트용 최소 D1 대역.
 * 핸들러가 쓰는 exec / prepare().bind().first() / prepare().all() / run()만 흉내 낸다.
 */
import type { UserRow } from '../../src/lib/db';

export function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: 1,
    naver_id: '1001',
    email: 'user@example.com',
    name: '테스트 사용자',
    joined_at: now,
    last_login_at: now,
    marketing_consent: 0,
    marketing_consent_at: null,
    ...overrides,
  };
}

export function createFakeD1(users: UserRow[] = []) {
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => {
      if (/WHERE naver_id = \?/.test(sql)) {
        return users.find((u) => u.naver_id === args[0]) ?? null;
      }
      return users[0] ?? null;
    },
    all: async () => ({
      results: /marketing_consent = 1/.test(sql) ? users.filter((u) => u.marketing_consent === 1) : users,
    }),
    run: async () => ({ success: true }),
  });

  return {
    exec: async () => ({ count: 0, duration: 0 }),
    prepare: (sql: string) => statement(sql),
  };
}
