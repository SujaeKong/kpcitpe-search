/**
 * 실험 — 제목만으로 문항 시작 페이지를 특정할 수 있는가 (통합본 폴백 detect-gap 375개 대책 조사).
 *
 * 배경: 전수 감사 720개 중 detect-gap 313(미검출)+42(검출 전무)가 남은 최대 덩어리다.
 * 현재 보강(fillMissingRangesByTitle)은 ① 페이지 머리에 `N.` 숫자 마커가 있어야 하고
 * ② 문항번호가 1..N이라고 가정해서, 이 375건에서는 한 건도 발동하지 않았다(보강 0).
 *
 * 그래서 숫자를 전혀 쓰지 않는 판정을 재 본다 — 각 문항 제목에 대해
 *   "제목 토큰 60% 이상이 머리말에 있고, 그 페이지에 다른 문항 제목은 맞지 않는" 페이지
 * 를 찾고, 전 문항이 유일하게 찾히며 페이지가 문항 순서대로 단조증가하는지 본다.
 * 이 조건이 성립하면 시그널 없이도 짝짓기가 결정된다(순서가 틀어지면 바로 드러난다).
 *
 * 쓰기 없음. 결과: tmp-split/title-anchor-experiment.json
 * 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON, CONCURRENCY, AUDIT_ONLY, SAMPLE, DUMP, HEAD_CHARS
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { checkSplitGuards, detectRanges, downloadPdf, extractPageTexts, makeReadDrive } from './split-pdfs';
import { titleTokens } from './lib/split-content';
import { collect, sample } from './audit-text-layer';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

interface Hit { titleIndex: number; page: number; ratio: number }

/** 제목 토큰 비율 — 공백 제거·소문자 비교 */
function ratio(flat: string, tokens: string[]): number {
  if (tokens.length < 2) return 0;
  return tokens.filter((t) => flat.includes(t)).length / tokens.length;
}

/**
 * 제목 기반 앵커 후보. 각 페이지 머리말에서 어떤 문항 제목이 맞는지 보고,
 * 한 페이지에 두 제목 이상이 맞으면(목록/표지 페이지) 그 페이지는 버린다.
 */
function titleAnchors(pageTexts: string[], titles: string[], headChars: number, min: number) {
  const tokenSets = titles.map(titleTokens);
  const hits: Hit[] = [];
  for (let i = 0; i < pageTexts.length; i++) {
    const flat = pageTexts[i].slice(0, headChars).replace(/\s+/g, '').toLowerCase();
    const matched = tokenSets
      .map((tokens, titleIndex) => ({ titleIndex, ratio: ratio(flat, tokens) }))
      .filter((m) => m.ratio >= min);
    if (matched.length !== 1) continue; // 0개 또는 2개 이상(목록 페이지) → 앵커 아님
    hits.push({ titleIndex: matched[0].titleIndex, page: i + 1, ratio: matched[0].ratio });
  }
  // 문항별로 앵커가 몇 개인지 — 2개 이상이면 (같은 제목이 여러 페이지) 가장 앞 페이지를 쓴다
  const byTitle = new Map<number, Hit[]>();
  for (const h of hits) {
    const arr = byTitle.get(h.titleIndex) ?? [];
    arr.push(h);
    byTitle.set(h.titleIndex, arr);
  }
  const chosen: (Hit | undefined)[] = titles.map((_, i) => (byTitle.get(i) ?? []).sort((a, b) => a.page - b.page)[0]);
  const located = chosen.filter(Boolean).length;
  const pages = chosen.map((h) => h?.page ?? 0);
  const monotonic = pages.every((p, i) => i === 0 || (p > 0 && pages[i - 1] > 0 ? p > pages[i - 1] : true));
  const multi = [...byTitle.values()].filter((a) => a.length > 1).length;
  return { located, pages, monotonic, multi, chosen };
}

async function main() {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mappings/explanation-files.json'), 'utf8'));
  const problems = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/problems.json'), 'utf8'));
  const only = (process.env.AUDIT_ONLY ?? '').trim();
  const concurrency = Math.max(1, parseInt(process.env.CONCURRENCY ?? '8', 10));
  const headChars = parseInt(process.env.HEAD_CHARS ?? '800', 10);
  const dumpN = parseInt(process.env.DUMP ?? '4', 10);
  const drive = makeReadDrive();
  const all = sample(collect(map, problems, only), parseInt(process.env.SAMPLE ?? '0', 10));
  console.log(`대상 통합본 ${all.length}개 — 제목 기반 앵커 가능성 측정 (머리말 ${headChars}자)`);

  const rows: any[] = [];
  const dumps: any[] = [];
  let done = 0;
  const queue = [...all];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      try {
        const pages = await extractPageTexts(await downloadPdf(drive, t.fileId));
        const det = detectRanges(pages, t.titles);
        const guard = checkSplitGuards(det.ranges, pages, t.titles, { expectedNumbers: t.numbers });
        if (guard.ok) { done++; continue; } // 이미 분할될 건 — 조사 대상 아님
        const a = titleAnchors(pages, t.titles, headChars, 0.6);
        rows.push({
          key: t.key, name: t.fileName, pages: pages.length, problems: t.titles.length,
          signal: det.signal, detected: det.ranges.length, guardReason: guard.reason,
          located: a.located, monotonic: a.monotonic, multiAnchor: a.multi,
          anchorPages: a.pages, blanks: pages.filter((p) => p.replace(/\s/g, '').length < 120).length,
        });
        // 전부 찾혔지만 순서가 깨진 건 위험 신호 — 머리말을 본다
        if (dumps.length < dumpN && a.located === t.titles.length && !a.monotonic) {
          dumps.push({ key: t.key, pages: a.pages, heads: a.chosen.map((h, i) => ({ title: t.titles[i].slice(0, 40), page: h?.page ?? 0 })) });
        }
      } catch (err) { rows.push({ key: t.key, error: (err as Error).message }); }
      if (++done % 50 === 0) console.log(`  …${done}/${all.length}`);
    }
  }));

  const okRows = rows.filter((r) => !r.error);
  const full = okRows.filter((r) => r.located === r.problems);
  const fullMono = full.filter((r) => r.monotonic);
  const fullBad = full.filter((r) => !r.monotonic);
  const partial = okRows.filter((r) => r.located > 0 && r.located < r.problems);
  const none = okRows.filter((r) => r.located === 0);
  const sum = (g: any[]) => g.reduce((a, r) => a + r.problems, 0);
  console.log('\n━━━━━ 제목 기반 앵커 측정 ━━━━━');
  console.log(`조사 ${okRows.length}개 (오류 ${rows.length - okRows.length})`);
  console.log(`  전 문항 특정 + 순서 정상: ${fullMono.length}개 / ${sum(fullMono)}문항  ← 제목만으로 분할 가능`);
  console.log(`  전 문항 특정 but 순서 깨짐: ${fullBad.length}개 / ${sum(fullBad)}문항  ← 엑셀·PDF 순서 불일치 의심`);
  console.log(`  일부만 특정: ${partial.length}개 / ${sum(partial)}문항`);
  console.log(`  하나도 못 찾음: ${none.length}개 / ${sum(none)}문항`);
  const near = partial.filter((r) => r.problems - r.located <= 2);
  console.log(`  (일부 중 1~2문항만 부족: ${near.length}개 / ${sum(near)}문항)`);
  console.log(`  같은 제목이 여러 페이지에 걸린 건: ${okRows.filter((r) => r.multiAnchor > 0).length}개`);
  console.log('\n제목만으로 분할 가능한 건 (최대 25):');
  for (const r of fullMono.slice(0, 25)) console.log(`  ${r.key}: ${r.problems}문항 p[${r.anchorPages}] (시그널 ${r.signal} ${r.detected}개, ${r.guardReason})`);
  if (fullBad.length) {
    console.log('\n순서 깨진 건 (최대 15) — 자동 분할 금지 후보:');
    for (const r of fullBad.slice(0, 15)) console.log(`  ${r.key}: p[${r.anchorPages}]`);
  }
  for (const d of dumps) {
    console.log(`\n─── 순서 깨짐 상세 ${d.key}`);
    for (const h of d.heads) console.log(`  p${String(h.page).padStart(3)} ← ${h.title}`);
  }
  fs.mkdirSync(path.join(ROOT, 'tmp-split'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp-split/title-anchor-experiment.json'), `${JSON.stringify({ headChars, rows }, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 제목 기반 앵커 측정\n\n- 조사 ${okRows.length}개\n- 제목만으로 분할 가능 **${fullMono.length}개 / ${sum(fullMono)}문항**\n- 순서 깨짐 ${fullBad.length}개, 일부만 ${partial.length}개, 전무 ${none.length}개\n`);
  }
}

main().catch((err) => { console.error('제목 앵커 실험 실패:', err); process.exit(1); });
