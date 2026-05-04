/**
 * localStorage 기반 검색 히스토리.
 * 최근 10개, 중복 제거, 2자 이상.
 */
const KEY = 'kpcitpe.search-history';
const MAX_ITEMS = 10;
const MIN_LENGTH = 2;

export interface HistoryEntry {
  query: string;
  ts: number;
}

function read(): HistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: HistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota 초과 등 무시 */
  }
}

export function listHistory(): HistoryEntry[] {
  return read();
}

export function addHistory(query: string): void {
  const q = query.trim();
  if (q.length < MIN_LENGTH) return;
  const next = [{ query: q, ts: Date.now() }, ...read().filter((e) => e.query !== q)];
  write(next.slice(0, MAX_ITEMS));
}

export function removeHistory(query: string): void {
  write(read().filter((e) => e.query !== query));
}

export function clearHistory(): void {
  write([]);
}
