/**
 * API 핸들러 테스트용 최소 D1 대역.
 * 핸들러가 쓰는 exec / prepare().bind().first() / all() / run()만 흉내 내고,
 * 수신동의 UPDATE와 로그인 upsert(INSERT)는 메모리 users에 반영한다.
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

export function createFakeD1(initialUsers: UserRow[] = []) {
  const users = initialUsers.map((u) => ({ ...u }));
  const writes: { sql: string; args: unknown[] }[] = [];

  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => {
      if (/WHERE naver_id = \?/.test(sql)) return users.find((u) => u.naver_id === args[0]) ?? null;
      return users[0] ?? null;
    },
    all: async () => ({
      results: /marketing_consent = 1/.test(sql) ? users.filter((u) => u.marketing_consent === 1) : users,
    }),
    run: async () => {
      writes.push({ sql, args });
      if (/^\s*UPDATE users SET marketing_consent/.test(sql)) {
        const [consent, at, naverId] = args as [number, number | null, string];
        const user = users.find((u) => u.naver_id === naverId);
        if (user) Object.assign(user, { marketing_consent: consent, marketing_consent_at: at });
      } else if (/^\s*INSERT INTO users/.test(sql)) {
        const [naverId, email, name, joinedAt, lastLoginAt] = args as [string, string | null, string | null, number, number];
        const user = users.find((u) => u.naver_id === naverId);
        if (user) Object.assign(user, { last_login_at: lastLoginAt, email: email ?? user.email, name: name ?? user.name });
        else users.push(makeUser({ id: users.length + 1, naver_id: naverId, email, name, joined_at: joinedAt, last_login_at: lastLoginAt }));
      }
      return { success: true };
    },
  });

  return {
    users,
    writes,
    exec: async () => ({ count: 0, duration: 0 }),
    prepare: (sql: string) => statement(sql),
  };
}

export type FakeD1 = ReturnType<typeof createFakeD1>;
