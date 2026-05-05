import type { APIRoute } from 'astro';
import {
  getEnv,
  makeSessionCookieValue,
  setSessionCookieHeader,
  type AppUser,
} from '../../../../lib/auth';

export const prerender = false;

const STATE_COOKIE = 'kpc_oauth_state';

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export const GET: APIRoute = async ({ locals, request }) => {
  const env = getEnv(locals);
  if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET || !env.JWT_SECRET) {
    return new Response('OAuth 환경변수 미설정', { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  if (errorParam) return new Response(`Naver 인증 거부: ${errorParam}`, { status: 400 });
  if (!code || !state) return new Response('code/state 누락', { status: 400 });

  // state 검증
  const stateCookie = readCookie(request, STATE_COOKIE);
  if (!stateCookie) return new Response('state 쿠키 없음 (만료 또는 변조)', { status: 400 });
  const [savedState, returnTo = '/'] = stateCookie.split('|');
  if (savedState !== state) return new Response('state 불일치', { status: 400 });

  // access_token 교환
  const tokenUrl = new URL('https://nid.naver.com/oauth2.0/token');
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('client_id', env.NAVER_CLIENT_ID);
  tokenUrl.searchParams.set('client_secret', env.NAVER_CLIENT_SECRET);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('state', state);
  const tokenRes = await fetch(tokenUrl.toString());
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return new Response(`Naver token 교환 실패: ${text}`, { status: 502 });
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) {
    return new Response(`Naver token 응답 오류: ${JSON.stringify(tokenJson)}`, { status: 502 });
  }

  // 사용자 정보 조회
  const profileRes = await fetch('https://openapi.naver.com/v1/nid/me', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!profileRes.ok) {
    return new Response('Naver 프로필 조회 실패', { status: 502 });
  }
  const profile = (await profileRes.json()) as {
    response?: { id?: string; name?: string; email?: string };
  };
  const naverId = profile.response?.id;
  if (!naverId) return new Response('Naver 응답에 id 없음', { status: 502 });

  const user: AppUser = {
    sub: `naver:${naverId}`,
    name: profile.response?.name,
    email: profile.response?.email,
  };

  // JWT 세션 쿠키 발급
  const jwt = await makeSessionCookieValue(user, env);

  const headers = new Headers();
  headers.append('set-cookie', setSessionCookieHeader(jwt));
  headers.append(
    'set-cookie',
    `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  headers.set('location', returnTo.startsWith('/') ? returnTo : '/');
  return new Response(null, { status: 302, headers });
};
