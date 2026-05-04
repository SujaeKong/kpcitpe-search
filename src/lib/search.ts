/**
 * Fuse.js 기반 검색 + 필터.
 *
 * 검색 대상: title, content
 * 필터: certScope (다중), sourceType (다중), academy (다중, null 포함), session, round 범위
 *
 * 매치 결과에 indices를 포함시켜 하이라이팅에 사용.
 */
import Fuse, { type IFuseOptions, type FuseResult } from 'fuse.js';
import type { CertScope, Problem, SourceType } from './types';

export interface FilterState {
  certScopes: Set<CertScope>;
  sourceTypes: Set<SourceType>;
  academies: Set<string>; // 'KPC' | 'ITPE' | '(없음)' — '(없음)'은 academy=null 매칭
  /**
   * 통합 session 필터.
   * 칩 값:
   *   - 숫자 ('1', '2', '3', '4'): 모든 출처의 N교시
   *     - 기출/모의 → session === N
   *     - 합숙     → sessionPart === `${N}교시`
   *   - '1일차'~'8일차': 합숙 일차 (기출/모의는 자동 숨김)
   * 같은 출처에 일차+교시 칩 동시 적용 시 AND.
   */
  sessions: Set<string>;
  /** roundOrder 범위 (inclusive). undefined면 무제한. */
  roundOrderMin?: number;
  roundOrderMax?: number;
}

export type SortMode = 'relevance' | 'newest' | 'oldest';

export interface SearchOptions {
  query: string;
  filters: FilterState;
  /** 최대 결과 수 (성능 보호) */
  limit?: number;
  /** 정렬 모드. 미지정 시 검색어 있으면 'relevance', 없으면 'newest' */
  sort?: SortMode;
}

export interface SearchResult {
  problem: Problem;
  matches?: FuseResult<Problem>['matches'];
  score?: number;
}

const FUSE_OPTIONS: IFuseOptions<Problem> = {
  keys: [
    { name: 'title', weight: 0.6 },
    { name: 'content', weight: 0.4 },
  ],
  threshold: 0.3,
  ignoreLocation: true,
  includeMatches: true,
  includeScore: true,
  minMatchCharLength: 2,
  shouldSort: true,
};

export class SearchIndex {
  private fuse: Fuse<Problem>;
  private all: Problem[];

  constructor(problems: Problem[]) {
    this.all = problems;
    this.fuse = new Fuse(problems, FUSE_OPTIONS);
  }

  search({ query, filters, limit = 200, sort }: SearchOptions): SearchResult[] {
    const q = query.trim();
    const effectiveSort: SortMode = sort ?? (q.length === 0 ? 'newest' : 'relevance');

    // 1) 후보 추출
    let candidates: SearchResult[];
    if (q.length === 0) {
      candidates = this.all.map((p) => ({ problem: p }));
    } else {
      candidates = this.fuse.search(q, { limit: limit * 4 }).map((r) => ({
        problem: r.item,
        matches: r.matches,
        score: r.score,
      }));
    }

    // 2) 정렬
    if (effectiveSort === 'newest' || effectiveSort === 'oldest') {
      const dir = effectiveSort === 'newest' ? -1 : 1;
      const srcOrder: Record<string, number> = { 기출: 0, 합숙: 1, 모의: 2, 자체: 3 };
      candidates.sort((a, b) => {
        const ro = (a.problem.roundOrder - b.problem.roundOrder) * dir;
        if (ro !== 0) return ro;
        const so = (srcOrder[a.problem.sourceType] ?? 99) - (srcOrder[b.problem.sourceType] ?? 99);
        if (so !== 0) return so;
        const qa = a.problem.questionNumber ?? 9999;
        const qb = b.problem.questionNumber ?? 9999;
        return qa - qb;
      });
    }
    // relevance 모드는 Fuse가 이미 score 순으로 정렬해 둠 (검색어 없으면 원본 순서 유지)

    // 3) 필터
    const filtered = candidates.filter((c) => matchesFilters(c.problem, filters));
    return filtered.slice(0, limit);
  }
}

function matchesFilters(p: Problem, f: FilterState): boolean {
  if (f.certScopes.size > 0 && !f.certScopes.has(p.certScope)) return false;
  if (f.sourceTypes.size > 0 && !f.sourceTypes.has(p.sourceType)) return false;
  if (f.academies.size > 0) {
    const aca = p.academy ?? '(없음)';
    if (!f.academies.has(aca)) return false;
  }

  if (f.sessions.size > 0) {
    const numberChips: string[] = [];
    const ilchaChips: string[] = [];
    for (const s of f.sessions) {
      if (/^\d+$/.test(s)) numberChips.push(s);
      else if (s.endsWith('일차')) ilchaChips.push(s);
    }

    if (p.sessionType === '교시') {
      // 기출/모의 — 일차 칩이 켜져있으면 사용자가 합숙만 보려는 의도 → 숨김
      if (ilchaChips.length > 0) return false;
      if (numberChips.length > 0 && !numberChips.includes(p.session)) return false;
    } else {
      // 합숙
      if (ilchaChips.length > 0 && !ilchaChips.includes(p.session)) return false;
      if (numberChips.length > 0) {
        if (!p.sessionPart) return false;
        const gyosiNum = p.sessionPart.replace('교시', '');
        if (!numberChips.includes(gyosiNum)) return false;
      }
    }
  }

  if (f.roundOrderMin !== undefined && p.roundOrder < f.roundOrderMin) return false;
  if (f.roundOrderMax !== undefined && p.roundOrder > f.roundOrderMax) return false;
  return true;
}

export function emptyFilterState(): FilterState {
  return {
    certScopes: new Set(),
    sourceTypes: new Set(),
    academies: new Set(),
    sessions: new Set(),
  };
}
