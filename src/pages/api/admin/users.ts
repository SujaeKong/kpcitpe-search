import type { APIRoute } from 'astro';
import { getEnv, readSessionUser } from '../../../lib/auth';
import { isAdmin } from '../../../lib/admin';
import { getDB, ensureSchema } from '../../../lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ locals, request }) => {
  const env = { ...getEnv(locals), ADMIN_EMAILS: (locals as any)?.runtime?.env?.ADMIN_EMAILS };
  const user = await readSessionUser(request, env);
  if (!isAdmin(user, env)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const db = getDB(locals);
  if (!db) return Response.json({ error: 'DB 미설정' }, { status: 500 });

  await ensureSchema(db);
  const rows = await db
    .prepare(
      `SELECT id, naver_id, email, name, joined_at, last_login_at, marketing_consent, marketing_consent_at
       FROM users ORDER BY joined_at DESC LIMIT 1000`,
    )
    .all<{
      id: number;
      naver_id: string;
      email: string | null;
      name: string | null;
      joined_at: number;
      last_login_at: number;
      marketing_consent: number;
      marketing_consent_at: number | null;
    }>();

  // 통계
  const total = rows.results.length;
  const consentCount = rows.results.filter((r) => r.marketing_consent === 1).length;
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7;
  const recentCount = rows.results.filter((r) => r.joined_at >= sevenDaysAgo).length;

  return Response.json({
    stats: { total, consentCount, recentCount },
    users: rows.results,
  });
};
