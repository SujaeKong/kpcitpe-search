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

  it('B6: 매핑 없는 문항은 비워 두고, 매칭 건수를 반환', () => {
    const { matched, ids } = apply(makeProblem({ round: '139' }), makeProblem({ sourceType: '모의', academy: null, round: '2010.10' }), makeProblem());
    expect(ids).toEqual([null, null, 'kichul-140-mgmt-full']);
    expect(matched).toBe(1);
  });
});
