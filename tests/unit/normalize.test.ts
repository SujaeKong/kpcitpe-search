/**
 * KPC 엑셀 어댑터 정규화 규칙 (PROJECT.md §7.4, 메모리의 데이터 정규화 규칙).
 */
import { describe, expect, it } from 'vitest';
import {
  autoAssignQuestionNumbers,
  buildId,
  inferHapsukSessionParts,
  kichulRoundOrder,
  normalizeCertScope,
  normalizeRound,
  normalizeSession,
  splitProblem,
} from '../../scripts/adapters/kpc-xls-adapter';
import { makeProblem } from '../helpers/problem-fixture';

describe('회차', () => {
  it('N1: 기출 회차 → 시험 연월(YYYYMM00), 1년 3회(2/5/8월), 회차 순서와 단조 증가', () => {
    expect(kichulRoundOrder(138)).toBe(20260200);
    expect(kichulRoundOrder(139)).toBe(20260500);
    expect(kichulRoundOrder(140)).toBe(20260800);
    expect(kichulRoundOrder(141)).toBe(20270200);
    expect(kichulRoundOrder(137)).toBe(20250800);
    for (let n = 60; n < 160; n++) expect(kichulRoundOrder(n + 1)).toBeGreaterThan(kichulRoundOrder(n));
  });

  it('N2: 기출 "140", "140회", " 140 회 " → 140', () => {
    for (const raw of ['140', '140회', ' 140 회 ']) {
      expect(normalizeRound(raw.trim(), '기출')).toEqual({ round: '140', roundLabel: '140회', roundOrder: 20260800 });
    }
    expect(normalizeRound('제140회', '기출')).toBeNull();
    expect(normalizeRound(null, '기출')).toBeNull();
  });

  it('N3: 모의/합숙 — 밑줄 누락·한 자리 월·같은 달 다회차(-N) 허용, 출처 접두어 불일치는 거부', () => {
    expect(normalizeRound('모의_2026.04', '모의')).toEqual({ round: '2026.04', roundLabel: '모의_2026.04', roundOrder: 20260400 });
    expect(normalizeRound('모의2026.4', '모의')?.round).toBe('2026.04');
    expect(normalizeRound('모의_2010.10-2', '모의')).toEqual({ round: '2010.10-2', roundLabel: '모의_2010.10-2', roundOrder: 20101002 });
    expect(normalizeRound('합숙_2026.08', '합숙')).toEqual({ round: '2026.08', roundLabel: '합숙_2026.08', roundOrder: 20260800 });
    expect(normalizeRound('합숙_2026.08', '모의')).toBeNull();
  });
});

describe('종목 / 교시·일차', () => {
  it('N4: 종목 6가지 표기 → 3종', () => {
    expect(['관리', '정보관리'].map(normalizeCertScope)).toEqual(['정보관리', '정보관리']);
    expect(['응용', '컴시응'].map(normalizeCertScope)).toEqual(['컴시응', '컴시응']);
    expect(['공통', '조직', '보안'].map(normalizeCertScope)).toEqual(['공통', '공통', '공통']);
    expect(normalizeCertScope('기타')).toBeNull();
  });

  it('N5: 합숙 Day-1 / day 2 / 3일차 / 4 → N일차, 기출·모의 1 / 2교시 → 숫자', () => {
    expect(['Day-1', 'day 2', '3일차', '4'].map((s) => normalizeSession(s, '합숙')?.session)).toEqual(['1일차', '2일차', '3일차', '4일차']);
    expect(normalizeSession('1', '합숙')?.sessionType).toBe('일차');
    expect(normalizeSession('1', '기출')).toEqual({ session: '1', sessionType: '교시' });
    expect(normalizeSession('2교시', '모의')).toEqual({ session: '2', sessionType: '교시' });
    expect(normalizeSession('1일차', '기출')).toBeNull();
  });
});

describe('문항 번호 분리', () => {
  it('N6: 소문제 N.M / N-M, 일반 N., 번호 없음, "N. M..."은 일반 문항', () => {
    expect(splitProblem('1.2 데이터 정규화\n본문')).toMatchObject({ questionNumber: 1, questionSubNumber: 2, questionLabel: '1.2', title: '데이터 정규화' });
    expect(splitProblem('2-1. 캐시 전략')).toMatchObject({ questionNumber: 2, questionSubNumber: 1, questionLabel: '2-1', title: '캐시 전략' });
    expect(splitProblem('3.제로 트러스트')).toMatchObject({ questionNumber: 3, questionSubNumber: null, questionLabel: '3', title: '제로 트러스트' });
    expect(splitProblem('1. 2단계 커밋')).toMatchObject({ questionNumber: 1, questionSubNumber: null, title: '2단계 커밋' });
    expect(splitProblem('C-Commerce 설명')).toMatchObject({ questionNumber: null, questionLabel: '', title: 'C-Commerce 설명' });
  });
});

describe('자동 문항번호 (옛 회차 단답형)', () => {
  const kichul = (o: Parameters<typeof makeProblem>[0]) =>
    makeProblem({ round: '83', roundLabel: '83회', questionNumber: null, questionLabel: '', ...o });

  it('N7: 번호 없는 그룹은 등장 순서대로 1부터, ID도 재생성', () => {
    const group = [kichul({ id: 'x1' }), kichul({ id: 'x2' }), kichul({ id: 'x3' })];
    autoAssignQuestionNumbers(group);
    expect(group.map((p) => p.questionNumber)).toEqual([1, 2, 3]);
    expect(group.map((p) => p.id)).toEqual(['kichul-83-mgmt-1-1', 'kichul-83-mgmt-1-2', 'kichul-83-mgmt-1-3']);
  });

  it('N8: 명시 번호와 섞이면 최대값+1부터 채우고, 기출은 종목별로 따로 센다', () => {
    const group = [
      kichul({ questionNumber: 2, questionLabel: '2' }),
      kichul({}),
      kichul({ questionNumber: 5, questionLabel: '5' }),
      kichul({}),
      kichul({ certScope: '컴시응' }),
    ];
    autoAssignQuestionNumbers(group);
    expect(group.map((p) => p.questionNumber)).toEqual([2, 6, 5, 7, 1]);
  });

  it('N9: 모의는 종목 무관 한 교시 통합 번호, 공통→정보관리→컴시응 순', () => {
    const moui = (certScope: '공통' | '정보관리' | '컴시응') =>
      makeProblem({ sourceType: '모의', academy: 'KPC', round: '2026.01', certScope, questionNumber: null, questionLabel: '' });
    const group = [moui('컴시응'), moui('공통'), moui('정보관리'), moui('공통')];
    autoAssignQuestionNumbers(group);
    expect(group.map((p) => `${p.certScope}${p.questionNumber}`)).toEqual(['컴시응4', '공통1', '정보관리3', '공통2']);
  });
});

describe('합숙 교시 추정', () => {
  const hapsuk = (count: number, numbers?: number[]) =>
    (numbers ?? Array.from({ length: count }, (_, i) => i + 1)).map((n) =>
      makeProblem({ sourceType: '합숙', academy: 'KPC', round: '2026.08', session: '1일차', sessionType: '일차', questionNumber: n }),
    );
  const parts = (group: ReturnType<typeof hapsuk>) => {
    inferHapsukSessionParts(group);
    return group.map((p) => (p.sessionPart === '1교시' ? 1 : 2));
  };

  it('N10: 8문항 이하 → 전부 2교시(논술), 9~16 → 전부 1교시(약술), 17+ → 앞 13개 1교시', () => {
    expect(parts(hapsuk(6))).toEqual(Array(6).fill(2));
    expect(parts(hapsuk(13))).toEqual(Array(13).fill(1));
    expect(parts(hapsuk(20))).toEqual([...Array(13).fill(1), ...Array(7).fill(2)]);
  });

  it('N11: 같은 번호가 두 번째 나오면 2교시 (한 일차에 1·2교시 동거)', () => {
    const numbers = [...Array.from({ length: 13 }, (_, i) => i + 1), 1, 2, 3, 4, 5, 6];
    expect(parts(hapsuk(0, numbers))).toEqual([...Array(13).fill(1), ...Array(6).fill(2)]);
  });
});

describe('ID 규칙', () => {
  it('N12: 종목 슬러그 + 학원(합숙/모의) + 일차 슬러그 + 소문제 N_M', () => {
    expect(buildId({ sourceType: '기출', academy: null, certScope: '정보관리', round: '138', session: '1', questionPart: '3' })).toBe('kichul-138-mgmt-1-3');
    expect(buildId({ sourceType: '합숙', academy: 'KPC', certScope: '컴시응', round: '2026.02', session: '1일차', questionPart: '3' })).toBe('hapsuk-kpc-2026.02-app-1ilcha-3');
    expect(buildId({ sourceType: '모의', academy: 'KPC', certScope: '공통', round: '2026.04', session: '2', questionPart: '7' })).toBe('moui-kpc-2026.04-common-2-7');
    expect(buildId({ sourceType: '기출', academy: null, certScope: '컴시응', round: '140', session: '2', questionPart: '1_2' })).toBe('kichul-140-app-2-1_2');
  });
});
