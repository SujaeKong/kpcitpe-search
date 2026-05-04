/**
 * 합숙 데이터의 일차 × 문항 수 패턴 분석.
 * 한 (round, cert, session) 그룹에 몇 개 문항이 있는지 봐서 1교시형/2교시형 추정.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import type { Problem } from './adapters/types';

const __filename = url.fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const problems: Problem[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'problems.json'), 'utf8'),
);

const hapsuk = problems.filter((p) => p.sourceType === '합숙');

// 그룹: (round, cert, session) → 문항들
const groups = new Map<string, Problem[]>();
for (const p of hapsuk) {
  const key = `${p.round}|${p.certScope}|${p.session}`;
  let g = groups.get(key);
  if (!g) groups.set(key, (g = []));
  g.push(p);
}

// 그룹 크기 분포
const sizeBuckets = new Map<number, number>();
for (const [, g] of groups) {
  sizeBuckets.set(g.length, (sizeBuckets.get(g.length) ?? 0) + 1);
}
console.log('합숙 그룹 (round × cert × session) 크기 분포:');
[...sizeBuckets.entries()]
  .sort((a, b) => a[0] - b[0])
  .forEach(([size, cnt]) => console.log(`  ${String(size).padStart(3)}문항  → ${cnt}개 그룹`));

// 동일 (round, cert, session) 안에서 questionNumber 중복 여부
console.log('\n같은 그룹 내 questionNumber 중복 (1교시·2교시 동거 신호):');
let groupsWithDup = 0;
const dupExamples: string[] = [];
for (const [key, g] of groups) {
  const numCount = new Map<number | null, number>();
  for (const p of g) {
    numCount.set(p.questionNumber, (numCount.get(p.questionNumber) ?? 0) + 1);
  }
  const dup = [...numCount.entries()].filter(([, c]) => c > 1);
  if (dup.length > 0) {
    groupsWithDup++;
    if (dupExamples.length < 5) {
      dupExamples.push(
        `  ${key}: 총 ${g.length}문항, 중복번호 ${dup.length}개 (예: ${dup
          .slice(0, 3)
          .map(([n, c]) => `${n}×${c}`)
          .join(', ')})`,
      );
    }
  }
}
console.log(`  중복 그룹 수: ${groupsWithDup} / ${groups.size}`);
dupExamples.forEach((e) => console.log(e));

// 한 그룹 샘플 dump (각 size 분포에서 하나씩)
console.log('\n샘플 그룹 (각 사이즈별 1개씩):');
const seenSizes = new Set<number>();
for (const [key, g] of groups) {
  if (seenSizes.has(g.length)) continue;
  seenSizes.add(g.length);
  if (seenSizes.size > 8) break;
  console.log(`\n  ${key} (${g.length}문항):`);
  for (const p of g.slice(0, 20)) {
    console.log(`    ${p.questionLabel}. ${p.title.slice(0, 60)}`);
  }
}
