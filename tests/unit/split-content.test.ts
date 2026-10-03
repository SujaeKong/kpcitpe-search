/**
 * 분할본 내용 ↔ 연결된 문항 대조 판정.
 * (파일명·PDF 내부번호 검증으로는 못 잡는 짝 어긋남 — 모의 2026.06 2교시 4번에 8번 해설이 연결된 사례)
 */
import { describe, expect, it } from 'vitest';
import { matchSplitContent, titleScore } from '../../scripts/lib/split-content';

const titles = [
  '국가 AI 컴퓨팅 인프라 구축을 위한 민관합작 방식의 사업이 본격화되고 있다.',
  '소프트웨어 개발 및 운영 과정에서 품질 보증의 핵심인 형상관리와 관련하여 다음을 설명하시오.',
  '최근 AI 모델의 거대화에 따른 GPU의 전력, 발열, 비용 등의 한계를 극복하기 위해 NPU에 대한 실증과 도입이 가속화되고 있다.',
];

describe('제목 토큰 점수 (titleScore)', () => {
  it('N1: 제목 토큰이 본문에 있는 비율, 공백·대소문자 무시', () => {
    // 제목 토큰 10개 중 '관련하여·다음을'이 없어 0.8 — 서술어가 빠져도 충분히 높게 나온다
    expect(titleScore('형상관리와 품질 보증의 핵심인 소프트웨어 개발 및 운영 과정에서', titles[1])).toBeCloseTo(0.8, 2);
    expect(titleScore('전혀 다른 내용', titles[1])).toBe(0);
    // 토큰이 2개 미만인 제목은 판정 불가(0) — 근거 없는 ok를 막는다
    expect(titleScore('DB에 대해 설명하시오', '하시오')).toBe(0);
  });
});

describe('분할본 내용 판정 (matchSplitContent)', () => {
  it('N2: 연결된 문항 내용이면 ok', () => {
    const text = '문 제 2. 소프트웨어 개발 및 운영 과정에서 품질 보증의 핵심인 형상관리와 관련하여 다음을 설명하시오. 가. 형상관리의 개념';
    expect(matchSplitContent(text, titles, 1)).toMatchObject({ verdict: 'ok', bestIndex: 1 });
  });

  it('N3: 실제 사례 — 형상관리(2번)에 NPU(3번) 해설이 붙으면 mismatch + 실제 문항 지목', () => {
    const text = '문 제 8. 최근 AI 모델의 거대화에 따른 GPU 의 전력, 발열, 비용 등의 한계를 극복하기 위해 NPU 에 대한 실증과 도입이 가속화되고 있다.';
    const m = matchSplitContent(text, titles, 1);
    expect(m.verdict).toBe('mismatch');
    expect(m.bestIndex).toBe(2);
    expect(m.expectedScore).toBeLessThan(0.5);
  });

  it('N4: 어느 문항도 뚜렷하지 않으면 weak (표지만 잡힌 분할본 등) — mismatch로 단정하지 않는다', () => {
    const m = matchSplitContent('누구나 ICT 전문가가 될 수 있는 세상! Copyright 2026 KPC', titles, 1);
    expect(m.verdict).toBe('weak');
  });

  it('N5: 비슷한 제목이 섞여도 연결된 문항이 최고점에 근접하면 ok (0.2 미만 차이 허용)', () => {
    const near = ['형상관리 기준선 유형 및 주요 산출물', '형상관리 기준선 유형 및 변경 통제'];
    const text = '형상관리 기준선 유형 및 주요 산출물과 변경 통제 절차';
    expect(matchSplitContent(text, near, 0).verdict).toBe('ok');
    expect(matchSplitContent(text, near, 1).verdict).toBe('ok');
  });

  it('N6: 페이지 순서 ↔ 엑셀 번호 짝짓기가 한 칸씩 어긋나면 전부 mismatch로 잡힌다', () => {
    // 분할본 i가 문항 i+1의 내용을 담은 상태 (옛 off-by-one 유형)
    const texts = titles.map((t) => `문 제 N. ${t}`);
    const verdicts = titles.map((_, i) => matchSplitContent(texts[i + 1] ?? '', titles, i).verdict);
    expect(verdicts.slice(0, 2)).toEqual(['mismatch', 'mismatch']);
  });
});
