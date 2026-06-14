/**
 * 해설지 PDF 서버 프록시 — 진짜 접근 차단 지점.
 *
 * 1) 로그인 안 됨        → 401
 * 2) 로그인 O, 수신동의 X → 403
 * 3) 로그인 O, 수신동의 O → Drive에서 PDF를 가져와 스트리밍
 *
 * 클라이언트(ProblemCard/ExplanationModal)는 fileId만 넘기고, Drive 파일은
 * 비공개라 이 프록시(OAuth 자격증명 보유)를 거치지 않으면 누구도 못 봄.
 * drive.file 스코프라 우리 해설지 PDF 외 다른 fileId는 Drive가 거부.
 */
import type { APIRoute } from 'astro';
import { getEnv, readSessionUser } from '../../lib/auth';
import { getDB, getUserByNaverId } from '../../lib/db';
import { fetchDriveFile, isValidDriveFileId } from '../../lib/google-drive';

export const prerender = false;

export const GET: APIRoute = async ({ locals, request, url }) => {
  const env = getEnv(locals);

  // 1) 인증
  const user = await readSessionUser(request, env);
  if (!user) {
    return new Response('로그인이 필요합니다.', { status: 401 });
  }

  // 2) 수신동의 검증 (서버 권위)
  const db = getDB(locals);
  if (!db) {
    return new Response('DB 미설정', { status: 500 });
  }
  const naverId = user.sub.replace(/^naver:/, '');
  const row = await getUserByNaverId(db, naverId);
  if (!row?.marketing_consent) {
    return new Response('해설지는 광고성 정보 수신 동의 후 열람할 수 있습니다.', { status: 403 });
  }

  // 3) fileId 검증 후 Drive 스트리밍
  const fileId = url.searchParams.get('fileId');
  if (!fileId || !isValidDriveFileId(fileId)) {
    return new Response('fileId가 필요합니다.', { status: 400 });
  }

  let driveRes: Response;
  try {
    driveRes = await fetchDriveFile(fileId, env);
  } catch {
    return new Response('해설지 서버 설정 오류', { status: 500 });
  }
  if (!driveRes.ok || !driveRes.body) {
    // 404(없음)/403(스코프 밖)/기타 → 일반화된 메시지
    return new Response('해설지를 불러올 수 없습니다.', { status: 502 });
  }

  return new Response(driveRes.body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline',
      // 동의 철회 시 캐시된 PDF가 남지 않도록 비저장
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
