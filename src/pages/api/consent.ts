import type { APIRoute } from 'astro';
import { getEnv, readSessionUser } from '../../lib/auth';
import { getDB, setMarketingConsent } from '../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ locals, request }) => {
  const env = getEnv(locals);
  const user = await readSessionUser(request, env);
  if (!user) {
    return Response.json({ error: '로그인 필요' }, { status: 401 });
  }
  const db = getDB(locals);
  if (!db) {
    return Response.json({ error: 'DB 미설정' }, { status: 500 });
  }

  let body: { consent?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }
  if (typeof body.consent !== 'boolean') {
    return Response.json({ error: 'consent: boolean 필요' }, { status: 400 });
  }

  const naverId = user.sub.replace(/^naver:/, '');
  await setMarketingConsent(db, naverId, body.consent);
  return Response.json({ ok: true, marketingConsent: body.consent });
};
