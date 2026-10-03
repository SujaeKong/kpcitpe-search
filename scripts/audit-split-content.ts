/**
 * 분할본 내용 감사 — Drive에 올라간 분할 PDF를 실제로 읽어 연결된 엑셀 문항과 대조한다. CI 전용(서비스계정 읽기).
 *
 * 왜 필요한가: scripts/lib/split-content.ts 주석 참고. 파일명·내부번호 검증·통합본 재검출로는
 * "엉뚱한 문항의 분할본이 그 번호로 연결된" 경우를 잡을 수 없다.
 *
 * 결과: tmp-split/split-content-audit.json + 로그 요약(어긋난 항목은 실제로 몇 번 문항인지까지)
 * 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON, CONCURRENCY(기본 6), AUDIT_ONLY(매핑 경로 접두어)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { matchSplitContent } from './lib/split-content';
import { downloadPdf, extractPageTexts, makeReadDrive, specFromMappingEntry } from './split-pdfs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

interface Row {
  key: string;
  questionNumber: number;
  fileName: string;
  verdict: 'ok' | 'mismatch' | 'weak' | 'error';
  expectedTitle: string;
  expectedScore?: number;
  actualTitle?: string;
  actualQuestionNumber?: number;
  bestScore?: number;
  message?: string;
}

interface Target {
  key: string;
  questionNumber: number;
  fileId: string;
  fileName: string;
  titles: string[];
  numbers: number[];
  /** 연결된 문항의 후보 인덱스 (같은 번호가 2개인 회차 대응) */
  indexes: number[];
}

function collectTargets(map: any, problems: any[], only: string): Target[] {
  const targets: Target[] = [];
  const groups: [('기출' | '합숙' | '모의'), string[], Record<string, any>][] = [
    ['기출', ['기출'], map.기출 ?? {}],
    ['합숙', ['합숙'], map.합숙 ?? {}],
    ['모의', ['모의', 'KPC'], map.모의?.KPC ?? {}],
  ];
  for (const [sourceType, prefix, rounds] of groups) {
    for (const [round, sessions] of Object.entries(rounds)) {
      for (const [key, entry] of Object.entries(sessions as Record<string, any>)) {
        const questions = entry?.questions;
        if (!questions || Object.keys(questions).length === 0) continue;
        const keyPath = [...prefix, round, key].join('/');
        if (only && !keyPath.startsWith(only)) continue;
        const spec = specFromMappingEntry(sourceType, round, key, entry);
        if (!spec) continue;
        const matched = problems
          .filter(spec.problemFilter)
          .filter((p: any) => typeof p.questionNumber === 'number')
          .sort((a: any, b: any) => a.questionNumber - b.questionNumber);
        const titles = matched.map((p: any) => p.title as string);
        const numbers = matched.map((p: any) => p.questionNumber as number);
        for (const [num, q] of Object.entries(questions as Record<string, any>)) {
          const questionNumber = Number(num);
          // 같은 번호가 2개인 회차(옛 모의 종목 선택 문항)는 그 전부를 후보로 본다
          const indexes = numbers.flatMap((n, i) => (n === questionNumber ? [i] : []));
          if (indexes.length === 0) continue; // 엑셀에 없는 번호 — 데이터 테스트(D11) 영역
          targets.push({ key: keyPath, questionNumber, fileId: q.id, fileName: q.name, titles, numbers, indexes });
        }
      }
    }
  }
  return targets;
}

async function main() {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mappings/explanation-files.json'), 'utf8'));
  const problems = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/problems.json'), 'utf8'));
  const only = (process.env.AUDIT_ONLY ?? '').trim();
  const concurrency = Math.max(1, parseInt(process.env.CONCURRENCY ?? '6', 10));
  const drive = makeReadDrive();

  const targets = collectTargets(map, problems, only);
  console.log(`분할본 ${targets.length}개 검사 (only=${only || '전체'}, concurrency=${concurrency})`);

  const rows: Row[] = [];
  let done = 0;
  async function run(t: Target): Promise<void> {
    const base: Row = { key: t.key, questionNumber: t.questionNumber, fileName: t.fileName, verdict: 'ok', expectedTitle: t.indexes.map((i) => t.titles[i]).join(' | ') };
    try {
      const pages = await extractPageTexts(await downloadPdf(drive, t.fileId));
      // 첫 2페이지로 판정 — 1페이지가 표지·머리말만인 경우 대비
      const text = pages.slice(0, 2).join(' ');
      const m = matchSplitContent(text, t.titles, t.indexes);
      rows.push({
        ...base,
        verdict: m.verdict,
        expectedScore: Number(m.expectedScore.toFixed(2)),
        bestScore: Number(m.bestScore.toFixed(2)),
        actualTitle: m.verdict === 'mismatch' && m.bestIndex >= 0 ? t.titles[m.bestIndex] : undefined,
        actualQuestionNumber: m.verdict === 'mismatch' && m.bestIndex >= 0 ? t.numbers[m.bestIndex] : undefined,
      });
      if (m.verdict !== 'ok') {
        const extra = m.verdict === 'mismatch' ? ` → 실제 내용은 ${t.numbers[m.bestIndex]}번 (${m.bestScore.toFixed(2)})` : '';
        console.log(`${m.verdict === 'mismatch' ? '✖' : '△'} ${t.key} ${t.questionNumber}번: ${m.verdict} (연결문항 점수 ${m.expectedScore.toFixed(2)})${extra}`);
      }
    } catch (err) {
      rows.push({ ...base, verdict: 'error', message: (err as Error).message });
      console.log(`⚠ ${t.key} ${t.questionNumber}번: ${(err as Error).message}`);
    }
    done++;
    if (done % 200 === 0) console.log(`  …${done}/${targets.length}`);
  }

  const queue = [...targets];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const t = queue.shift();
        if (!t) return;
        await run(t);
      }
    }),
  );

  const summary = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
  console.log('\n━━━━━ 내용 감사 요약 ━━━━━');
  console.log(JSON.stringify(summary));

  const bad = rows.filter((r) => r.verdict === 'mismatch');
  if (bad.length > 0) {
    const byKey = new Map<string, number>();
    for (const r of bad) byKey.set(r.key, (byKey.get(r.key) ?? 0) + 1);
    console.log(`\n어긋난 분할본 ${bad.length}개 / 영향 받은 해설집 ${byKey.size}개:`);
    for (const [key, n] of [...byKey].sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${n}개`);
    console.log('\n재분할 명령: Split PDFs 워크플로 mode=all, overwrite=true, keys=' + [...byKey.keys()].join(','));
  }

  fs.mkdirSync(path.join(ROOT, 'tmp-split'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp-split/split-content-audit.json'), `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [`### 분할본 내용 감사`, '', `- 검사: ${rows.length}개`, `- 결과: ${JSON.stringify(summary)}`];
    if (bad.length > 0) lines.push('', '**어긋난 항목**', ...bad.map((r) => `- ${r.key} ${r.questionNumber}번 → 실제 ${r.actualQuestionNumber}번`));
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('분할본 내용 감사 실패:', err);
    process.exit(1);
  });
}
