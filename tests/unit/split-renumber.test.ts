/**
 * 검출 번호가 쪽번호인 해설집 구제 — 2026-11-07 전수 감사에서 sequence 중단 169개가
 * 전부 kpc-mungje 시그널이고, 구간은 맞는데 번호만 쪽번호로 읽힌 것을 확인해 만든 보정.
 * 핵심 안전조건: 제목 정렬이 그 짝짓기를 증명하지 않으면 재배정하지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { renumberRangesByPosition } from '../../scripts/lib/split-renumber';

const titles = ['파이프라인 해저드', 'PMO 기능', '방법론 테일러링', 'BIA BCP', '정적 해싱', '차량용 증강현실'];
/** 각 구간 시작 페이지에 그 문항 제목이 실려 있는 정상 PDF (페이지 순 = 문항번호 순) */
const goodPages = ['방법론 테일러링 필요성', 'PMO 기능 범위관리', '파이프라인 해저드 구조적', 'BIA BCP 업무영향평가', '정적 해싱 개요', '차량용 증강현실 HUD'];
const ranges = (nums: number[], starts: number[]) =>
  nums.map((n, i) => ({ questionNumber: n, startPage: starts[i], endPage: starts[i] }));

// 제목 순서(엑셀 오름차순)와 페이지 순서가 맞도록 titles를 페이지 순으로 둔 픽스처
const pageOrderTitles = ['방법론 테일러링', 'PMO 기능', '파이프라인 해저드', 'BIA BCP', '정적 해싱', '차량용 증강현실'];

describe('renumberRangesByPosition', () => {
  it('R1: 쪽번호를 읽은 번호를 위치순 엑셀 번호로 재배정한다 (기출 104회 3교시형: [1,5,9,12,17,19] → 1..6)', () => {
    const r = renumberRangesByPosition(
      ranges([1, 5, 9, 12, 17, 19], [1, 2, 3, 4, 5, 6]),
      goodPages, pageOrderTitles, [1, 2, 3, 4, 5, 6],
    );
    expect(r.renumbered).toBe(true);
    expect(r.ranges.map((x) => x.questionNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.note).toContain('제목 일치 6/6');
  });

  it('R2: 엑셀 번호가 1..N이 아닌 옛 모의 컴시응도 그 번호로 재배정 (7~12번)', () => {
    const r = renumberRangesByPosition(
      ranges([1, 5, 3, 2, 17, 6], [1, 2, 3, 4, 5, 6]),
      goodPages, pageOrderTitles, [7, 8, 9, 10, 11, 12],
    );
    expect(r.renumbered).toBe(true);
    expect(r.ranges.map((x) => x.questionNumber)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it('R3: 페이지 순서대로 짝짓는다 — 입력이 페이지 역순이어도 결과는 페이지 오름차순', () => {
    const r = renumberRangesByPosition(
      ranges([19, 17, 12, 9, 5, 1], [6, 5, 4, 3, 2, 1]),
      goodPages, pageOrderTitles, [1, 2, 3, 4, 5, 6],
    );
    expect(r.ranges.map((x) => x.startPage)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.ranges.map((x) => x.questionNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('R4: 제목 근거가 60% 미만이면 재배정하지 않는다 — 2026-10-03 59건 오연결의 재발 방지', () => {
    const blank = ['', '', '', '', '', ''];
    const r = renumberRangesByPosition(ranges([1, 5, 9, 12, 17, 19], [1, 2, 3, 4, 5, 6]), blank, pageOrderTitles, [1, 2, 3, 4, 5, 6]);
    expect(r.renumbered).toBe(false);
    expect(r.note).toContain('제목 정렬 근거 부족');
  });

  it('R5: 제목이 한 칸 어긋나면(offset≠0) 재배정하지 않는다 — 엑셀·PDF 문항 순서 불일치', () => {
    // 각 구간 첫 페이지에 '다음' 문항 제목이 실린 형태
    const shifted = ['PMO 기능', '파이프라인 해저드', 'BIA BCP', '정적 해싱', '차량용 증강현실', ''];
    const r = renumberRangesByPosition(ranges([1, 5, 9, 12, 17, 19], [1, 2, 3, 4, 5, 6]), shifted, pageOrderTitles, [1, 2, 3, 4, 5, 6]);
    expect(r.renumbered).toBe(false);
    expect(r.note).toContain('offset');
  });

  it('R6: 번호가 이미 엑셀과 같으면 손대지 않는다 (note도 남기지 않음)', () => {
    const input = ranges([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]);
    const r = renumberRangesByPosition(input, goodPages, pageOrderTitles, [1, 2, 3, 4, 5, 6]);
    expect(r.renumbered).toBe(false);
    expect(r.note).toBeUndefined();
    expect(r.ranges).toBe(input);
  });

  it('R7: 구간 수와 문항 수가 다르면 재배정 대상이 아니다 (count 가드가 처리)', () => {
    const r = renumberRangesByPosition(ranges([1, 5, 9], [1, 2, 3]), goodPages, pageOrderTitles, [1, 2, 3, 4, 5, 6]);
    expect(r.renumbered).toBe(false);
    expect(r.ranges.map((x) => x.questionNumber)).toEqual([1, 5, 9]);
  });

  it('R8: titles를 쓰지 않는 호출(빈 구간)도 안전', () => {
    expect(renumberRangesByPosition([], [], [], []).renumbered).toBe(false);
  });
});
