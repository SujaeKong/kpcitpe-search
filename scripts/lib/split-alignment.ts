/**
 * 분할 구간 ↔ 엑셀 문항 제목 정렬 검사. split-pdfs.ts에서 분리 — 순환 import 없이
 * 번호 재배정(split-renumber.ts)·감사 스크립트에서도 같은 판정을 쓴다.
 */
import { titleTokens } from './split-content';

/**
 * 분할 구간 첫 페이지 텍스트(rangeTexts[i])가 짝지은 문항 제목(titles[i])과 맞는지 검사.
 * titles[i + offset]과 가장 잘 맞는 offset(-2..2)을 돌려준다 — 0이 아니면 한 칸씩 어긋난 분할
 * (옛 형식 off-by-one, PROJECT.md §10). 텍스트가 없거나 근거가 없으면 동점 → 0.
 */
export function checkTitleAlignment(rangeTexts: string[], titles: string[]): { bestOffset: number; scores: Record<number, number> } {
  const texts = rangeTexts.map((t) => t.replace(/\s+/g, '').toLowerCase());
  const tokenSets = titles.map(titleTokens);
  const scores: Record<number, number> = {};
  for (const offset of [0, -1, 1, -2, 2]) {
    let score = 0;
    texts.forEach((text, i) => {
      const tokens = tokenSets[i + offset];
      if (!tokens?.length) return;
      if (tokens.filter((t) => text.includes(t)).length / tokens.length >= 0.5) score++;
    });
    scores[offset] = score;
  }
  const bestOffset = [0, -1, 1, -2, 2].reduce((best, o) => (scores[o] > scores[best] ? o : best), 0);
  return { bestOffset, scores };
}
