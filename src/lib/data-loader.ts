/**
 * problems.json 로더.
 * - 정적 fetch + sessionStorage 캐시 (탭 살아있는 동안 재요청 회피)
 * - 빌드 결과 BASE_URL 하위에 위치 → import.meta.env.BASE_URL 기준 절대 경로 사용
 */
import type { Problem } from './types';

interface CachedShape {
  version: number;
  problems: Problem[];
}

const CACHE_KEY = 'kpcitpe.problems.v2';
const VERSION = 2;

function dataUrl(): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  return `${base}/data/problems.json`;
}

let inflight: Promise<Problem[]> | null = null;

export async function loadProblems(): Promise<Problem[]> {
  if (inflight) return inflight;

  inflight = (async () => {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as CachedShape;
          if (parsed.version === VERSION && Array.isArray(parsed.problems)) {
            return parsed.problems;
          }
        } catch {
          /* fall through */
        }
      }
    }

    const res = await fetch(dataUrl(), { cache: 'force-cache' });
    if (!res.ok) {
      throw new Error(`problems.json fetch 실패: ${res.status} ${res.statusText}`);
    }
    const problems = (await res.json()) as Problem[];

    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ version: VERSION, problems }),
        );
      } catch {
        // sessionStorage quota 초과 등 — 무시 (다음 로드 시 다시 fetch)
      }
    }

    return problems;
  })();

  return inflight;
}
