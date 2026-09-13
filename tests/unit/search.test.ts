/**
 * 검색(SearchIndex): 정렬, Fuse 검색, 필터(종목/출처/학원/교시·일차/회차 범위).
 */
import { describe, expect, it } from 'vitest';
import { emptyFilterState, SearchIndex, type FilterState } from '../../src/lib/search';
import { makeProblem } from '../helpers/problem-fixture';

const k140a = makeProblem({ id: 'k140a', title: '쿠버네티스 오토스케일링', questionNumber: 1 });
const k140b = makeProblem({ id: 'k140b', certScope: '컴시응', session: '2', questionNumber: 3, title: 'GPU 병렬 처리' });
const h08a = makeProblem({
  id: 'h08a', sourceType: '합숙', academy: 'KPC', certScope: '공통', round: '2026.08', roundLabel: '합숙_2026.08',
  session: '1일차', sessionType: '일차', sessionPart: '1교시', questionNumber: 2, title: '블록체인 합의 알고리즘',
});
const h08b = makeProblem({
  id: 'h08b', sourceType: '합숙', academy: 'KPC', certScope: '공통', round: '2026.08', roundLabel: '합숙_2026.08',
  session: '2일차', sessionType: '일차', sessionPart: '2교시', questionNumber: 1, title: '제로 트러스트 아키텍처',
});
const m07 = makeProblem({
  id: 'm07', sourceType: '모의', academy: 'KPC', certScope: '공통', round: '2026.07', roundLabel: '모의_2026.07',
  roundOrder: 20260700, session: '2', questionNumber: 5, title: '쿠버네티스 네트워크 정책',
});
const k139 = makeProblem({ id: 'k139', round: '139', roundLabel: '139회', roundOrder: 20260500, session: '2', questionNumber: 4, title: 'LLM 환각 대응' });
const k87 = makeProblem({ id: 'k87', round: '87', roundLabel: '87회', roundOrder: 20090200, questionNumber: 2, title: 'OCL 제약 언어' });

const index = new SearchIndex([k87, h08a, m07, k140b, h08b, k139, k140a]);

function ids(opts: { query?: string; filters?: Partial<FilterState>; sort?: 'relevance' | 'newest' | 'oldest'; limit?: number }) {
  return index
    .search({ query: opts.query ?? '', filters: { ...emptyFilterState(), ...opts.filters }, sort: opts.sort, limit: opts.limit })
    .map((r) => r.problem.id);
}

describe('정렬', () => {
  it('S1: 검색어 없으면 최신순 — 회차 내림차순, 같은 시점은 기출→합숙→모의, 그다음 문항번호', () => {
    expect(ids({})).toEqual(['k140a', 'k140b', 'h08b', 'h08a', 'm07', 'k139', 'k87']);
  });

  it('S2: 오래된순은 회차 오름차순', () => {
    expect(ids({ sort: 'oldest' })).toEqual(['k87', 'k139', 'm07', 'k140a', 'k140b', 'h08b', 'h08a']);
  });
});

describe('검색어', () => {
  it('S3: 제목 키워드로 찾고 하이라이트용 matches를 돌려준다', () => {
    const results = index.search({ query: '쿠버네티스', filters: emptyFilterState() });
    expect(results.map((r) => r.problem.id).sort()).toEqual(['k140a', 'm07']);
    for (const r of results) expect(r.matches?.some((m) => m.key === 'title')).toBe(true);
  });

  it('S4: 검색어 + 최신순 정렬 조합', () => {
    expect(ids({ query: '쿠버네티스', sort: 'newest' })).toEqual(['k140a', 'm07']);
  });

  it('S5: 공백만 있는 검색어는 전체 목록', () => {
    expect(ids({ query: '   ' })).toHaveLength(7);
  });
});

describe('필터', () => {
  it('S6: 종목·출처 필터', () => {
    expect(ids({ filters: { certScopes: new Set(['컴시응']) } })).toEqual(['k140b']);
    expect(ids({ filters: { sourceTypes: new Set(['합숙']) } })).toEqual(['h08b', 'h08a']);
  });

  it('S7: 학원 필터 — (없음)은 기출(academy=null)', () => {
    expect(ids({ filters: { academies: new Set(['(없음)']) } })).toEqual(['k140a', 'k140b', 'k139', 'k87']);
    expect(ids({ filters: { academies: new Set(['KPC']) } })).toEqual(['h08b', 'h08a', 'm07']);
  });

  it('S8: 교시 칩 "2" — 기출/모의는 session 2, 합숙은 2교시', () => {
    expect(ids({ filters: { sessions: new Set(['2']) } })).toEqual(['k140b', 'h08b', 'm07', 'k139']);
  });

  it('S9: 일차 칩은 합숙만 남기고, 일차+교시 칩은 AND', () => {
    expect(ids({ filters: { sessions: new Set(['1일차']) } })).toEqual(['h08a']);
    expect(ids({ filters: { sessions: new Set(['2일차', '2']) } })).toEqual(['h08b']);
    expect(ids({ filters: { sessions: new Set(['1일차', '2']) } })).toEqual([]);
  });

  it('S10: 회차 범위는 양 끝 포함', () => {
    expect(ids({ filters: { roundOrderMin: 20260500, roundOrderMax: 20260700 } })).toEqual(['m07', 'k139']);
  });

  it('S11: limit만큼만 반환', () => {
    expect(ids({ limit: 2 })).toEqual(['k140a', 'k140b']);
  });
});
