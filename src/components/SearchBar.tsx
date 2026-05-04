import { useEffect, useRef, useState } from 'react';

interface Props {
  initial?: string;
  /** debounce 후 호출됨 */
  onChange: (value: string) => void;
  /** debounce 시간 (ms) */
  debounceMs?: number;
  placeholder?: string;
}

export default function SearchBar({
  initial = '',
  onChange,
  debounceMs = 200,
  placeholder = '키워드 검색 (예: 쿠버네티스)',
}: Props) {
  const [value, setValue] = useState(initial);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(value), debounceMs);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [value, debounceMs, onChange]);

  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        aria-label="검색"
      />
    </div>
  );
}
