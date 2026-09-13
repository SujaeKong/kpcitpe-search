import type { APIRoute } from 'astro';
import { clearSessionCookieHeader, safeReturnPath } from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const headers = new Headers();
  headers.append('set-cookie', clearSessionCookieHeader());
  headers.set('location', safeReturnPath(url.searchParams.get('return')));
  return new Response(null, { status: 302, headers });
};
