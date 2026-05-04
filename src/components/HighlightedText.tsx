/**
 * Fuse.js의 매치 indices를 받아 <mark>로 하이라이팅.
 * matches가 없으면 plain text 반환.
 */
import type { FuseResult } from 'fuse.js';

interface Props {
  text: string;
  /** Fuse가 돌려준 indices (해당 key의 매치 정보). null 이면 하이라이트 없음. */
  indices?: ReadonlyArray<readonly [number, number]>;
  /** content를 자를 때 검색어 부근만 보이도록 처리할지 (기본 true) */
  windowed?: boolean;
  /** windowed=true 시 표시할 최대 길이 */
  maxLength?: number;
}

export default function HighlightedText({
  text,
  indices,
  windowed = false,
  maxLength = 200,
}: Props) {
  if (!indices || indices.length === 0) {
    const display = windowed && text.length > maxLength
      ? text.slice(0, maxLength) + '…'
      : text;
    return <>{display}</>;
  }

  // 매치 인덱스를 길이 기준 정렬 후 가장 긴 것 위주로 표시
  const sorted = [...indices].sort((a, b) => a[0] - b[0]);
  const merged = mergeOverlaps(sorted);

  // windowed 처리: 첫 매치 전후로 잘라냄
  let start = 0;
  let end = text.length;
  if (windowed && text.length > maxLength) {
    const first = merged[0][0];
    const margin = Math.floor(maxLength / 3);
    start = Math.max(0, first - margin);
    end = Math.min(text.length, start + maxLength);
    if (end - start < maxLength) start = Math.max(0, end - maxLength);
  }

  const parts: Array<{ text: string; mark: boolean }> = [];
  let cursor = start;
  for (const [s, e] of merged) {
    if (e < start || s > end) continue;
    const ss = Math.max(s, start);
    const ee = Math.min(e + 1, end);
    if (ss > cursor) parts.push({ text: text.slice(cursor, ss), mark: false });
    parts.push({ text: text.slice(ss, ee), mark: true });
    cursor = ee;
  }
  if (cursor < end) parts.push({ text: text.slice(cursor, end), mark: false });

  return (
    <>
      {start > 0 && '…'}
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} className="bg-yellow-200 px-0.5 rounded">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
      {end < text.length && '…'}
    </>
  );
}

function mergeOverlaps(
  ranges: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Fuse 결과 matches 배열에서 특정 key의 indices만 추출 */
export function findIndicesForKey(
  matches: FuseResult<unknown>['matches'] | undefined,
  key: string,
): ReadonlyArray<readonly [number, number]> | undefined {
  if (!matches) return undefined;
  const m = matches.find((x) => x.key === key);
  return m?.indices;
}
