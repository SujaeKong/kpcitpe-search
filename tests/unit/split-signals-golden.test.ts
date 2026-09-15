/**
 * 실제 해설지 PDF 기반 분할 시그널 회귀 테스트.
 * 픽스처(tests/fixtures/split-signals/*.json.gz)는 split-fixtures 워크플로가 실제 PDF 페이지 텍스트를
 * 본문을 가린 골격 텍스트로 바꿔 저장한 것 — 검출 결과는 원문과 같다는 것을 캡처 시 확인했다.
 * 시그널 정규식·구간 계산·가드를 고치다 실제 형식의 검출이 달라지면 여기서 실패한다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkSplitGuards, detectQuestionRangesWithSignal, type QuestionRange } from '../../scripts/split-pdfs';

interface Fixture {
  key: string;
  fileName: string;
  problemCount: number;
  expected: { signal: string; ranges: QuestionRange[]; guard: string; guardWithoutAlignment: string };
  pages: string[];
}

const DIR = fileURLToPath(new URL('../fixtures/split-signals', import.meta.url));
const fixtures: Fixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json.gz'))
  .sort()
  .map((f) => JSON.parse(gunzipSync(readFileSync(path.join(DIR, f))).toString('utf8')));

describe('실제 해설지 PDF (골격 텍스트)', () => {
  it('W0: 픽스처가 12개 이상이다', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });

  it.each(fixtures.map((f) => [f.key, f] as const))('W1 %s: 검출 시그널·구간·가드 결과가 캡처 당시와 같다', (_key, f) => {
    const result = detectQuestionRangesWithSignal(f.pages);
    expect(result).toEqual({ signal: f.expected.signal, ranges: f.expected.ranges });
    const guard = checkSplitGuards(result.ranges, f.pages, Array<string>(f.problemCount).fill(''), { alignment: false });
    expect(guard.ok ? 'ok' : guard.reason).toBe(f.expected.guardWithoutAlignment);
  });

  it('W2: 픽스처에 해설 본문이 남아 있지 않다 (골격 문자만)', () => {
    const leaks: string[] = [];
    for (const f of fixtures) {
      f.pages.forEach((page, i) => {
        const rest = page.replace(/rights\s+reserved/g, '');
        const bad = rest.match(/[B-Zb-z]|[가-힣](?<![가문제풀이출도메인교시번배경의])|[^\s\x00-\x7f가-힣·]/u);
        if (bad) leaks.push(`${f.key} p${i + 1}: ${JSON.stringify(bad[0])}`);
      });
    }
    expect(leaks.slice(0, 5)).toEqual([]);
  });
});
