/**
 * 분할 정렬 감사 — 이미 분할된(questions가 있는) 매핑 항목 전부를 통합 PDF로 다시 검사한다. CI 전용(서비스계정 읽기).
 *
 * 분할본 파일명은 엑셀 문항 제목으로 붙이므로 파일명만으로는 내용이 어긋났는지 알 수 없다
 * (예: 기출 87회 1교시 컴시응 — 04_WiBro.pdf 안에 PDF 3번 Haptics). 현재 안전 가드(검출 수·번호·제목 정렬)를
 * 통과하지 못하는 항목을 찾아 통합본 폴백 후보로 보고한다. 매핑·Drive는 바꾸지 않는다.
 *
 * 결과: tmp-split/split-audit.json + 로그 요약
 * 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON, CONCURRENCY(기본 5), AUDIT_ONLY(선택, '기출' 등 출처 접두어)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { NO_RESPLIT_KEYS } from './lib/explanation-keys';
import {
  checkSplitGuards,
  checkTitleAlignment,
  detectQuestionRangesWithSignal,
  downloadPdf,
  extractPageTexts,
  makeReadDrive,
  specFromMappingEntry,
} from './split-pdfs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

interface AuditRow {
  key: string;
  fileName: string;
  signal: string;
  detected: number;
  problemCount: number;
  splitCount: number;
  guard: string;
  message?: string;
  alignmentScores?: Record<number, number>;
}

async function main() {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mappings/explanation-files.json'), 'utf8'));
  const problems = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/problems.json'), 'utf8'));
  const only = process.env.AUDIT_ONLY?.trim();
  const noResplit = new Set(NO_RESPLIT_KEYS);

  const targets: { keyPath: string; entry: any; sourceType: '기출' | '합숙' | '모의'; round: string; key: string }[] = [];
  const groups: ['기출' | '합숙' | '모의', string[], Record<string, any>][] = [
    ['기출', ['기출'], map.기출 ?? {}],
    ['합숙', ['합숙'], map.합숙 ?? {}],
    ['모의', ['모의', 'KPC'], map.모의?.KPC ?? {}],
  ];
  for (const [sourceType, prefix, rounds] of groups) {
    for (const [round, sessions] of Object.entries(rounds)) {
      for (const [key, entry] of Object.entries(sessions as Record<string, any>)) {
        const keyPath = [...prefix, round, key].join('/');
        if (!entry?.questions || Object.keys(entry.questions).length === 0) continue;
        if (noResplit.has(keyPath) || (only && !keyPath.startsWith(only))) continue;
        targets.push({ keyPath, entry, sourceType, round, key });
      }
    }
  }
  console.log(`감사 대상 ${targets.length}개 (분할된 항목)`);

  const drive = makeReadDrive();
  const rows: AuditRow[] = [];
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const t = targets[next++];
      const spec = specFromMappingEntry(t.sourceType, t.round, t.key, t.entry);
      if (!spec) continue;
      const titles = problems
        .filter(spec.problemFilter)
        .filter((p: any) => typeof p.questionNumber === 'number')
        .sort((a: any, b: any) => a.questionNumber - b.questionNumber)
        .map((p: any) => p.title as string);
      try {
        const pages = await extractPageTexts(await downloadPdf(drive, t.entry.id));
        const { signal, ranges } = detectQuestionRangesWithSignal(pages);
        const guard = checkSplitGuards(ranges, pages, titles);
        const byPage = [...ranges].sort((a, b) => a.startPage - b.startPage);
        const row: AuditRow = {
          key: t.keyPath,
          fileName: t.entry.name,
          signal,
          detected: ranges.length,
          problemCount: titles.length,
          splitCount: Object.keys(t.entry.questions).length,
          guard: guard.ok ? 'ok' : guard.reason,
          message: guard.ok ? undefined : guard.message,
          alignmentScores:
            ranges.length === titles.length ? checkTitleAlignment(byPage.map((r) => pages[r.startPage - 1] ?? ''), titles).scores : undefined,
        };
        rows.push(row);
        console.log(`${row.guard === 'ok' ? '✔' : '✖'} ${row.key}: ${row.guard} (${signal} 검출 ${ranges.length}/문항 ${titles.length}/분할 ${row.splitCount})${row.alignmentScores ? ` 정렬점수 ${JSON.stringify(row.alignmentScores)}` : ''}`);
      } catch (err) {
        rows.push({ key: t.keyPath, fileName: t.entry.name, signal: '-', detected: 0, problemCount: titles.length, splitCount: Object.keys(t.entry.questions).length, guard: 'error', message: (err as Error).message });
        console.log(`⚠ ${t.keyPath}: ${(err as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Number(process.env.CONCURRENCY ?? 5)) }, worker));

  rows.sort((a, b) => a.key.localeCompare(b.key));
  fs.mkdirSync(path.join(ROOT, 'tmp-split'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp-split', 'split-audit.json'), JSON.stringify(rows, null, 2));
  const summary = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.guard] = (acc[r.guard] ?? 0) + 1), acc), {});
  console.log(`\n━━━━━ 감사 요약 ━━━━━\n${JSON.stringify(summary)}`);
  for (const r of rows.filter((x) => x.guard === 'alignment')) console.log(`  정렬 어긋남 후보: ${r.key} ${JSON.stringify(r.alignmentScores)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('감사 실패:', err);
    process.exit(1);
  });
}
