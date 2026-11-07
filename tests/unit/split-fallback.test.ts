/**
 * 통합본 폴백 원인 분류 — 2026-11-07 OCR 도입 판단에서 과대계상이 나와 만든 분류기.
 * 핵심: "빈 페이지가 있다"만으로 OCR 후보로 세면 안 된다(누락 ≤ 빈 페이지일 때만 설명된다).
 */
import { describe, expect, it } from 'vitest';
import { classifyFallback } from '../../scripts/lib/split-fallback';

const base = { noResplit: false, pages: 30, blanks: 0, undetected: 0 };

describe('classifyFallback', () => {
  it('F1: 재분할 금지 회차는 다른 조건을 보기 전에 no-resplit', () => {
    expect(classifyFallback({ ...base, noResplit: true, guardReason: 'alignment' })).toBe('no-resplit');
    expect(classifyFallback({ ...base, noResplit: true, blanks: 30, guardReason: 'none' })).toBe('no-resplit');
  });

  it('F2: 가드를 통과하면 ok (분할 가능한데 아직 안 올라간 상태)', () => {
    expect(classifyFallback(base)).toBe('ok');
  });

  it('F3: 검출 0 + 페이지 절반 이상이 빈 페이지 → image-heavy (스캔 PDF)', () => {
    expect(classifyFallback({ ...base, pages: 30, blanks: 15, undetected: 6, guardReason: 'none' })).toBe('image-heavy');
  });

  it('F4: 검출 0인데 글자는 있음 → no-signal (옛 서식)', () => {
    expect(classifyFallback({ ...base, pages: 27, blanks: 0, undetected: 6, guardReason: 'none' })).toBe('no-signal');
  });

  it('F5: 누락 ≤ 빈 페이지 → ocr-candidate (모의 2014.06 4교시 컴시응: 32p 중 빈 3p, 누락 3)', () => {
    expect(classifyFallback({ ...base, pages: 32, blanks: 3, undetected: 3, guardReason: 'count' })).toBe('ocr-candidate');
  });

  it('F6: 빈 페이지가 있어도 누락이 더 크면 detect-gap — 이전 집계가 여기서 과대계상했다 (모의 2010.10 3교시: 빈 2p, 누락 10)', () => {
    expect(classifyFallback({ ...base, pages: 42, blanks: 2, undetected: 10, guardReason: 'count' })).toBe('detect-gap');
  });

  it('F7: 빈 페이지가 전혀 없는 수 불일치는 detect-gap', () => {
    expect(classifyFallback({ ...base, pages: 36, blanks: 0, undetected: 7, guardReason: 'count' })).toBe('detect-gap');
  });

  it('F8: 수는 맞는데 번호·제목이 어긋난 건은 각자의 원인으로 남는다 (OCR 대상 아님)', () => {
    expect(classifyFallback({ ...base, guardReason: 'sequence' })).toBe('sequence');
    expect(classifyFallback({ ...base, guardReason: 'alignment' })).toBe('alignment');
  });
});
