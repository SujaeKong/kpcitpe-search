import type { FilterState } from '../lib/search';
import type { CertScope, SourceType } from '../lib/types';

export interface RoundOption {
  order: number;
  label: string;
}

export interface RoundGroup {
  sourceType: SourceType;
  rounds: RoundOption[];
}

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  /** 사용 가능한 옵션 — 데이터에서 추출됨 */
  options: {
    certScopes: CertScope[];
    sourceTypes: SourceType[];
    academies: string[];
    /** 통합 교시 칩 (예: '1', '2', '3', '4'). 합숙·기출·모의 공통 의미. */
    gyosi: string[];
    /** 합숙 일차 (예: '1일차'~'8일차') */
    ilcha: string[];
    /** sourceType별 회차 옵션 (회차 범위 dropdown용) */
    roundsByType: RoundGroup[];
  };
}

export default function FilterPanel({ filters, onChange, options }: Props) {
  const toggle = <T extends string>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const resetAll = () =>
    onChange({
      certScopes: new Set(),
      sourceTypes: new Set(),
      academies: new Set(),
      sessions: new Set(),
      roundOrderMin: undefined,
      roundOrderMax: undefined,
    });

  const totalActive =
    filters.certScopes.size +
    filters.sourceTypes.size +
    filters.academies.size +
    filters.sessions.size +
    (filters.roundOrderMin !== undefined ? 1 : 0) +
    (filters.roundOrderMax !== undefined ? 1 : 0);

  return (
    <aside className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <Group label="자격증">
        {options.certScopes.map((c) => (
          <Chip
            key={c}
            active={filters.certScopes.has(c)}
            onClick={() =>
              onChange({ ...filters, certScopes: toggle(filters.certScopes, c) })
            }
          >
            {c}
          </Chip>
        ))}
      </Group>

      <Group label="출처">
        {options.sourceTypes.map((s) => (
          <Chip
            key={s}
            active={filters.sourceTypes.has(s)}
            onClick={() =>
              onChange({ ...filters, sourceTypes: toggle(filters.sourceTypes, s) })
            }
          >
            {s}
          </Chip>
        ))}
      </Group>

      <Group label="학원">
        {options.academies.map((a) => (
          <Chip
            key={a}
            active={filters.academies.has(a)}
            onClick={() =>
              onChange({ ...filters, academies: toggle(filters.academies, a) })
            }
          >
            {a}
          </Chip>
        ))}
      </Group>

      {options.gyosi.length > 0 && (
        <Group label="교시">
          {options.gyosi.map((s) => (
            <Chip
              key={s}
              active={filters.sessions.has(s)}
              onClick={() =>
                onChange({ ...filters, sessions: toggle(filters.sessions, s) })
              }
            >
              {s}교시
            </Chip>
          ))}
        </Group>
      )}

      {options.ilcha.length > 0 && (
        <Group label="합숙 일차">
          {options.ilcha.map((s) => (
            <Chip
              key={s}
              active={filters.sessions.has(s)}
              onClick={() =>
                onChange({ ...filters, sessions: toggle(filters.sessions, s) })
              }
            >
              {s}
            </Chip>
          ))}
        </Group>
      )}

      {options.roundsByType.length > 0 && (
        <Group label="회차 범위">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <select
              value={filters.roundOrderMin ?? ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  roundOrderMin: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              className="rounded border border-gray-300 bg-white px-2 py-1"
            >
              <option value="">처음부터</option>
              {options.roundsByType.map((g) => (
                <optgroup key={g.sourceType} label={g.sourceType}>
                  {g.rounds.map((r) => (
                    <option key={`${g.sourceType}-${r.order}`} value={r.order}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="text-gray-400">~</span>
            <select
              value={filters.roundOrderMax ?? ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  roundOrderMax: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              className="rounded border border-gray-300 bg-white px-2 py-1"
            >
              <option value="">끝까지</option>
              {options.roundsByType.map((g) => (
                <optgroup key={g.sourceType} label={g.sourceType}>
                  {g.rounds.map((r) => (
                    <option key={`${g.sourceType}-${r.order}`} value={r.order}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </Group>
      )}

      {totalActive > 0 && (
        <button
          type="button"
          onClick={resetAll}
          className="text-xs text-gray-500 underline hover:text-gray-700"
        >
          필터 초기화
        </button>
      )}
    </aside>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-gray-500">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  );
}
