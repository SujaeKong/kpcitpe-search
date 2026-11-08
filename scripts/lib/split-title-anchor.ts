/**
 * 마지막 수단 검출 — 숫자 마커를 전혀 쓰지 않고 **문항 제목만으로** 시작 페이지를 특정한다.
 *
 * 배경 (2026-11-08 전수 조사): 통합본 폴백 512개 중 313개는 시그널이 문항 수를 못 맞춰
 * count 가드로 포기한 건이고, 그중 170개는 1~2문항만 부족했다. 기존 보강
 * (fillMissingRangesByTitle)은 ① 머리말에 `N.` 숫자 마커가 있어야 하고 ② 문항번호가
 * 1..N이라고 가정해서 이 집단에서 한 건도 발동하지 않았다.
 *
 * 제목만 믿는 검출은 위험하다 — 2026-10-03에 분할본 59개가 다른 문항 해설로 연결된 사고가
 * 있었다. 그래서 네 조건을 모두 만족할 때만 쓴다:
 *   ① 전 문항이 **유일하게** 특정된다 (한 페이지에 두 문항 제목이 맞으면 그 페이지는 버림 —
 *      시험문제 목록·표지 페이지 차단)
 *   ② 특정된 페이지가 문항 순서대로 **단조증가** (엑셀과 PDF 문항 순서가 다르면 깨진다.
 *      실측에서 이 조건이 이미 알려진 재분할 금지 회차 8건을 독립적으로 재현했다)
 *   ③ 시그널이 엑셀보다 **많이** 찾은 건은 제외 (엑셀에 문항이 빠진 회차 — 합숙 1교시 다수.
 *      강제로 쪼개면 마지막 분할본이 미등록 문항까지 삼킨다)
 *   ④ 마지막 앵커 뒤 잔여가 너무 길지 않다 (같은 이유)
 * 업로드 시 문항별 내용 검증(matchSplitContent)이 한 번 더 가린다.
 */
import { titleTokens } from './split-content';

export interface AnchorRange { questionNumber: number; startPage: number; endPage: number }

export interface TitleAnchorResult {
  ok: boolean;
  ranges: AnchorRange[];
  /** 로그용 — 성립하면 근거, 아니면 왜 안 되는지 */
  reason: string;
}

export interface TitleAnchorOptions {
  /** 머리말로 볼 글자 수 */
  headChars?: number;
  /** 제목 토큰 일치 하한 */
  minRatio?: number;
  /** 마지막 앵커 뒤 허용 잔여 페이지 */
  maxTailPages?: number;
  /** 시그널이 찾은 문항 수 — 엑셀보다 많으면 포기 */
  signalCount?: number;
}

export function titleAnchorRanges(
  pageTexts: string[],
  titles: string[],
  expectedNumbers: number[],
  { headChars = 800, minRatio = 0.6, maxTailPages = 12, signalCount = 0 }: TitleAnchorOptions = {},
): TitleAnchorResult {
  const n = titles.length;
  if (n === 0 || expectedNumbers.length !== n) return { ok: false, ranges: [], reason: '문항 정보 없음' };
  if (signalCount > n) {
    return { ok: false, ranges: [], reason: `제목 앵커 포기 — 시그널 검출 ${signalCount} > 문항 ${n} (엑셀 문항 누락 의심)` };
  }
  const tokenSets = titles.map(titleTokens);
  if (tokenSets.some((t) => t.length < 2)) {
    return { ok: false, ranges: [], reason: '제목 앵커 포기 — 토큰이 2개 미만인 제목 있음' };
  }

  // 각 문항의 첫 앵커 페이지. 두 제목 이상 맞는 페이지는 앵커로 쓰지 않는다.
  const firstPage = new Map<number, number>();
  for (let i = 0; i < pageTexts.length; i++) {
    const flat = pageTexts[i].slice(0, headChars).replace(/\s+/g, '').toLowerCase();
    const matched: number[] = [];
    for (let t = 0; t < n; t++) {
      const tokens = tokenSets[t];
      if (tokens.filter((tok) => flat.includes(tok)).length / tokens.length >= minRatio) matched.push(t);
    }
    if (matched.length !== 1) continue;
    if (!firstPage.has(matched[0])) firstPage.set(matched[0], i + 1);
  }

  const missing = titles.map((_, i) => i).filter((i) => !firstPage.has(i));
  if (missing.length > 0) {
    return { ok: false, ranges: [], reason: `제목 앵커 포기 — ${n}문항 중 ${missing.length}개 특정 실패` };
  }
  const pages = titles.map((_, i) => firstPage.get(i) as number);
  const increasing = pages.every((p, i) => i === 0 || p > pages[i - 1]);
  if (!increasing) {
    return { ok: false, ranges: [], reason: `제목 앵커 포기 — 페이지 순서가 문항 순서와 다름 [${pages.join(',')}] (엑셀·PDF 문항 순서 불일치)` };
  }
  const tail = pageTexts.length - pages[n - 1];
  if (tail > maxTailPages) {
    return { ok: false, ranges: [], reason: `제목 앵커 포기 — 마지막 앵커(p${pages[n - 1]}) 뒤 ${tail}p 남음 (허용 ${maxTailPages}p, 미등록 문항 의심)` };
  }

  const sortedNumbers = [...expectedNumbers].sort((a, b) => a - b);
  const ranges = pages.map((p, i) => ({
    questionNumber: sortedNumbers[i],
    startPage: p,
    endPage: i + 1 < n ? pages[i + 1] - 1 : pageTexts.length,
  }));
  return { ok: true, ranges, reason: `제목 앵커로 ${n}문항 특정 p[${pages.join(',')}]` };
}
