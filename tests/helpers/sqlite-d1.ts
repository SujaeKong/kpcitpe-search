/**
 * sql.js(WASM SQLite)로 만든 D1 대역 — 실제 SQL(스키마·ON CONFLICT upsert·COALESCE)을 그대로 실행한다.
 * D1 API 중 db.ts가 쓰는 exec / prepare().bind().first() / all() / run()만 구현.
 */
import initSqlJs from 'sql.js';

export async function createSqliteD1() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  const select = (sql: string, params: unknown[]) => {
    const stmt = db.prepare(sql);
    stmt.bind(params as any);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => select(sql, params)[0] ?? null,
    all: async () => ({ results: select(sql, params), success: true }),
    run: async () => {
      db.run(sql, params as any);
      return { success: true, meta: { changes: db.getRowsModified() } };
    },
  });

  return {
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
    prepare: (sql: string) => statement(sql),
    /** 테스트 검증용 직접 조회 */
    query: (sql: string, params: unknown[] = []) => select(sql, params),
  };
}
