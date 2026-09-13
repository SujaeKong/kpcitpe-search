/**
 * problems.json 로더.
 * - 페이지 로드마다 HTTP 재검증(cache: 'no-cache'): 안 바뀌었으면 ETag 304로 캐시 재사용,
 *   새 배포로 바뀌었으면 즉시 새 데이터를 받음
 * - 같은 페이지 안의 중복 호출은 inflight promise로 1회만 요청
 * - 빌드 결과 BASE_URL 하위에 위치 → import.meta.env.BASE_URL 기준 절대 경로 사용
 *
 * 과거의 cache: 'force-cache' + 버전 고정 sessionStorage 캐시는 새로고침해도 옛 데이터를
 * 계속 보여줘(신규 회차 카드 미노출) 제거함. sessionStorage는 데이터(~7.4M자)가 quota를 넘어
 * 저장도 되지 않고 매번 직렬화 비용만 들었음.
 */
import type { Problem } from './types';

function dataUrl(): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  return `${base}/data/problems.json`;
}

let inflight: Promise<Problem[]> | null = null;

export async function loadProblems(): Promise<Problem[]> {
  if (inflight) return inflight;

  inflight = (async () => {
    const res = await fetch(dataUrl(), { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error(`problems.json fetch 실패: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as Problem[];
  })();

  return inflight;
}
