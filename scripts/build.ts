/**
 * 데이터 빌드 파이프라인.
 *
 * data/source/* 의 원본 파일들을 어댑터로 변환 → 병합 → 정렬 →
 * data/problems.json (전체) 출력.
 *
 * (problems.min.json / stats.json은 5단계에서 추가)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { KpcXlsAdapter } from './adapters/kpc-xls-adapter';
import type {
  AdapterResult,
  AdapterStats,
  AdapterWarning,
  Problem,
  SourceAdapter,
} from './adapters/types';

const __filename = url.fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const DATA_DIR = path.join(ROOT, 'data');
const MAPPINGS_DIR = path.join(DATA_DIR, 'mappings');
const PUBLIC_DATA_DIR = path.join(ROOT, 'public', 'data');
const OUT_PROBLEMS = path.join(DATA_DIR, 'problems.json');
const OUT_STATS = path.join(DATA_DIR, 'stats.json');
const OUT_PROBLEMS_PUBLIC = path.join(PUBLIC_DATA_DIR, 'problems.json');
const OUT_STATS_PUBLIC = path.join(PUBLIC_DATA_DIR, 'stats.json');
const EXPLANATION_FILES = path.join(MAPPINGS_DIR, 'explanation-files.json');

interface SourceConfig {
  /** 어댑터 인스턴스 */
  adapter: SourceAdapter;
  /** 소스 디렉토리 (data/source/<name>) */
  dir: string;
  /** 처리할 파일 패턴 — 확장자 화이트리스트 */
  extensions: string[];
}

function resolveSources(): SourceConfig[] {
  return [
    {
      adapter: new KpcXlsAdapter(),
      dir: path.join(DATA_DIR, 'source', 'kpc'),
      extensions: ['.xls', '.xlsx'],
    },
    // ITPE / custom 어댑터 등록 자리 — 향후 추가
  ];
}

function listFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => exts.includes(path.extname(f).toLowerCase()))
    .filter((f) => !f.startsWith('~$') && !f.startsWith('.'))
    .map((f) => path.join(dir, f))
    .sort(); // 파일명 기준 정렬 (신규 회차 추가 시 결정적 순서)
}

async function runAdapter(
  cfg: SourceConfig,
): Promise<{ files: string[]; results: AdapterResult[] }> {
  const files = listFiles(cfg.dir, cfg.extensions);
  if (files.length === 0) {
    console.log(`  (소스 없음 — 스킵: ${path.relative(ROOT, cfg.dir)})`);
    return { files: [], results: [] };
  }
  const results: AdapterResult[] = [];
  for (const f of files) {
    if (cfg.adapter.canHandle && !cfg.adapter.canHandle(f)) continue;
    console.log(`  [${cfg.adapter.name}] ${path.relative(ROOT, f)}`);
    const r = await cfg.adapter.parse(f);
    results.push(r);
  }
  return { files, results };
}

// ===== 해설지 매핑 적용 =====

interface ExplanationEntry {
  id: string;
  name?: string;
}

interface ExplanationMap {
  기출?: Record<string, Record<string, ExplanationEntry>>;
  합숙?: Record<string, Record<string, ExplanationEntry>>;
  모의?: Record<string, Record<string, Record<string, ExplanationEntry>>>;
  자체?: Record<string, Record<string, Record<string, ExplanationEntry>>>;
}

function loadExplanationMap(): ExplanationMap {
  if (!fs.existsSync(EXPLANATION_FILES)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(EXPLANATION_FILES, 'utf8'));
    // $comment, $schema, $example 같은 메타 키는 제외
    const clean: ExplanationMap = {};
    if (raw.기출) clean.기출 = raw.기출;
    if (raw.합숙) clean.합숙 = raw.합숙;
    if (raw.모의) clean.모의 = raw.모의;
    if (raw.자체) clean.자체 = raw.자체;
    return clean;
  } catch (err) {
    console.warn(`⚠ ${path.relative(ROOT, EXPLANATION_FILES)} 파싱 실패 — 매핑 없이 진행:`, err);
    return {};
  }
}

/**
 * problem에 explanationFileId / explanationFileName을 채움 (in-place).
 * 키 규칙:
 *   기출:  {round}.{session}
 *   기출:  {round}.{session}_{certScope}
 *   합숙:  {round}.{session}_{sessionPart}
 *   모의:  {academy}.{round}.{session}
 *   자체:  {academy}.{round}.{session}
 */
function applyExplanationMap(problems: Problem[], map: ExplanationMap): number {
  let matched = 0;
  for (const p of problems) {
    let entry: ExplanationEntry | undefined;
    if (p.sourceType === '기출') {
      // sync에서 키를 `${session}_${certScope}` 형태로 저장 (정보관리/컴시응 분리)
      const certKey = `${p.session}_${p.certScope}`;
      entry = map.기출?.[p.round]?.[certKey] ?? map.기출?.[p.round]?.[p.session];
    } else if (p.sourceType === '합숙') {
      const key = p.sessionPart ? `${p.session}_${p.sessionPart}` : p.session;
      entry = map.합숙?.[p.round]?.[key];
    } else if (p.sourceType === '모의' && p.academy) {
      entry = map.모의?.[p.academy]?.[p.round]?.[p.session];
    } else if (p.sourceType === '자체' && p.academy) {
      entry = map.자체?.[p.academy]?.[p.round]?.[p.session];
    }
    if (entry) {
      p.explanationFileId = entry.id;
      p.explanationFileName = entry.name ?? null;
      matched++;
    }
  }
  return matched;
}

function mergeProblems(allResults: AdapterResult[]): Problem[] {
  const merged: Problem[] = [];
  for (const r of allResults) merged.push(...r.problems);
  // 정렬: sourceType → roundOrder → certScope → session → questionNumber
  const sourceOrder: Record<string, number> = {
    기출: 0,
    합숙: 1,
    모의: 2,
    자체: 3,
  };
  merged.sort((a, b) => {
    const so = (sourceOrder[a.sourceType] ?? 99) - (sourceOrder[b.sourceType] ?? 99);
    if (so !== 0) return so;
    if (a.roundOrder !== b.roundOrder) return a.roundOrder - b.roundOrder;
    if (a.certScope !== b.certScope) return a.certScope.localeCompare(b.certScope);
    if (a.session !== b.session) return a.session.localeCompare(b.session);
    const qa = a.questionNumber ?? 9999;
    const qb = b.questionNumber ?? 9999;
    return qa - qb;
  });
  return merged;
}

interface BuildStats {
  generatedAt: string;
  total: number;
  bySourceType: Record<string, number>;
  byCertScope: Record<string, number>;
  byAcademy: Record<string, number>;
  byRound: Record<string, Record<string, number>>; // sourceType → round → count
  bySheet: Record<string, { input: number; output: number }>;
  skipped: number;
  warnings: { info: number; warn: number; error: number };
}

function buildStats(
  problems: Problem[],
  adapterStats: AdapterStats[],
  warnings: AdapterWarning[],
): BuildStats {
  const bySourceType: Record<string, number> = {};
  const byCertScope: Record<string, number> = {};
  const byAcademy: Record<string, number> = {};
  const byRound: Record<string, Record<string, number>> = {};

  for (const p of problems) {
    bySourceType[p.sourceType] = (bySourceType[p.sourceType] ?? 0) + 1;
    byCertScope[p.certScope] = (byCertScope[p.certScope] ?? 0) + 1;
    const aca = p.academy ?? '(없음)';
    byAcademy[aca] = (byAcademy[aca] ?? 0) + 1;
    const r = (byRound[p.sourceType] ??= {});
    r[p.round] = (r[p.round] ?? 0) + 1;
  }

  const bySheet: Record<string, { input: number; output: number }> = {};
  let skipped = 0;
  for (const s of adapterStats) {
    for (const sheet of Object.keys(s.inputRows)) {
      bySheet[sheet] = {
        input: (bySheet[sheet]?.input ?? 0) + (s.inputRows[sheet] ?? 0),
        output: (bySheet[sheet]?.output ?? 0) + (s.outputRows[sheet] ?? 0),
      };
    }
    skipped += s.skipped;
  }

  const w = { info: 0, warn: 0, error: 0 };
  for (const x of warnings) w[x.level]++;

  return {
    generatedAt: new Date().toISOString(),
    total: problems.length,
    bySourceType,
    byCertScope,
    byAcademy,
    byRound,
    bySheet,
    skipped,
    warnings: w,
  };
}

function printDetailedStats(stats: BuildStats) {
  const fmtRow = (k: string, v: number) =>
    `  ${k.padEnd(14)} ${v.toLocaleString().padStart(7)}건`;

  console.log('\n━━━━━ 시트별 ━━━━━');
  for (const [sheet, c] of Object.entries(stats.bySheet)) {
    const lost = c.input - c.output;
    const lostStr = lost > 0 ? ` (− ${lost} 스킵)` : '';
    console.log(`  ${sheet.padEnd(6)} 입력 ${String(c.input).padStart(5)} → 출력 ${String(c.output).padStart(5)}${lostStr}`);
  }

  console.log('\n━━━━━ 출처유형별 ━━━━━');
  for (const [k, v] of Object.entries(stats.bySourceType)) console.log(fmtRow(k, v));

  console.log('\n━━━━━ 종목별 ━━━━━');
  for (const [k, v] of Object.entries(stats.byCertScope)) console.log(fmtRow(k, v));

  console.log('\n━━━━━ 학원별 ━━━━━');
  for (const [k, v] of Object.entries(stats.byAcademy)) console.log(fmtRow(k, v));

  console.log('\n━━━━━ 회차별 (샘플) ━━━━━');
  for (const [src, rounds] of Object.entries(stats.byRound)) {
    const entries = Object.entries(rounds).sort();
    const total = entries.reduce((a, [, v]) => a + v, 0);
    console.log(`  [${src}] ${entries.length}개 회차, 총 ${total}건`);
    const head = entries.slice(0, 3);
    const tail = entries.slice(-3);
    const preview =
      entries.length <= 6
        ? entries
        : [...head, ['…', 0] as [string, number], ...tail];
    for (const [round, count] of preview) {
      if (round === '…') console.log('    …');
      else console.log(`    ${round.padEnd(10)} ${String(count).padStart(4)}건`);
    }
  }
}

function printAdapterSummary(stats: AdapterStats[], warnings: AdapterWarning[]) {
  console.log('\n— 어댑터별 입력/출력 —');
  for (const s of stats) {
    const sheets = Object.keys(s.inputRows);
    for (const sh of sheets) {
      const inn = s.inputRows[sh] ?? 0;
      const out = s.outputRows[sh] ?? 0;
      console.log(`  [${s.adapter}] ${sh}: 입력 ${inn} → 출력 ${out}`);
    }
    if (s.skipped > 0) console.log(`  [${s.adapter}] 스킵: ${s.skipped}`);
  }
  if (warnings.length > 0) {
    const byLevel = warnings.reduce<Record<string, number>>((acc, w) => {
      acc[w.level] = (acc[w.level] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `\n— 경고 ${warnings.length}건 (${Object.entries(byLevel)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')}) —`,
    );
    // 처음 5개만 미리보기
    for (const w of warnings.slice(0, 5)) {
      console.log(`  [${w.level}] ${w.message}`, w.context ?? '');
    }
    if (warnings.length > 5) console.log(`  ... 외 ${warnings.length - 5}건`);
  }
}

async function main() {
  console.log('▶ kpcitpe-search build:data');
  const sources = resolveSources();

  const allStats: AdapterStats[] = [];
  const allWarnings: AdapterWarning[] = [];
  const allResults: AdapterResult[] = [];

  for (const cfg of sources) {
    const { results } = await runAdapter(cfg);
    for (const r of results) {
      allResults.push(r);
      allStats.push(r.stats);
      allWarnings.push(...r.warnings);
    }
  }

  const problems = mergeProblems(allResults);
  printAdapterSummary(allStats, allWarnings);

  // 해설지 매핑 적용
  const explanationMap = loadExplanationMap();
  const matchedExplanations = applyExplanationMap(problems, explanationMap);
  console.log(
    `\n— 해설지 매핑 — ${matchedExplanations.toLocaleString()}건 매핑됨 / 전체 ${problems.length.toLocaleString()}건`,
  );

  const stats = buildStats(problems, allStats, allWarnings);
  printDetailedStats(stats);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
  const problemsJson = JSON.stringify(problems);
  const statsJson = JSON.stringify(stats, null, 2);
  fs.writeFileSync(OUT_PROBLEMS, problemsJson, 'utf8');
  fs.writeFileSync(OUT_STATS, statsJson, 'utf8');
  // public/data/ — 클라이언트 fetch용 (Astro가 정적 자산으로 배포)
  fs.writeFileSync(OUT_PROBLEMS_PUBLIC, problemsJson, 'utf8');
  fs.writeFileSync(OUT_STATS_PUBLIC, statsJson, 'utf8');

  const sizeMB = (fs.statSync(OUT_PROBLEMS).size / 1024 / 1024).toFixed(2);
  console.log(
    `\n✔ ${path.relative(ROOT, OUT_PROBLEMS)} — ${problems.length.toLocaleString()}건 (${sizeMB} MB)`,
  );
  console.log(`✔ ${path.relative(ROOT, OUT_STATS)}`);
  console.log(`✔ ${path.relative(ROOT, OUT_PROBLEMS_PUBLIC)} (fetch용 사본)`);

  // 검증: requirements.md §0 기준 약 12,158건 (기출 2,699 + 모의 5,881 + 합숙 3,578)
  const EXPECTED = { 기출: 2699, 모의: 5881, 합숙: 3578 };
  const mismatches: string[] = [];
  for (const [k, expected] of Object.entries(EXPECTED)) {
    const actual = stats.bySourceType[k] ?? 0;
    const diff = actual - expected;
    if (Math.abs(diff) > expected * 0.01) {
      mismatches.push(`${k}: 기대 ${expected}, 실제 ${actual} (${diff >= 0 ? '+' : ''}${diff})`);
    }
  }
  if (mismatches.length > 0) {
    console.log('\n⚠ 기대치(±1%)와 차이:');
    for (const m of mismatches) console.log(`  - ${m}`);
  } else {
    console.log('\n✔ 기대치(±1% 이내) 일치');
  }
}

main().catch((err) => {
  console.error('빌드 실패:', err);
  process.exit(1);
});
