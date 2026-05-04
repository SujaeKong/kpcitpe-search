import { useEffect, useRef, useState } from 'react';
import {
  addHistory,
  clearHistory,
  listHistory,
  removeHistory,
  type HistoryEntry,
} from '../lib/search-history';

interface Props {
  initial?: string;
  /** debounce 후 호출됨 */
  onChange: (value: string) => void;
  /** debounce 시간 (ms) */
  debounceMs?: number;
  placeholder?: string;
}

const HISTORY_SAVE_DELAY = 1500; // 사용자가 1.5초간 입력 멈추면 저장

export default function SearchBar({
  initial = '',
  onChange,
  debounceMs = 200,
  placeholder = '키워드 검색 (예: 쿠버네티스)',
}: Props) {
  const [value, setValue] = useState(initial);
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onChangeTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  // 마운트 시 히스토리 로드
  useEffect(() => {
    setHistory(listHistory());
  }, []);

  // value 변경 → debounced onChange
  useEffect(() => {
    if (onChangeTimer.current) window.clearTimeout(onChangeTimer.current);
    onChangeTimer.current = window.setTimeout(() => onChange(value), debounceMs);
    return () => {
      if (onChangeTimer.current) window.clearTimeout(onChangeTimer.current);
    };
  }, [value, debounceMs, onChange]);

  // value 변경 후 1.5초 stable → 히스토리에 저장
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (!value.trim()) return;
    saveTimer.current = window.setTimeout(() => {
      addHistory(value);
      setHistory(listHistory());
    }, HISTORY_SAVE_DELAY);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [value]);

  // 외부 클릭 시 dropdown 닫힘
  useEffect(() => {
    if (!focused) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [focused]);

  const dropdownVisible = focused && history.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        aria-label="검색"
      />
      {dropdownVisible && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-xs text-gray-500">
            <span>최근 검색어</span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                clearHistory();
                setHistory([]);
                setFocused(false);
              }}
              className="hover:text-gray-700 hover:underline"
            >
              전체 지우기
            </button>
          </div>
          <ul>
            {history.map((h) => (
              <li
                key={h.query}
                className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-gray-50"
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setValue(h.query);
                    setFocused(false);
                  }}
                  className="flex-1 truncate text-left text-gray-700"
                >
                  <span className="mr-1.5 text-gray-400">↻</span>
                  {h.query}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    removeHistory(h.query);
                    setHistory(listHistory());
                  }}
                  aria-label={`${h.query} 삭제`}
                  className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
