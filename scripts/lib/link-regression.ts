/**
 * 해설지 연결 회귀 판정 — 운영 중인 problems.json(기준)과 새 빌드를 출처·회차별 "개수"로 비교한다.
 * 문항 ID는 쓰지 않는다(정규화 변경으로 ID가 바뀌어도 오탐하지 않도록).
 */

export interface LinkProblem {
  sourceType: string;
  round: string;
  explanationFileId?: string | null;
  explanationFileName?: string | null;
}

export interface LinkStats {
  problems: number;
  linked: number;
  split: number;
}

export interface LinkRegressionOptions {
  /** 전체 문항 수 감소 허용 비율 */
  maxProblemDropRatio: number;
  /** 전체 해설지 연결 감소 허용치 = max(count, 기준×ratio) */
  maxLinkedDrop: { count: number; ratio: number };
  /** 전체 분할본 연결 감소 허용치 = max(count, 기준×ratio) */
  maxSplitDrop: { count: number; ratio: number };
  /** 회차 하나에서 minLost건 이상이면서 ratio 이상 끊기면 위반 */
  groupLinkedDrop: { minLost: number; ratio: number };
}

export const DEFAULT_LINK_OPTIONS: LinkRegressionOptions = {
  maxProblemDropRatio: 0.01,
  maxLinkedDrop: { count: 50, ratio: 0.01 },
  maxSplitDrop: { count: 50, ratio: 0.02 },
  groupLinkedDrop: { minLost: 5, ratio: 0.5 },
};

const SPLIT_FILE_NAME = /^(?:기출|합숙|모의|자체)_[^_]+_[^_]+_(?:\d+일차_\d+교시|\d+)_\d+_.+\.pdf$/;

/** 문항별 분할 PDF 파일명인지 (`{종류}_{회차}_{종목}_{교시}_{번호}_{주제어}.pdf`) */
export function isSplitFileName(name: string | null | undefined): boolean {
  return !!name && SPLIT_FILE_NAME.test(name.normalize('NFC'));
}

export function summarizeLinks(problems: LinkProblem[]): { total: LinkStats; groups: Map<string, LinkStats> } {
  const total: LinkStats = { problems: 0, linked: 0, split: 0 };
  const groups = new Map<string, LinkStats>();
  for (const p of problems) {
    const key = `${p.sourceType} ${p.round}`;
    const g = groups.get(key) ?? { problems: 0, linked: 0, split: 0 };
    const linked = p.explanationFileId ? 1 : 0;
    const split = linked && isSplitFileName(p.explanationFileName) ? 1 : 0;
    for (const s of [g, total]) {
      s.problems++;
      s.linked += linked;
      s.split += split;
    }
    groups.set(key, g);
  }
  return { total, groups };
}

export interface LinkRegressionReport {
  before: LinkStats;
  after: LinkStats;
  violations: string[];
  /** 문항·연결·분할 수가 달라진 회차 (변화 큰 순) */
  groupChanges: { group: string; before: LinkStats | null; after: LinkStats | null }[];
}

export function compareExplanationLinks(
  before: LinkProblem[],
  after: LinkProblem[],
  options: LinkRegressionOptions = DEFAULT_LINK_OPTIONS,
): LinkRegressionReport {
  const b = summarizeLinks(before);
  const a = summarizeLinks(after);
  const allowance = (base: number, rule: { count: number; ratio: number }) => Math.max(rule.count, Math.floor(base * rule.ratio));
  const violations: string[] = [];

  const lostProblems = b.total.problems - a.total.problems;
  if (lostProblems > b.total.problems * options.maxProblemDropRatio) {
    violations.push(`문항 수 급감: ${b.total.problems} → ${a.total.problems} (−${lostProblems})`);
  }
  const lostLinked = b.total.linked - a.total.linked;
  if (lostLinked > allowance(b.total.linked, options.maxLinkedDrop)) {
    violations.push(`해설지 연결 급감: ${b.total.linked} → ${a.total.linked} (−${lostLinked}, 허용 ${allowance(b.total.linked, options.maxLinkedDrop)})`);
  }
  const lostSplit = b.total.split - a.total.split;
  if (lostSplit > allowance(b.total.split, options.maxSplitDrop)) {
    violations.push(`분할본 연결 급감: ${b.total.split} → ${a.total.split} (−${lostSplit}, 허용 ${allowance(b.total.split, options.maxSplitDrop)})`);
  }

  const groupChanges: LinkRegressionReport['groupChanges'] = [];
  for (const group of new Set([...b.groups.keys(), ...a.groups.keys()])) {
    const bg = b.groups.get(group) ?? null;
    const ag = a.groups.get(group) ?? null;
    if (bg && !ag) {
      violations.push(`회차 사라짐: ${group} (문항 ${bg.problems}, 연결 ${bg.linked})`);
    } else if (bg && ag) {
      const lost = bg.linked - ag.linked;
      if (lost >= options.groupLinkedDrop.minLost && lost >= bg.linked * options.groupLinkedDrop.ratio) {
        violations.push(`회차 해설지 연결 급감: ${group} ${bg.linked} → ${ag.linked} (−${lost})`);
      }
    }
    if (JSON.stringify(bg) !== JSON.stringify(ag)) groupChanges.push({ group, before: bg, after: ag });
  }
  const size = (c: LinkRegressionReport['groupChanges'][number]) =>
    Math.abs((c.after?.linked ?? 0) - (c.before?.linked ?? 0)) + Math.abs((c.after?.split ?? 0) - (c.before?.split ?? 0));
  groupChanges.sort((x, y) => size(y) - size(x));

  return { before: b.total, after: a.total, violations, groupChanges };
}

export function formatLinkReport(report: LinkRegressionReport, { allowDrop = false, maxRows = 15 } = {}): string {
  const stat = (s: LinkStats | null) => (s ? `${s.problems} / ${s.linked} / ${s.split}` : '없음');
  const lines = [
    '### 해설지 연결 회귀 검사 (운영 → 새 빌드)',
    '',
    '| | 문항 | 해설지 연결 | 분할본 연결 |',
    '|---|---|---|---|',
    `| 운영 | ${report.before.problems} | ${report.before.linked} | ${report.before.split} |`,
    `| 새 빌드 | ${report.after.problems} | ${report.after.linked} | ${report.after.split} |`,
    '',
  ];
  if (report.violations.length === 0) {
    lines.push('✅ 급감 없음');
  } else {
    lines.push(allowDrop ? '⚠️ 급감이 있지만 `[allow-link-drop]`으로 허용됨:' : '❌ 급감 감지 — 배포 중단 (의도한 감소면 커밋 메시지에 `[allow-link-drop]`):');
    for (const v of report.violations) lines.push(`- ${v}`);
  }
  if (report.groupChanges.length > 0) {
    lines.push('', `변경된 회차 ${report.groupChanges.length}개 (문항 / 연결 / 분할, 변화 큰 순):`);
    for (const c of report.groupChanges.slice(0, maxRows)) lines.push(`- ${c.group}: ${stat(c.before)} → ${stat(c.after)}`);
  }
  return lines.join('\n');
}
