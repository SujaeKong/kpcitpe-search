import type { APIRoute } from 'astro';
import { getEnv } from '../../../../lib/auth';

export const prerender = false;

const STATE_COOKIE = 'kpc_oauth_state';

function randomState(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const GET: APIRoute = ({ locals, request, redirect }) => {
  const env = getEnv(locals);
  if (!env.NAVER_CLIENT_ID || !env.PUBLIC_SITE_URL) {
    return new Response('OAuth 환경변수 미설정', { status: 500 });
  }
  const state = randomState();
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return') ?? '/';
  const callback = `${env.PUBLIC_SITE_URL}/api/auth/naver/callback`;

  const authorizeUrl = new URL('https://nid.naver.com/oauth2.0/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', env.NAVER_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', callback);
  authorizeUrl.searchParams.set('state', state);

  const headers = new Headers();
  // CSRF 방어용 state + 로그인 후 돌아갈 곳을 쿠키에 함께 저장
  const stateCookieValue = `${state}|${returnTo}`;
  headers.append(
    'set-cookie',
    `${STATE_COOKIE}=${encodeURIComponent(stateCookieValue)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  headers.set('location', authorizeUrl.toString());
  return new Response(null, { status: 302, headers });
};
