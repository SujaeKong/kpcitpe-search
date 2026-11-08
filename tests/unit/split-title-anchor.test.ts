/**
 * 제목만으로 문항 시작 페이지를 특정하는 마지막 수단 검출 (2026-11-08).
 * 통합본 폴백 512개 중 313개가 시그널 수 불일치였고, 네 안전조건으로 182개를 받을 수 있었다.
 * 조건 하나라도 깨지면 통합본 유지 — 제목만 믿는 분할은 10/03 오연결 59건과 같은 사고를 낸다.
 */
import { describe, expect, it } from 'vitest';
import { titleAnchorRanges } from '../../scripts/lib/split-title-anchor';

const titles = ['해시 함수 충돌 저항성', '쿠키 보안 속성 설정', '캐시 무효화 전략'];
const nums = [1, 2, 3];

describe('titleAnchorRanges', () => {
  it('T1: 전 문항이 유일하게 특정되고 페이지가 순서대로면 구간을 만든다', () => {
    const pages = ['표지', '해시 함수 충돌 저항성 설명', '쿠키 보안 속성 설정 설명', '이어지는 내용', '캐시 무효화 전략 설명'];
    const r = titleAnchorRanges(pages, titles, nums);
    expect(r.ok).toBe(true);
    expect(r.ranges).toEqual([
      { questionNumber: 1, startPage: 2, endPage: 2 },
      { questionNumber: 2, startPage: 3, endPage: 4 },
      { questionNumber: 3, startPage: 5, endPage: 5 },
    ]);
  });

  it('T2: 엑셀 번호가 1..N이 아니어도 그 번호를 쓴다 (옛 모의 컴시응 7~9번)', () => {
    const pages = ['해시 함수 충돌 저항성', '쿠키 보안 속성 설정', '캐시 무효화 전략'];
    const r = titleAnchorRanges(pages, titles, [7, 8, 9]);
    expect(r.ranges.map((x) => x.questionNumber)).toEqual([7, 8, 9]);
  });

  it('T3: 한 페이지에 두 문항 제목이 맞으면 그 페이지는 앵커가 아니다 (시험문제 목록·표지 차단)', () => {
    // 1p에 1·2번 제목이 같이 있고 다른 곳에 1번 단독 페이지가 없음 → 특정 실패
    const pages = ['해시 함수 충돌 저항성 / 쿠키 보안 속성 설정 / 캐시 무효화 전략', '쿠키 보안 속성 설정 설명', '캐시 무효화 전략 설명'];
    const r = titleAnchorRanges(pages, titles, nums);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('특정 실패');
  });

  it('T4: 목록 페이지가 있어도 각 문항의 단독 페이지가 있으면 성립한다', () => {
    const pages = [
      '해시 함수 충돌 저항성 / 쿠키 보안 속성 설정 / 캐시 무효화 전략', // 목록 — 버려짐
      '해시 함수 충돌 저항성 설명', '쿠키 보안 속성 설정 설명', '캐시 무효화 전략 설명',
    ];
    const r = titleAnchorRanges(pages, titles, nums);
    expect(r.ok).toBe(true);
    expect(r.ranges.map((x) => x.startPage)).toEqual([2, 3, 4]);
  });

  it('T5: 페이지 순서가 문항 순서와 다르면 포기 — 엑셀·PDF 순서 불일치 (실측에서 재분할 금지 회차 8건 재현)', () => {
    const pages = ['캐시 무효화 전략 설명', '해시 함수 충돌 저항성 설명', '쿠키 보안 속성 설정 설명'];
    const r = titleAnchorRanges(pages, titles, nums);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('순서');
  });

  it('T6: 시그널이 엑셀 문항보다 많이 찾은 건은 받지 않는다 (합숙 1교시 — 엑셀에 문항 누락)', () => {
    const pages = ['해시 함수 충돌 저항성', '쿠키 보안 속성 설정', '캐시 무효화 전략'];
    const r = titleAnchorRanges(pages, titles, nums, { signalCount: 16 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('엑셀 문항 누락');
  });

  it('T7: 마지막 앵커 뒤 잔여가 허용치를 넘으면 포기 (미등록 문항을 삼키는 분할 방지)', () => {
    const pages = ['해시 함수 충돌 저항성', '쿠키 보안 속성 설정', '캐시 무효화 전략', ...Array(15).fill('다른 문항 내용')];
    expect(titleAnchorRanges(pages, titles, nums).ok).toBe(false);
    expect(titleAnchorRanges(pages, titles, nums, { maxTailPages: 20 }).ok).toBe(true);
  });

  it('T8: 토큰이 2개 미만인 짧은 제목이 있으면 포기 (Folksonomy 같은 한 단어 제목)', () => {
    const r = titleAnchorRanges(['Folksonomy 설명', '쿠키 보안 속성 설정'], ['Folksonomy', '쿠키 보안 속성 설정'], [1, 2]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('토큰');
  });
});
