/**
 * 검출 번호가 쪽번호인 해설집 구제 — 구간은 맞고 번호만 잘못 읽은 경우 위치순으로 다시 매긴다.
 *
 * 배경 (2026-11-07 전수 감사 720개):
 * sequence 가드로 분할을 포기한 169개 해설집이 **전부 시그널 kpc-mungje**였다. 이 PDF들의
 * 페이지 머리말은 "104 회 … Notes 9 KPC 기술사회 3 파이프라인 해저드 문제"처럼
 * [쪽번호] … [문항번호] [제목] 문제 순이고, 시그널 정규식이 앞쪽 쪽번호부터 삼켜
 * 안쪽의 올바른 후보를 못 만든다. 결과는 6문항을 정확히 6개 찾아놓고 번호만
 * [1,5,9,12,16,19]로 읽는 것 — 구간은 맞다.
 *
 * 그래서 번호를 버리고 시작 페이지 순서대로 엑셀 문항번호를 다시 매긴다. 다만 이 재배정은
 * **제목 정렬이 그 짝짓기를 증명할 때만** 한다. 2026-10-03에 분할본 59개가 다른 문항의
 * 해설로 연결된 사고가 있었고, 그 원인이 "번호만 보고 짝지었다"였다. 여기서는
 *   offset 0이 최고점이고, 그 점수가 문항 수의 60% 이상이며, 다른 offset보다 엄격히 높을 때
 * 만 재배정한다. 업로드 시 문항별 내용 검증(matchSplitContent)이 한 번 더 가린다.
 */
import { checkTitleAlignment } from './split-alignment';

export interface RangeLike { questionNumber: number; startPage: number; endPage: number }

export interface RenumberResult<T extends RangeLike> {
  ranges: T[];
  /** 재배정했는가 */
  renumbered: boolean;
  /** 로그에 남길 사유 — 재배정했으면 근거, 안 했으면 왜 안 했는지 */
  note?: string;
}

/**
 * @param ranges 검출 구간 (순서 무관)
 * @param pageTexts 페이지별 텍스트 (1-based startPage로 접근)
 * @param titles 엑셀 문항 제목 — 문항번호 오름차순
 * @param expectedNumbers 엑셀 문항번호 — titles와 같은 순서
 */
export function renumberRangesByPosition<T extends RangeLike>(
  ranges: T[],
  pageTexts: string[],
  titles: string[],
  expectedNumbers: number[],
  { minRatio = 0.6 }: { minRatio?: number } = {},
): RenumberResult<T> {
  if (ranges.length === 0 || ranges.length !== titles.length || titles.length !== expectedNumbers.length) {
    return { ranges, renumbered: false };
  }
  const current = [...ranges].map((r) => r.questionNumber).sort((a, b) => a - b);
  const expected = [...expectedNumbers].sort((a, b) => a - b);
  // 번호가 이미 엑셀과 같으면 손댈 이유가 없다
  if (current.every((n, i) => n === expected[i])) return { ranges, renumbered: false };

  const byPage = [...ranges].sort((a, b) => a.startPage - b.startPage);
  const { bestOffset, scores } = checkTitleAlignment(byPage.map((r) => pageTexts[r.startPage - 1] ?? ''), titles);
  const hit = scores[0] ?? 0;
  const need = Math.ceil(titles.length * minRatio);
  const others = [-2, -1, 1, 2].map((o) => scores[o] ?? 0);
  if (bestOffset !== 0 || hit < need || others.some((s) => s >= hit)) {
    return {
      ranges,
      renumbered: false,
      note: `번호 재배정 보류 — 제목 정렬 근거 부족 (offset ${bestOffset}, 점수 ${JSON.stringify(scores)}, 필요 ${need}/${titles.length})`,
    };
  }
  // 페이지 순서 ↔ 엑셀 문항번호 오름차순 1:1
  const sortedExpected = [...expectedNumbers].sort((a, b) => a - b);
  return {
    ranges: byPage.map((r, i) => ({ ...r, questionNumber: sortedExpected[i] })),
    renumbered: true,
    note: `번호 위치순 재배정 [${current.join(',')}] → [${sortedExpected.join(',')}] (제목 일치 ${hit}/${titles.length})`,
  };
}
