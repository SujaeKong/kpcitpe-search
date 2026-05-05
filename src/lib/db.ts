/**
 * D1 사용자 DB 헬퍼.
 * 첫 호출 시 자동으로 schema 생성 (idempotent, 한 worker 인스턴스당 1회만 실행).
 */
import type { D1Database } from '@cloudflare/workers-types';

export interface UserRow {
  id: number;
  naver_id: string;
  email: string | null;
  name: string | null;
  joined_at: number;
  last_login_at: number;
  marketing_consent: number; // 0 / 1
  marketing_consent_at: number | null;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naver_id TEXT UNIQUE NOT NULL,
    email TEXT,
    name TEXT,
    joined_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL,
    marketing_consent INTEGER NOT NULL DEFAULT 0,
    marketing_consent_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_naver_id ON users(naver_id)`,
];

let schemaReady = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  for (const sql of SCHEMA_STATEMENTS) {
    await db.exec(sql.replace(/\s+/g, ' ').trim());
  }
  schemaReady = true;
}

export async function getUserByNaverId(db: D1Database, naverId: string): Promise<UserRow | null> {
  await ensureSchema(db);
  return await db.prepare('SELECT * FROM users WHERE naver_id = ?').bind(naverId).first<UserRow>();
}

export async function upsertUser(
  db: D1Database,
  args: { naverId: string; email: string | null; name: string | null },
): Promise<UserRow> {
  await ensureSchema(db);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (naver_id, email, name, joined_at, last_login_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(naver_id) DO UPDATE SET
         last_login_at = excluded.last_login_at,
         email = COALESCE(excluded.email, users.email),
         name = COALESCE(excluded.name, users.name)`,
    )
    .bind(args.naverId, args.email, args.name, now, now)
    .run();
  const row = await getUserByNaverId(db, args.naverId);
  if (!row) throw new Error('upsert 후 조회 실패');
  return row;
}

export async function setMarketingConsent(
  db: D1Database,
  naverId: string,
  consent: boolean,
): Promise<void> {
  await ensureSchema(db);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      'UPDATE users SET marketing_consent = ?, marketing_consent_at = ? WHERE naver_id = ?',
    )
    .bind(consent ? 1 : 0, consent ? now : null, naverId)
    .run();
}

export function getDB(locals: any): D1Database | null {
  return locals?.runtime?.env?.DB ?? null;
}
