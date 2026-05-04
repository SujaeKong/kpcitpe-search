import type { SortMode } from '../lib/search';

interface Props {
  value: SortMode;
  onChange: (next: SortMode) => void;
  /** 검색어 비어있으면 'relevance' 옵션 비활성 */
  disableRelevance?: boolean;
}

const OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'relevance', label: '관련도' },
  { value: 'newest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
];

export default function SortBar({ value, onChange, disableRelevance }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white p-0.5 text-xs">
      {OPTIONS.map((opt) => {
        const disabled = disableRelevance && opt.value === 'relevance';
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            className={`rounded px-2 py-1 transition-colors ${
              active
                ? 'bg-indigo-600 text-white'
                : disabled
                  ? 'cursor-not-allowed text-gray-300'
                  : 'text-gray-600 hover:bg-gray-100'
            }`}
            title={disabled ? '검색어 입력 시 사용' : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
