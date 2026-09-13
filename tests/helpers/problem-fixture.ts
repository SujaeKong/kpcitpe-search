import type { Problem } from '../../src/lib/types';

/** 테스트용 Problem — 기본값은 기출 140회 정보관리 1교시 1번 */
export function makeProblem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: 'kichul-140-mgmt-1-1',
    sourceType: '기출',
    academy: null,
    certScope: '정보관리',
    round: '140',
    roundLabel: '140회',
    roundOrder: 20260800,
    session: '1',
    sessionType: '교시',
    sessionPart: null,
    questionNumber: 1,
    questionSubNumber: null,
    questionLabel: '1',
    title: '테스트 문항',
    content: '테스트 본문',
    preparingFor: null,
    sourceFile: 'test.xls',
    explanationFileId: null,
    explanationFileName: null,
    ...overrides,
  };
}
