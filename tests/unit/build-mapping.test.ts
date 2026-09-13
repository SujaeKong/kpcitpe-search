/**
 * 빌드 파이프라인: 엑셀 버전 선택 + 해설지 매핑 적용 규칙 (PROJECT.md §7.2).
 */
import { describe, expect, it } from 'vitest';
import { applyExplanationMap, pickLatestVersions, type ExplanationMap } from '../../scripts/build';
import { makeProblem } from '../helpers/problem-fixture';

describe('엑셀 버전 선택', () => {
  it('B1: 같은 베이스명은 가장 높은 버전만 채택(숫자 비교), 버전 없는 파일은 유지', () => {
    const { picked, skipped } = pickLatestVersions([
      '/src/KPC_기술사문제검색_v260411.xls',
      '/src/KPC_기술사문제검색_v260823.xls',
      '/src/KPC_기술사문제검색_v260516.xls',
      '/src/extra.xlsx',
      '/src/Other_v99.xls',
      '/src/Other_v100.xls',
    ]);
    expect(picked).toEqual(['/src/KPC_기술사문제검색_v260823.xls', '/src/Other_v100.xls', '/src/extra.xlsx']);
    expect(skipped).toEqual(['/src/KPC_기술사문제검색_v260411.xls', '/src/KPC_기술사문제검색_v260516.xls', '/src/Other_v99.xls']);
  });
});

describe('해설지 매핑', () => {
  const map: ExplanationMap = {
    기출: {
      '140': {
        '1_정보관리': { id: 'kichul-140-mgmt-full', name: '140 정관 1교시.pdf', questions: { '3': { id: 'kichul-140-mgmt-q3', name: 'q3.pdf' } } },
        '1': { id: 'kichul-140-legacy', name: '140 1교시 (종목 구분 없음).pdf' },
      },
    },
    합숙: {
      '2026.08': {
        '1일차_1교시': { id: 'hapsuk-1-1', name: '1일차 1교시.pdf' },
        '2일차': { id: 'hapsuk-2', name: '2일차(교시 없음).pdf' },
      },
    },
    모의: {
      KPC: {
        '2010.10': { '1': { id: 'moui-2010.10-base' } },
        '2010.10-2': { '2': { id: 'moui-2010.10-2-exact' } },
      },
    },
  };

  const apply = (...problems: ReturnType<typeof makeProblem>[]) => {
    const matched = applyExplanationMap(problems, map);
    return { matched, ids: problems.map((p) => p.explanationFileId ?? null), names: problems.map((p) => p.explanationFileName ?? null) };
  };

  it('B2: 기출은 "교시_종목" 키 우선, 없으면 "교시" 키', () => {
    const { ids } = apply(makeProblem({ questionNumber: 1 }), makeProblem({ certScope: '컴시응', questionNumber: 1 }));
    expect(ids).toEqual(['kichul-140-mgmt-full', 'kichul-140-legacy']);
  });

  it('B3: 문항별 분할 PDF가 있으면 우선, 해당 번호가 없으면 통합본', () => {
    const { ids, names } = apply(makeProblem({ questionNumber: 3 }), makeProblem({ questionNumber: 4 }), makeProblem({ questionNumber: null }));
    expect(ids).toEqual(['kichul-140-mgmt-q3', 'kichul-140-mgmt-full', 'kichul-140-mgmt-full']);
    expect(names[0]).toBe('q3.pdf');
  });

  it('B4: 합숙은 "일차_교시" 키, 교시 정보 없으면 "일차" 키', () => {
    const hapsuk = (session: string, sessionPart: '1교시' | '2교시' | null) =>
      makeProblem({ sourceType: '합숙', academy: 'KPC', round: '2026.08', session, sessionType: '일차', sessionPart });
    expect(apply(hapsuk('1일차', '1교시'), hapsuk('2일차', null), hapsuk('1일차', '2교시')).ids).toEqual(['hapsuk-1-1', 'hapsuk-2', null]);
  });

  it('B5: 모의 -N 회차는 정확한 회차 우선, 없으면 base 회차로 폴백', () => {
    const moui = (round: string, session: string) => makeProblem({ sourceType: '모의', academy: 'KPC', round, session });
    expect(apply(moui('2010.10-2', '2'), moui('2010.10-2', '1'), moui('2010.10-1', '1')).ids).toEqual([
      'moui-2010.10-2-exact',
      'moui-2010.10-base',
      'moui-2010.10-base',
    ]);
  });

  it('B6a: 매핑 없는 문항은 비워 두고, 매칭 건수를 반환', () => {
    const { matched, ids } = apply(makeProblem({ round: '139' }), makeProblem({ sourceType: '모의', academy: null, round: '2010.10' }), makeProblem());
    expect(ids).toEqual([null, null, 'kichul-140-mgmt-full']);
    expect(matched).toBe(1);
  });
});

describe('모의 종목별 해설집 (2026-09 종목 키 분리)', () => {
  const map: ExplanationMap = {
    모의: {
      KPC: {
        '2016.01': {
          '3_컴시응': { id: 'app-whole', name: '제67회 컴퓨터시스템응용_해설집_201601_3교시.pdf', questions: { '7': { id: 'app-q7' } } },
          '3_정보관리': { id: 'mgmt-whole', name: '제67회 정보관리_해설집_201601_3교시.pdf', questions: { '1': { id: 'mgmt-q1' } } },
        },
        '2016.04': {
          '1': { id: 'combined-whole', questions: { '1': { id: 'combined-q1' } } },
          '2_컴시응': { id: 'app-only-whole', questions: { '1': { id: 'app-only-q1' } } },
        },
      },
    },
  };
  const moui = (round: string, session: string, certScope: '정보관리' | '컴시응' | '공통', questionNumber: number) =>
    makeProblem({ sourceType: '모의', academy: 'KPC', round, session, certScope, questionNumber });
  const idsFor = (...problems: ReturnType<typeof makeProblem>[]) => {
    applyExplanationMap(problems, map);
    return problems.map((p) => p.explanationFileId ?? null);
  };

  it('B7: 정보관리·컴시응 문항은 각자 종목 해설집과 그 분할본 — 번호가 같아도 다른 종목 분할본을 쓰지 않음', () => {
    expect(idsFor(moui('2016.01', '3', '정보관리', 1), moui('2016.01', '3', '컴시응', 7), moui('2016.01', '3', '컴시응', 1))).toEqual([
      'mgmt-q1',
      'app-q7',
      'app-whole',
    ]);
  });

  it('B8: 종목별 해설집이 없으면 통합 해설집으로, 다른 종목 해설집으로는 가지 않음', () => {
    expect(idsFor(moui('2016.04', '1', '정보관리', 1), moui('2016.04', '2', '정보관리', 1), moui('2016.04', '2', '컴시응', 1))).toEqual([
      'combined-q1',
      null,
      'app-only-q1',
    ]);
  });

  it('B9: 공통 문항은 통합 해설집 우선, 없으면 종목별 해설집의 통합본만 (분할본 번호는 쓰지 않음)', () => {
    expect(idsFor(moui('2016.04', '1', '공통', 1), moui('2016.01', '3', '공통', 7))).toEqual(['combined-q1', 'app-whole']);
  });
});
