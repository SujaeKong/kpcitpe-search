import { useEffect, useMemo, useRef, useState } from 'react';
import { loadProblems } from '../lib/data-loader';
import {
  emptyFilterState,
  SearchIndex,
  type FilterState,
  type SearchResult,
  type SortMode,
} from '../lib/search';
import type { CertScope, Problem, SourceType } from '../lib/types';
import SearchBar from './SearchBar';
import FilterPanel from './FilterPanel';
import ProblemCard from './ProblemCard';
import SortBar from './SortBar';

const RESULT_LIMIT = 200;
const PAGE_SIZE = 30;

export default function SearchApp() {
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // URL → 초기 상태 (한 번만)
  const initialUrl = useMemo(() => parseUrlState(), []);
  const [query, setQuery] = useState<string>(initialUrl.query);
  const [filters, setFilters] = useState<FilterState>(initialUrl.filters);
  const [sortMode, setSortMode] = useState<SortMode | undefined>(initialUrl.sort);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [filtersOpen, setFiltersOpen] = useState(false); // 모바일 drawer

  // 데이터 로드
  useEffect(() => {
    let cancel = false;
    loadProblems()
      .then((p) => {
        if (!cancel) setProblems(p);
      })
      .catch((err) => {
        if (!cancel) setLoadError(err.message ?? String(err));
      });
    return () => {
      cancel = true;
    };
  }, []);

  // SearchIndex 인스턴스 (problems 로드 시 1회 생성)
  const index = useMemo(
    () => (problems ? new SearchIndex(problems) : null),
    [problems],
  );

  // 옵션 추출 (필터 패널용)
  const options = useMemo(() => extractOptions(problems ?? []), [problems]);

  // 검색 실행
  const results: SearchResult[] = useMemo(() => {
    if (!index) return [];
    return index.search({ query, filters, limit: RESULT_LIMIT, sort: sortMode });
  }, [index, query, filters, sortMode]);

  // URL 동기화 (state → URL)
  const skipUrlWrite = useRef(true);
  useEffect(() => {
    if (skipUrlWrite.current) {
      skipUrlWrite.current = false;
      return;
    }
    writeUrlState(query, filters, sortMode);
  }, [query, filters, sortMode]);

  // 페이지 사이즈 리셋 (검색/필터 변경 시)
  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [query, filters, sortMode]);

  // 필터 적용 시 모바일 drawer 자동 닫힘 (사용자가 결과 보고 싶음)
  const filterCount =
    filters.certScopes.size +
    filters.sourceTypes.size +
    filters.academies.size +
    filters.sessions.size +
    (filters.roundOrderMin !== undefined ? 1 : 0) +
    (filters.roundOrderMax !== undefined ? 1 : 0);

  const visible = results.slice(0, pageSize);
  const hasMore = pageSize < results.length;

  return (
    <div className="space-y-4">
      <SearchBar initial={initialUrl.query} onChange={setQuery} />

      {/* 모바일 필터 토글 + 정렬 */}
      <div className="flex flex-wrap items-center justify-between gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          ☰ 필터{filterCount > 0 && (
            <span className="ml-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-600 px-1 text-xs font-medium text-white">
              {filterCount}
            </span>
          )}
        </button>
        <SortBar
          value={sortMode ?? (query.trim() ? 'relevance' : 'newest')}
          onChange={setSortMode}
          disableRelevance={!query.trim()}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
        {/* 데스크탑: 사이드바, 모바일: drawer */}
        <div className="hidden md:block">
          <FilterPanel filters={filters} onChange={setFilters} options={options} />
        </div>
        {filtersOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setFiltersOpen(false)}
          >
            <div
              className="absolute inset-y-0 right-0 w-80 max-w-full overflow-y-auto bg-gray-50 p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">필터</h2>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-white"
                >
                  ✕
                </button>
              </div>
              <FilterPanel filters={filters} onChange={setFilters} options={options} />
            </div>
          </div>
        )}

        <section>
          <div className="mb-2 hidden items-center justify-between md:flex">
            <ResultsHeader
              loading={!problems && !loadError}
              error={loadError}
              total={problems?.length ?? 0}
              shown={results.length}
              query={query}
            />
            <SortBar
              value={sortMode ?? (query.trim() ? 'relevance' : 'newest')}
              onChange={setSortMode}
              disableRelevance={!query.trim()}
            />
          </div>
          <div className="md:hidden">
            <ResultsHeader
              loading={!problems && !loadError}
              error={loadError}
              total={problems?.length ?? 0}
              shown={results.length}
              query={query}
            />
          </div>
          <ul className="mt-3 space-y-3">
            {visible.map((r) => (
              <li key={r.problem.id}>
                <ProblemCard result={r} />
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setPageSize((s) => s + PAGE_SIZE)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50"
              >
                더 보기 ({results.length - pageSize}건 남음)
              </button>
            </div>
          )}
          {!loadError && problems && results.length === 0 && (
            <p className="mt-6 rounded border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
              검색 결과가 없습니다. 검색어 또는 필터를 조정해 보세요.
            </p>
          )}
          {results.length === RESULT_LIMIT && (
            <p className="mt-3 text-xs text-gray-500">
              결과가 {RESULT_LIMIT}건을 초과해 일부만 표시됩니다. 검색어를 더 구체화해 주세요.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function ResultsHeader({
  loading,
  error,
  total,
  shown,
  query,
}: {
  loading: boolean;
  error: string | null;
  total: number;
  shown: number;
  query: string;
}) {
  if (loading) return <p className="text-sm text-gray-500">데이터 로딩 중…</p>;
  if (error) return <p className="text-sm text-red-600">로딩 실패: {error}</p>;
  if (query.trim()) {
    return (
      <p className="text-sm text-gray-600">
        <strong className="text-gray-900">{shown.toLocaleString()}</strong>건 검색됨 / 전체 {total.toLocaleString()}건
      </p>
    );
  }
  return (
    <p className="text-sm text-gray-600">
      전체 <strong className="text-gray-900">{total.toLocaleString()}</strong>건 (필터 적용 후 {shown.toLocaleString()}건)
    </p>
  );
}

// ===== 옵션 추출 =====

function extractOptions(problems: Problem[]) {
  const certScopes = new Set<CertScope>();
  const sourceTypes = new Set<SourceType>();
  const academies = new Set<string>();
  const gyosiSet = new Set<string>();   // 통합 교시
  const ilchaSet = new Set<string>();   // 합숙 일차
  // sourceType별 회차 (label, order) 추출 — Map으로 dedup
  const roundMaps = new Map<SourceType, Map<number, string>>();

  for (const p of problems) {
    certScopes.add(p.certScope);
    sourceTypes.add(p.sourceType);
    academies.add(p.academy ?? '(없음)');
    if (p.sessionType === '교시') {
      gyosiSet.add(p.session);
    } else {
      ilchaSet.add(p.session);
      if (p.sessionPart) {
        gyosiSet.add(p.sessionPart.replace('교시', ''));
      }
    }
    let rm = roundMaps.get(p.sourceType);
    if (!rm) {
      rm = new Map();
      roundMaps.set(p.sourceType, rm);
    }
    if (!rm.has(p.roundOrder)) rm.set(p.roundOrder, p.roundLabel);
  }

  const certOrder: CertScope[] = ['정보관리', '컴시응', '공통'];
  const sourceOrder: SourceType[] = ['기출', '합숙', '모의', '자체'];
  const numericPrefix = (s: string) => {
    const m = s.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 999;
  };

  // sourceType별 회차 그룹 (최신순)
  const roundsByType = sourceOrder
    .filter((s) => roundMaps.has(s))
    .map((sourceType) => {
      const rm = roundMaps.get(sourceType)!;
      const rounds = [...rm.entries()]
        .sort((a, b) => b[0] - a[0]) // 최신 회차 우선
        .map(([order, label]) => ({ order, label }));
      return { sourceType, rounds };
    });

  return {
    certScopes: certOrder.filter((c) => certScopes.has(c)),
    sourceTypes: sourceOrder.filter((s) => sourceTypes.has(s)),
    academies: [...academies].sort(),
    gyosi: [...gyosiSet].sort((a, b) => numericPrefix(a) - numericPrefix(b)),
    ilcha: [...ilchaSet].sort((a, b) => numericPrefix(a) - numericPrefix(b)),
    roundsByType,
  };
}

// ===== URL 동기화 =====

interface UrlState {
  query: string;
  filters: FilterState;
  sort?: SortMode;
}

function parseUrlState(): UrlState {
  if (typeof window === 'undefined') {
    return { query: '', filters: emptyFilterState() };
  }
  const sp = new URLSearchParams(window.location.search);
  const filters = emptyFilterState();
  const setFromCsv = <T extends string>(key: string, into: Set<T>) => {
    const v = sp.get(key);
    if (!v) return;
    for (const item of v.split(',')) {
      if (item) into.add(item as T);
    }
  };
  setFromCsv('cert', filters.certScopes);
  setFromCsv('type', filters.sourceTypes);
  setFromCsv('academy', filters.academies);
  setFromCsv('session', filters.sessions);

  const rmin = sp.get('rmin');
  const rmax = sp.get('rmax');
  if (rmin) filters.roundOrderMin = Number(rmin);
  if (rmax) filters.roundOrderMax = Number(rmax);

  const rawSort = sp.get('sort');
  const sort: SortMode | undefined =
    rawSort === 'relevance' || rawSort === 'newest' || rawSort === 'oldest' ? rawSort : undefined;

  return { query: sp.get('q') ?? '', filters, sort };
}

function writeUrlState(query: string, filters: FilterState, sort: SortMode | undefined) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams();
  if (query.trim()) sp.set('q', query.trim());
  if (filters.certScopes.size) sp.set('cert', [...filters.certScopes].join(','));
  if (filters.sourceTypes.size) sp.set('type', [...filters.sourceTypes].join(','));
  if (filters.academies.size) sp.set('academy', [...filters.academies].join(','));
  if (filters.sessions.size) sp.set('session', [...filters.sessions].join(','));
  if (filters.roundOrderMin !== undefined) sp.set('rmin', String(filters.roundOrderMin));
  if (filters.roundOrderMax !== undefined) sp.set('rmax', String(filters.roundOrderMax));
  if (sort) sp.set('sort', sort);
  const qs = sp.toString();
  const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', newUrl);
}
