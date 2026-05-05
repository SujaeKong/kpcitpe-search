import type { APIRoute } from 'astro';
import { clearSessionCookieHeader } from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const headers = new Headers();
  headers.append('set-cookie', clearSessionCookieHeader());
  const returnTo = url.searchParams.get('return') ?? '/';
  headers.set('location', returnTo.startsWith('/') ? returnTo : '/');
  return new Response(null, { status: 302, headers });
};
