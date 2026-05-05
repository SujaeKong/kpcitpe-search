import type { APIRoute } from 'astro';
import { getEnv, readSessionUser } from '../../../lib/auth';
import { isAdmin } from '../../../lib/admin';
import { getDB, ensureSchema } from '../../../lib/db';

export const prerender = false;

function csvEscape(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const GET: APIRoute = async ({ locals, request, url }) => {
  const env = { ...getEnv(locals), ADMIN_EMAILS: (locals as any)?.runtime?.env?.ADMIN_EMAILS };
  const user = await readSessionUser(request, env);
  if (!isAdmin(user, env)) {
    return new Response('forbidden', { status: 403 });
  }
  const db = getDB(locals);
  if (!db) return new Response('DB 미설정', { status: 500 });

  const consentOnly = url.searchParams.get('consent') === '1';
  await ensureSchema(db);

  const sql = consentOnly
    ? `SELECT id, naver_id, email, name, joined_at, last_login_at, marketing_consent_at
       FROM users WHERE marketing_consent = 1 ORDER BY joined_at DESC`
    : `SELECT id, naver_id, email, name, joined_at, last_login_at, marketing_consent, marketing_consent_at
       FROM users ORDER BY joined_at DESC`;
  const { results } = await db.prepare(sql).all<any>();

  const headers = consentOnly
    ? ['id', 'naver_id', 'email', 'name', 'joined_at', 'last_login_at', 'consent_at']
    : ['id', 'naver_id', 'email', 'name', 'joined_at', 'last_login_at', 'consent', 'consent_at'];

  const fmt = (ts: number | null) =>
    ts ? new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '';

  const lines = [headers.join(',')];
  for (const r of results) {
    const cols = consentOnly
      ? [r.id, r.naver_id, r.email, r.name, fmt(r.joined_at), fmt(r.last_login_at), fmt(r.marketing_consent_at)]
      : [
          r.id,
          r.naver_id,
          r.email,
          r.name,
          fmt(r.joined_at),
          fmt(r.last_login_at),
          r.marketing_consent ? 'yes' : 'no',
          fmt(r.marketing_consent_at),
        ];
    lines.push(cols.map(csvEscape).join(','));
  }

  const filename = consentOnly
    ? `kpcitpe-users-consent-${new Date().toISOString().slice(0, 10)}.csv`
    : `kpcitpe-users-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response('﻿' + lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
};
