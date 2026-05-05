import type { APIRoute } from 'astro';
import { getEnv, readSessionUser } from '../../lib/auth';
import { getDB, getUserByNaverId } from '../../lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ locals, request }) => {
  const env = getEnv(locals);
  const sessionUser = await readSessionUser(request, env);
  if (!sessionUser) {
    return Response.json({ user: null });
  }

  // DB에서 marketing_consent 등 보강 정보 조회
  const db = getDB(locals);
  let marketingConsent = false;
  if (db) {
    try {
      const naverId = sessionUser.sub.replace(/^naver:/, '');
      const row = await getUserByNaverId(db, naverId);
      marketingConsent = !!row?.marketing_consent;
    } catch (err) {
      console.error('getUserByNaverId 실패:', err);
    }
  }

  return Response.json({
    user: {
      sub: sessionUser.sub,
      name: sessionUser.name,
      email: sessionUser.email,
      marketingConsent,
    },
  });
};
