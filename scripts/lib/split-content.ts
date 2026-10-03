/**
 * 분할본 PDF의 **내용**이 연결된 엑셀 문항과 맞는지 판정.
 *
 * 기존 검증들이 못 잡는 구멍을 메운다:
 *  - 분할본 파일명은 엑셀 제목으로 붙이므로 파일명으로는 내용을 알 수 없다.
 *  - splitter의 자체검증(validateSplit)은 "PDF 내부 번호 N의 마커가 있는지"만 본다.
 *    PDF 내부 번호와 엑셀 문항번호가 다르게 짝지어지면(페이지 순서 ↔ 엑셀 번호 순서
 *    1:1 매핑) 엉뚱한 문항의 분할본이 그 번호로 저장돼도 검증을 통과한다.
 *    (실제 사례: 모의 2026.06 2교시 4번에 8번 NPU 해설이 연결됨)
 *  - 정렬 감사(audit-split-alignment)는 통합본을 다시 재는 것이라 이미 올라간
 *    분할본 파일의 내용은 보지 않는다.
 *
 * 그래서 분할본 첫 페이지 텍스트를 그 교시의 모든 문항 제목과 대조해
 * "가장 잘 맞는 문항"이 연결된 문항인지 확인한다.
 */
const TITLE_STOPWORDS = new Set([
  '설명하시오', '대하여', '대해', '대해서', '다음', '비교하시오', '제시하시오', '기술하시오', '서술하시오',
  '설명', '관하여', '관련', '위한', '하시오', '답하시오', '물음에', '제시된', '있는', '그리고',
]);

/** 문항 제목의 핵심 토큰 (2자 이상 한글·영숫자, 흔한 서술어 제외, 소문자) */
export function titleTokens(title: string): string[] {
  const tokens = (title.match(/[A-Za-z0-9]{2,}|[가-힣]{2,}/g) ?? []).map((t) => t.toLowerCase());
  return [...new Set(tokens.filter((t) => !TITLE_STOPWORDS.has(t)))];
}

export interface SplitContentMatch {
  /** 가장 잘 맞는 제목의 인덱스 (titles 기준). 근거가 없으면 -1 */
  bestIndex: number;
  /** bestIndex의 토큰 일치 비율 (0~1) */
  bestScore: number;
  /** 연결된 문항(expectedIndex)의 토큰 일치 비율 */
  expectedScore: number;
  /** 판정: ok=연결된 문항이 최고점, mismatch=다른 문항이 더 맞음, weak=근거 부족 */
  verdict: 'ok' | 'mismatch' | 'weak';
}

/** 제목 토큰이 텍스트에 얼마나 들어 있는지 (0~1). 토큰이 2개 미만이면 판정 불가로 0 */
export function titleScore(text: string, title: string): number {
  const tokens = titleTokens(title);
  if (tokens.length < 2) return 0;
  const flat = text.replace(/\s+/g, '').toLowerCase();
  return tokens.filter((t) => flat.includes(t)).length / tokens.length;
}

/**
 * 분할본 텍스트가 expectedIndex 문항의 것인지 판정.
 * 다른 문항이 뚜렷하게(+0.2 이상) 더 맞으면 mismatch, 어느 쪽도 0.5 미만이면 weak.
 */
export function matchSplitContent(text: string, titles: string[], expectedIndex: number): SplitContentMatch {
  const scores = titles.map((t) => titleScore(text, t));
  const expectedScore = scores[expectedIndex] ?? 0;
  let bestIndex = -1;
  let bestScore = 0;
  scores.forEach((s, i) => {
    if (s > bestScore) {
      bestScore = s;
      bestIndex = i;
    }
  });

  if (expectedScore >= 0.5 && bestScore - expectedScore < 0.2) return { bestIndex, bestScore, expectedScore, verdict: 'ok' };
  if (bestScore >= 0.5 && bestIndex !== expectedIndex) return { bestIndex, bestScore, expectedScore, verdict: 'mismatch' };
  return { bestIndex, bestScore, expectedScore, verdict: 'weak' };
}
