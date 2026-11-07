/**
 * 통합본 폴백 원인 분류 — "이 해설집은 왜 문항별로 안 쪼개졌나"를 한 단어로 answer한다.
 *
 * 기존 텍스트 레이어 감사는 검출 **수**만 보고 원인을 추정해서, 빈 페이지가 1~2장 있고
 * 누락이 10문항인 경우까지 'blank-pages'(= OCR로 풀림)로 분류해 OCR 효과를 과대계상했다.
 * 여기서는 실제 분할 가드(checkSplitGuards)가 돌려준 reason을 받아 분류한다.
 */

/** 가드가 돌려주는 중단 사유 (checkSplitGuards의 reason) */
export type GuardReason = 'none' | 'count' | 'sequence' | 'alignment';

export type FallbackCause =
  /** 재분할 금지 회차 — 통합본이 의도된 상태(PROJECT.md §10) */
  | 'no-resplit'
  /** 페이지 절반 이상에 글자가 없음 — 스캔 PDF, 텍스트 기반 검출 원리상 불가 */
  | 'image-heavy'
  /** 글자는 있는데 어떤 시그널도 ≥3문항을 못 잡음 — 옛/비표준 서식 */
  | 'no-signal'
  /** 검출 수 부족분이 빈 페이지 수로 설명됨 — OCR 도입 후보 */
  | 'ocr-candidate'
  /** 검출 수 부족이 빈 페이지로 설명 안 됨 — 서식 미지원(시그널 보강 대상) */
  | 'detect-gap'
  /** 수는 맞는데 번호가 1..N 연속이 아님 — 페이지번호 오인 의심 */
  | 'sequence'
  /** 수·번호는 맞는데 구간↔문항 제목이 어긋남 — 엑셀과 PDF 문항 순서 불일치 */
  | 'alignment'
  /** 가드를 통과함 — 분할 가능한데 아직 안 올라간 상태 */
  | 'ok';

export interface FallbackInput {
  /** NO_RESPLIT_KEYS에 든 키인가 */
  noResplit: boolean;
  pages: number;
  /** 글자가 거의 없는(이미지) 페이지 수 */
  blanks: number;
  /** detectRanges가 못 잡은 문항 수 */
  undetected: number;
  /** checkSplitGuards의 reason. 가드를 통과했으면 undefined */
  guardReason?: GuardReason;
}

export function classifyFallback(i: FallbackInput): FallbackCause {
  if (i.noResplit) return 'no-resplit';
  if (!i.guardReason) return 'ok';
  switch (i.guardReason) {
    case 'none':
      return i.blanks * 2 >= i.pages ? 'image-heavy' : 'no-signal';
    case 'count':
      // 누락이 빈 페이지 수 이내일 때만 OCR로 설명된다. 빈 페이지 2장에 누락 10문항이면 서식 문제다.
      return i.undetected > 0 && i.blanks > 0 && i.undetected <= i.blanks ? 'ocr-candidate' : 'detect-gap';
    case 'sequence':
      return 'sequence';
    case 'alignment':
      return 'alignment';
  }
}

/** 원인별로 손댈 수 있는지 — 보고용 한 줄 설명 */
export const CAUSE_NOTE: Record<FallbackCause, string> = {
  'no-resplit': '의도적 통합본(재분할 금지) — 건드리지 않음',
  'image-heavy': '스캔 PDF — OCR 없이는 불가',
  'no-signal': '옛/비표준 서식 — 시그널 보강 대상',
  'ocr-candidate': '이미지 페이지만 OCR하면 풀릴 후보',
  'detect-gap': '서식 미지원으로 일부 문항 미검출 — 시그널 보강 대상',
  sequence: '번호 시퀀스 비정상 — 번호 판정 보강 대상',
  alignment: '엑셀↔PDF 문항 순서 불일치 — 자동 복구 위험',
  ok: '가드 통과 — 분할 미실행 상태',
};
