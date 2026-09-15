/**
 * PDF 분할 시그널 검출 — 형식별 정규식 세부 규칙, 시그널 우선순위·구간 계산, 안전 가드, 골격 텍스트.
 * (직접 작성한 짧은 텍스트. 실제 PDF 기반 회귀는 split-signals-golden.test.ts)
 */
import { describe, expect, it } from 'vitest';
import { redactPageText } from '../../scripts/lib/split-redact';
import { checkSplitGuards, detectQuestionRangesWithSignal, SIGNALS, type QuestionRange } from '../../scripts/split-pdfs';

const signal = (name: string) => {
  const s = SIGNALS.find((x) => x.name === name);
  if (!s) throw new Error(`시그널 없음: ${name}`);
  return s;
};
const extract = (name: string, text: string) => signal(name).extractNumbers(text);

describe('시그널별 문항번호 추출', () => {
  it('V1 munje: "문 제 N." (자릿수 사이 공백 허용), 합성어 "기출문제 N." 제외, 앞 800자·1~30만', () => {
    expect(extract('munje', '머리말 문 제 1. 해시 함수')).toEqual([1]);
    expect(extract('munje', '문제 1 0 . 캐시')).toEqual([10]);
    expect(extract('munje', '기출문제 2 4. 분석')).toEqual([]);
    expect(extract('munje', `${'가'.repeat(801)} 문제 5. 늦은 마커`)).toEqual([]);
    expect(extract('munje', `${'가'.repeat(700)} 문제 6. 논술형`)).toEqual([6]);
    expect(extract('munje', '문제 31. 범위 밖')).toEqual([]);
  });

  it('V2 bracketmunje: "[문제풀이] N." (괄호·글자 사이 공백 허용)', () => {
    expect(extract('bracketmunje', '[문제풀이] 3. OCL')).toEqual([3]);
    expect(extract('bracketmunje', '[ 문 제 풀 이 ] 1 2 . 시맨틱 웹')).toEqual([12]);
    expect(extract('bracketmunje', '문제풀이 3. 괄호 없음')).toEqual([]);
  });

  it('V3 kpc-rights-num: 출제도메인이 있는 페이지의 "rights reserved {쪽} … {번호} {제목}" (앞 500자)', () => {
    const page = 'Copyright 2011 KPC. All rights reserved 7 1교시(정보관리) 3 인메모리 컴퓨팅 출제도메인 CA';
    expect(extract('kpc-rights-num', page)).toEqual([3]);
    expect(extract('kpc-rights-num', page.replace('출제도메인', '출제 영역'))).toEqual([]);
    expect(extract('kpc-rights-num', `${'가'.repeat(500)} ${page}`)).toEqual([]);
  });

  it('V4 kpc-domain: 출제도메인이 있는 페이지의 ") N 제목" (두 자리는 "1 2"도 허용, 앞 700자)', () => {
    expect(extract('kpc-domain', '1교시(조직응용) 3 데이터 거버넌스 출제도메인 DB')).toEqual([3]);
    expect(extract('kpc-domain', '1교시(조직응용) 1 2 Home eNode B 출제도메인 NW')).toEqual([12]);
    expect(extract('kpc-domain', '1교시(조직응용) 3 데이터 거버넌스')).toEqual([]);
  });

  it('V5 kpc-bunho: "N 교시 M 번 제목" — 한 페이지의 여러 번호를 중복 없이', () => {
    expect(extract('kpc-bunho', '1 교시 3 번 해시 함수 … 1교시 12 번 (가) 설명 … 1 교시 3 번 해시')).toEqual([3, 12]);
    expect(extract('kpc-bunho', '1교시 3번해시')).toEqual([]);
  });

  it('V6 kpc-mungje: 도메인+출제배경/의도가 있을 때 "도메인" 앞의 "N 키워드 문제" 중 최솟값, "N 교시"는 제외', () => {
    expect(extract('kpc-mungje', '12 페이지 쿠키 문제 해설 5 해시 함수의 개념 문제 설명 도메인 보안 출제배경 최신')).toEqual([5]);
    expect(extract('kpc-mungje', '3 교시 문제 풀이 도메인 보안 출제의도 기본')).toEqual([]);
    expect(extract('kpc-mungje', '5 해시 문제 설명 도메인 보안')).toEqual([]);
    expect(extract('kpc-mungje', '도메인 보안 출제배경 5 해시 문제 설명')).toEqual([]);
  });
});

describe('분할본 검증 (validateSplit)', () => {
  it('V7: 분할된 PDF 안에 해당 번호의 마커가 있는지', () => {
    expect(signal('munje').validateSplit('머리 문 제 1 0 . 캐시', 10)).toBe(true);
    expect(signal('munje').validateSplit('기출문제 10. 분석', 10)).toBe(false);
    expect(signal('bracketmunje').validateSplit('[문제풀이] 7. 제목', 7)).toBe(true);
    expect(signal('kpc-bunho').validateSplit('2 교시 4 번 제목', 4)).toBe(true);
    expect(signal('kpc-bunho').validateSplit('2 교시 4 번 제목', 5)).toBe(false);
    expect(signal('kpc-domain').validateSplit('출제도메인 NW', 99)).toBe(true);
  });
});

describe('검출 결과 (detectQuestionRangesWithSignal)', () => {
  it('V8: 문항 시작 페이지 순으로 구간을 나누고(다음 시작 전까지, 마지막은 끝 페이지) 번호순으로 돌려준다 — 같은 번호 재등장은 새 구간이 아님', () => {
    const pages = ['표지', '문제 1. 해시', '본문 계속', '문제 3. 캐시', '문제 2. 쿠키', '문제 1. 재등장', '부록'];
    expect(detectQuestionRangesWithSignal(pages)).toEqual({
      signal: 'munje',
      ranges: [
        { questionNumber: 1, startPage: 2, endPage: 3 },
        { questionNumber: 2, startPage: 5, endPage: 7 },
        { questionNumber: 3, startPage: 4, endPage: 4 },
      ],
    });
  });

  it('V9: 앞 순서 시그널이 3개 이상이면 그 시그널 채택, 어떤 시그널도 3개 미만이면 none', () => {
    const both = ['문제 1. A 1 교시 1 번 가', '문제 2. B 1 교시 2 번 나', '문제 3. C 1 교시 3 번 다'];
    expect(detectQuestionRangesWithSignal(both).signal).toBe('munje');
    const bunhoOnly = ['1 교시 1 번 가', '1 교시 2 번 나', '1 교시 3 번 다'];
    expect(detectQuestionRangesWithSignal(bunhoOnly).signal).toBe('kpc-bunho');
    expect(detectQuestionRangesWithSignal(['문제 1. A', '문제 2. B', '본문'])).toEqual({ signal: 'none', ranges: [] });
  });
});

describe('안전 가드 (checkSplitGuards)', () => {
  const ranges = (...nums: number[]): QuestionRange[] => nums.map((n, i) => ({ questionNumber: n, startPage: i + 1, endPage: i + 1 }));
  const titles = ['해시 함수', '쿠키 보안', '캐시 전략'];

  it('V10: 검출 없음 → none, 수 불일치 → count, 번호 갭 → sequence', () => {
    expect(checkSplitGuards([], [], titles)).toMatchObject({ ok: false, reason: 'none' });
    expect(checkSplitGuards(ranges(1, 2), ['', ''], titles)).toMatchObject({ ok: false, reason: 'count', message: expect.stringContaining('검출 2개 ≠ problems 3개') });
    expect(checkSplitGuards(ranges(1, 2, 4), ['', '', ''], titles)).toMatchObject({ ok: false, reason: 'sequence', message: expect.stringContaining('[1,2,4]') });
  });

  it('V11: 구간 첫 페이지가 한 칸씩 앞 문항이면 alignment, alignment:false면 통과, 맞으면 ok', () => {
    const shifted = ['표지 해시 함수', '해시 함수 설명', '쿠키 보안 설명'];
    expect(checkSplitGuards(ranges(1, 2, 3), shifted, titles)).toMatchObject({ ok: false, reason: 'alignment' });
    expect(checkSplitGuards(ranges(1, 2, 3), shifted, titles, { alignment: false })).toEqual({ ok: true });
    expect(checkSplitGuards(ranges(1, 2, 3), ['해시 함수', '쿠키 보안', '캐시 전략'], titles)).toEqual({ ok: true });
  });
});

describe('골격 텍스트 (redactPageText)', () => {
  it('V12: UTF-16 길이 보존, 표지어·숫자·기호·"rights reserved"만 남기고 본문은 가림', () => {
    const text = '인메모리컴퓨팅 SAP HANA 😀 ★ 문제 1. rights reserved 5 출제도메인 교시 번 배경';
    const skeleton = redactPageText(text);
    expect(skeleton).toHaveLength(text.length);
    expect(skeleton).toBe('인메가가가가가 AAA AAAA ·· · 문제 1. rights reserved 5 출제도메인 교시 번 배경');
  });

  it('V13: 골격 텍스트에서도 모든 시그널의 검출 결과가 원문과 같다', () => {
    const samples = [
      ['머리말 문 제 1. 해시', '문제 2. 쿠키', '문제 3. 캐시'],
      ['[문제풀이] 1. OCL', '[문제풀이] 2. UML', '[문제풀이] 3. SOA'],
      ['All rights reserved 1 1교시(정보관리) 1 인메모리 출제도메인', 'All rights reserved 2 1교시(정보관리) 2 PWW 출제도메인', 'All rights reserved 3 1교시(정보관리) 3 KPO 출제도메인'],
      ['1교시(조직응용) 1 Home eNode B 출제도메인 NW', '1교시(조직응용) 2 OPA 출제도메인', '1교시(조직응용) 3 QPSK 출제도메인'],
      ['1 교시 1 번 해시', '1 교시 2 번 쿠키', '1 교시 3 번 캐시'],
      ['1 해시 함수 문제 설명 도메인 보안 출제배경', '2 쿠키 보안 문제 설명 도메인 보안 출제배경', '3 캐시 전략 문제 설명 도메인 보안 출제의도'],
    ];
    for (const pages of samples) {
      const original = detectQuestionRangesWithSignal(pages);
      expect(original.ranges, pages[0]).toHaveLength(3);
      expect(detectQuestionRangesWithSignal(pages.map(redactPageText))).toEqual(original);
    }
  });
});
