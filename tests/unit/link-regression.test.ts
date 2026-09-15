/**
 * 배포 전 해설지 연결 회귀 판정 — 운영 대비 새 빌드의 문항·연결·분할본 수를 출처·회차별로 비교.
 */
import { describe, expect, it } from 'vitest';
import {
  compareExplanationLinks,
  formatLinkReport,
  isSplitFileName,
  shouldAllowLinkDrop,
  type LinkProblem,
} from '../../scripts/lib/link-regression';

/** round 회차에 문항 n개, 앞 linked개는 해설지 연결, 그중 앞 split개는 분할본 */
function round(sourceType: string, r: string, n: number, linked: number, split = 0, idPrefix = 'id'): LinkProblem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${idPrefix}-${sourceType}-${r}-${i}`,
    sourceType,
    round: r,
    explanationFileId: i < linked ? `file-${i}` : null,
    explanationFileName: i < split ? `${sourceType}_${r}_공통_1_${String(i + 1).padStart(2, '0')}_주제.pdf` : i < linked ? '통합본.pdf' : null,
  }));
}

const production = [...round('기출', '140', 60, 0), ...round('합숙', '2026.08', 72, 72, 72), ...round('모의', '2016.07', 1000, 900, 400), ...round('모의', '2011.07', 62, 62)];
const violationsOf = (after: LinkProblem[]) => compareExplanationLinks(production, after).violations;

describe('해설지 연결 회귀 판정', () => {
  it('X1: 같은 데이터면 위반 없음, 문항 ID만 바뀐 경우도 위반 없음 (개수로만 비교)', () => {
    expect(violationsOf(production)).toEqual([]);
    const renamed = production.map((p, i) => ({ ...p, id: `renamed-${i}` }));
    expect(violationsOf(renamed)).toEqual([]);
  });

  it('X2: 신규 회차·연결 증가는 위반이 아니고 변경 회차로만 보고', () => {
    const report = compareExplanationLinks(production, [...production.filter((p) => p.round !== '140'), ...round('기출', '140', 62, 62, 62), ...round('합숙', '2026.11', 70, 0)]);
    expect(report.violations).toEqual([]);
    expect(report.groupChanges.map((c) => c.group)).toEqual(expect.arrayContaining(['기출 140', '합숙 2026.11']));
  });

  it('X3: 전체 연결 감소는 max(50, 1%)까지 허용, 넘으면 위반', () => {
    const dropLinks = (count: number) => {
      let left = count;
      return production.map((p) =>
        p.round === '2016.07' && p.explanationFileId && !isSplitFileName(p.explanationFileName) && left-- > 0
          ? { ...p, explanationFileId: null, explanationFileName: null }
          : p,
      );
    };
    expect(violationsOf(dropLinks(50))).toEqual([]);
    expect(violationsOf(dropLinks(51))).toEqual([expect.stringContaining('해설지 연결 급감: 1034 → 983')]);
  });

  it('X4: 회차 하나에서 연결이 절반 이상·5건 이상 끊기면 위반 (작은 회차의 4건은 허용)', () => {
    const after = [...production.filter((p) => p.round !== '2011.07'), ...round('모의', '2011.07', 62, 20)];
    expect(violationsOf(after)).toEqual([expect.stringContaining('회차 해설지 연결 급감: 모의 2011.07 62 → 20')]);
    const small = [...round('기출', '90', 8, 8)];
    expect(compareExplanationLinks(small, round('기출', '90', 8, 4)).violations).toEqual([]);
    expect(compareExplanationLinks(small, round('기출', '90', 8, 3)).violations).toEqual([expect.stringContaining('기출 90 8 → 3')]);
  });

  it('X5: 회차가 통째로 사라지면 위반', () => {
    expect(violationsOf(production.filter((p) => p.round !== '2026.08'))).toEqual(
      expect.arrayContaining([expect.stringContaining('회차 사라짐: 합숙 2026.08 (문항 72, 연결 72)')]),
    );
  });

  it('X6: 전체 문항 수가 1% 넘게 줄면 위반', () => {
    const after = [...production.filter((p) => p.round !== '2016.07'), ...round('모의', '2016.07', 980, 900, 400)];
    expect(violationsOf(after)).toEqual([expect.stringContaining('문항 수 급감: 1194 → 1174')]);
  });

  it('X7: 분할본이 통합본으로 대량 전환되면(연결 수는 그대로) 분할본 급감으로 위반', () => {
    const after = [...production.filter((p) => p.round !== '2016.07'), ...round('모의', '2016.07', 1000, 900, 349)];
    expect(violationsOf(after)).toEqual([expect.stringContaining('분할본 연결 급감: 472 → 421')]);
  });

  it('X8: 보고서 — 운영/새 빌드 수치, 위반 목록, 허용 여부 안내', () => {
    const report = compareExplanationLinks(production, production.filter((p) => p.round !== '2026.08'));
    expect(formatLinkReport(report)).toContain('❌ 급감 감지 — 배포 중단');
    expect(formatLinkReport(report, { allowDrop: true })).toContain('`[allow-link-drop]`으로 허용됨');
    expect(formatLinkReport(compareExplanationLinks(production, production))).toContain('✅ 급감 없음');
  });

  it('X9: 분할 PDF 파일명 판별', () => {
    expect(isSplitFileName('합숙_2026.08_공통_1일차_2교시_02_6G_이동통신기술.pdf')).toBe(true);
    expect(isSplitFileName('기출_138_정보관리_1_03_ISOIEC.pdf')).toBe(true);
    expect(isSplitFileName('KPC 140회 대비 합숙해설집_1일차_2교시_통합.pdf')).toBe(false);
    expect(isSplitFileName(null)).toBe(false);
  });

  it('X10: 허용은 로컬 ALLOW_LINK_DROP=1·수동 입력·커밋 제목의 토큰만 — 본문에 설명으로 적힌 토큰은 무시', () => {
    expect(shouldAllowLinkDrop({ COMMIT_MESSAGE: 'fix(data): 어긋난 분할 폴백 [allow-link-drop]\n\n설명' })).toBe(true);
    expect(shouldAllowLinkDrop({ COMMIT_MESSAGE: 'ci: 연결 급감 게이트\n\n의도한 감소는 [allow-link-drop]' })).toBe(false);
    expect(shouldAllowLinkDrop({ ALLOW_LINK_DROP_INPUT: 'true', COMMIT_MESSAGE: '' })).toBe(true);
    expect(shouldAllowLinkDrop({ ALLOW_LINK_DROP_INPUT: 'false' })).toBe(false);
    expect(shouldAllowLinkDrop({ ALLOW_LINK_DROP: '1' })).toBe(true);
    expect(shouldAllowLinkDrop({})).toBe(false);
  });
});
