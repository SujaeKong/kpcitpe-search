import type { APIRoute } from 'astro';
import { getEnv, readSessionUser } from '../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async ({ locals, request }) => {
  const env = getEnv(locals);
  const user = await readSessionUser(request, env);
  return new Response(JSON.stringify({ user }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
