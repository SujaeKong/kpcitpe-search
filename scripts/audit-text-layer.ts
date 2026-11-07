/**
 * 텍스트 레이어 감사 — "PDF에 글자가 없어서" 분할이 안 되는 규모를 센다. CI 전용(서비스계정 읽기).
 *
 * 배경: 모의 2023.12 1교시는 13·15번 해설이 **텍스트 레이어 없는 이미지 페이지**로 들어가 있어
 * `문 제 N.` 마커도 제목 토큰도 추출되지 않는다(페이지 크기도 595×841 vs 595.2×841.92로 다름).
 * 텍스트 기반 검출로는 원리상 불가능하고 통합본 폴백이 맞다. OCR 도입 가치를 판단하려면
 * 그런 페이지가 전체에서 얼마나 되는지 알아야 한다.
 *
 * 모드 (AUDIT_TARGET):
 *   combined(기본) — 미분할·부분분할 통합본을 읽어 빈 페이지 수·검출 결과·**실제 분할 가드 판정**을 집계.
 *                    원인은 scripts/lib/split-fallback.ts의 classifyFallback으로 분류한다
 *                    (no-resplit / image-heavy / no-signal / ocr-candidate / detect-gap / sequence / alignment / ok).
 *                    2026-11-07 이전 버전은 가드를 호출하지 않고 "빈 페이지가 있으면 OCR 후보"로 세어
 *                    OCR 효과를 과대계상했다 — 누락 ≤ 빈 페이지일 때만 OCR로 설명된다.
 *   splits        — 이미 올라간 분할본의 텍스트 길이 측정 (내용 감사의 weak 판정이 이미지 탓인지 확인).
 *
 * 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON, CONCURRENCY(기본 6), AUDIT_ONLY(키 접두어),
 *          AUDIT_TARGET(combined|splits), SAMPLE(표본 수, 0=전체)
 * 결과: tmp-split/text-layer-audit.json
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import {
  checkSplitGuards, checkTitleAlignment, detectRanges, downloadPdf, extractPageTexts,
  makeReadDrive, specFromMappingEntry,
} from './split-pdfs';
import { NO_RESPLIT_KEYS } from './lib/explanation-keys';
import { CAUSE_NOTE, classifyFallback, type FallbackCause } from './lib/split-fallback';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
/** 머리말·쪽번호만 남은 페이지도 '글자 없음'으로 본다 — 본문이 이미지인 경우 */
const BLANK_CHARS = 120;

interface Entry { key: string; fileId: string; fileName: string; titles: string[]; numbers: number[]; splitCount: number }

function collect(map: any, problems: any[], only: string): Entry[] {
  const out: Entry[] = [];
  const groups: [('기출' | '합숙' | '모의'), string[], Record<string, any>][] = [
    ['기출', ['기출'], map.기출 ?? {}],
    ['합숙', ['합숙'], map.합숙 ?? {}],
    ['모의', ['모의', 'KPC'], map.모의?.KPC ?? {}],
  ];
  for (const [sourceType, prefix, rounds] of groups) {
    for (const [round, sessions] of Object.entries(rounds)) {
      for (const [key, entry] of Object.entries(sessions as Record<string, any>)) {
        if (!entry?.id) continue;
        const keyPath = [...prefix, round, key].join('/');
        if (only && !keyPath.startsWith(only)) continue;
        const spec = specFromMappingEntry(sourceType, round, key, entry);
        if (!spec) continue;
        const matched = problems
          .filter(spec.problemFilter)
          .filter((p: any) => typeof p.questionNumber === 'number')
          .sort((a: any, b: any) => a.questionNumber - b.questionNumber);
        if (matched.length === 0) continue;
        const splitCount = Object.keys(entry.questions ?? {}).length;
        if (splitCount >= matched.length) continue; // 이미 전부 분할 — 조사 대상 아님
        out.push({
          key: keyPath, fileId: entry.id, fileName: entry.name ?? '',
          titles: matched.map((p: any) => p.title), numbers: matched.map((p: any) => p.questionNumber), splitCount,
        });
      }
    }
  }
  return out;
}

/** 재현 가능한 표본 추출 (키 해시 순) */
function sample<T extends { key: string }>(rows: T[], n: number): T[] {
  if (n <= 0 || rows.length <= n) return rows;
  const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return [...rows].sort((a, b) => hash(a.key) - hash(b.key)).slice(0, n);
}

async function main() {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mappings/explanation-files.json'), 'utf8'));
  const problems = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/problems.json'), 'utf8'));
  const only = (process.env.AUDIT_ONLY ?? '').trim();
  const target = (process.env.AUDIT_TARGET ?? 'combined').trim();
  const concurrency = Math.max(1, parseInt(process.env.CONCURRENCY ?? '6', 10));
  const sampleN = parseInt(process.env.SAMPLE ?? '0', 10);
  const drive = makeReadDrive();

  if (target === 'splits') {
    const targets: { key: string; num: string; fileId: string; name: string }[] = [];
    for (const [st, prefix, rounds] of [['기출', ['기출'], map.기출 ?? {}], ['합숙', ['합숙'], map.합숙 ?? {}], ['모의', ['모의', 'KPC'], map.모의?.KPC ?? {}]] as any[]) {
      for (const [round, sessions] of Object.entries(rounds as Record<string, any>)) {
        for (const [key, entry] of Object.entries(sessions as Record<string, any>)) {
          const keyPath = [...prefix, round, key].join('/');
          if (only && !keyPath.startsWith(only)) continue;
          for (const [num, q] of Object.entries((entry as any).questions ?? {})) {
            targets.push({ key: keyPath, num, fileId: (q as any).id, name: (q as any).name });
          }
        }
      }
    }
    const picked = sample(targets.map((t) => ({ ...t, key: `${t.key}#${t.num}` })), sampleN);
    console.log(`분할본 ${picked.length}개 텍스트 길이 측정 (concurrency=${concurrency})`);
    const rows: any[] = [];
    const queue = [...picked];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (;;) {
        const t = queue.shift();
        if (!t) return;
        try {
          const pages = await extractPageTexts(await downloadPdf(drive, t.fileId));
          const chars = pages.map((p) => p.replace(/\s/g, '').length);
          const blanks = chars.filter((c) => c < BLANK_CHARS).length;
          rows.push({ key: t.key, name: t.name, pages: pages.length, blanks, totalChars: chars.reduce((a, b) => a + b, 0) });
        } catch (err) { rows.push({ key: t.key, name: t.name, error: (err as Error).message }); }
      }
    }));
    const imageOnly = rows.filter((r) => !r.error && r.blanks === r.pages);
    const mostlyBlank = rows.filter((r) => !r.error && r.blanks > 0 && r.blanks < r.pages);
    console.log(`\n━━━━━ 분할본 텍스트 레이어 ━━━━━`);
    console.log(`전부 이미지(글자 없음): ${imageOnly.length}개`);
    console.log(`일부 페이지만 이미지: ${mostlyBlank.length}개`);
    console.log(`정상: ${rows.length - imageOnly.length - mostlyBlank.length - rows.filter((r) => r.error).length}개 / 오류 ${rows.filter((r) => r.error).length}개`);
    for (const r of imageOnly.slice(0, 20)) console.log(`  [이미지] ${r.key} ${r.name}`);
    fs.mkdirSync(path.join(ROOT, 'tmp-split'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'tmp-split/text-layer-audit.json'), `${JSON.stringify({ target, rows }, null, 2)}\n`);
    return;
  }

  const noResplitSet = new Set<string>(NO_RESPLIT_KEYS);
  const all = collect(map, problems, only);
  const picked = sample(all, sampleN);
  console.log(`미분할·부분분할 통합본 ${all.length}개 중 ${picked.length}개 조사 (concurrency=${concurrency})`);

  const rows: any[] = [];
  let done = 0;
  const queue = [...picked];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      try {
        const pages = await extractPageTexts(await downloadPdf(drive, t.fileId));
        const blanks = pages.filter((p) => p.replace(/\s/g, '').length < BLANK_CHARS).length;
        const det = detectRanges(pages, t.titles);
        const missing = t.numbers.filter((n) => !det.ranges.some((r) => r.questionNumber === n));
        // 추정이 아니라 실제 분할 가드를 돌려서 중단 사유를 받는다
        const guard = checkSplitGuards(det.ranges, pages, t.titles);
        const guardReason = guard.ok ? undefined : guard.reason;
        const noResplit = noResplitSet.has(t.key);
        const cause = classifyFallback({
          noResplit, pages: pages.length, blanks, undetected: missing.length, guardReason,
        });
        // 제목 정렬이 원인이면 몇 칸 어긋났는지까지 — 수동 복구 판단에 필요
        let offset: number | undefined;
        if (guardReason === 'alignment') {
          const byPage = [...det.ranges].sort((a, b) => a.startPage - b.startPage);
          offset = checkTitleAlignment(byPage.map((r) => pages[r.startPage - 1] ?? ''), t.titles).bestOffset;
        }
        rows.push({
          key: t.key, name: t.fileName, pages: pages.length, blanks,
          detected: det.ranges.length, problems: t.titles.length, splitCount: t.splitCount,
          undetected: missing.length, unsplit: t.titles.length - t.splitCount,
          signal: det.signal, filled: det.filledNums.size, noResplit, guardReason, offset,
          guardMessage: guard.ok ? undefined : guard.message, cause,
        });
      } catch (err) { rows.push({ key: t.key, name: t.fileName, error: (err as Error).message, cause: 'error' }); }
      if (++done % 25 === 0) console.log(`  …${done}/${picked.length}`);
    }
  }));

  const byCause: Record<string, number> = {};
  const problemsByCause: Record<string, number> = {};
  for (const r of rows) {
    byCause[r.cause] = (byCause[r.cause] ?? 0) + 1;
    // 이 원인을 고치면 분할될 수 있는 문항 수 = 아직 통합본으로만 연결된 문항 수
    problemsByCause[r.cause] = (problemsByCause[r.cause] ?? 0) + (r.unsplit ?? 0);
  }
  const order: FallbackCause[] = ['detect-gap', 'no-signal', 'sequence', 'alignment', 'ocr-candidate', 'image-heavy', 'no-resplit', 'ok'];
  console.log('\n━━━━━ 통합본 폴백 원인 (실제 가드 판정 기준) ━━━━━');
  console.log(`표본 ${rows.length}/${all.length}`);
  for (const c of order) {
    if (!byCause[c]) continue;
    console.log(`  ${c.padEnd(14)} 해설집 ${String(byCause[c]).padStart(4)}개 / 통합본 연결 ${String(problemsByCause[c] ?? 0).padStart(5)}문항  — ${CAUSE_NOTE[c]}`);
  }
  for (const c of Object.keys(byCause)) {
    if (!order.includes(c as FallbackCause)) console.log(`  ${c.padEnd(14)} ${byCause[c]}개 (분류 미정)`);
  }
  // 가드 중단 사유 분포 — 분류와 교차 확인용
  const byGuard: Record<string, number> = {};
  for (const r of rows) byGuard[r.guardReason ?? (r.error ? 'error' : 'pass')] = (byGuard[r.guardReason ?? (r.error ? 'error' : 'pass')] ?? 0) + 1;
  console.log('가드 중단 사유:', JSON.stringify(byGuard));
  const align = rows.filter((r) => r.cause === 'alignment');
  if (align.length) {
    console.log(`\n제목 정렬 어긋남 ${align.length}개 (자동 복구 금지 후보)`);
    for (const r of align.slice(0, 20)) console.log(`  ${r.key}: ${r.offset}칸 어긋남 / 검출 ${r.detected}/${r.problems}`);
  }
  const seq = rows.filter((r) => r.cause === 'sequence');
  if (seq.length) {
    console.log(`\n번호 시퀀스 비정상 ${seq.length}개`);
    for (const r of seq.slice(0, 20)) console.log(`  ${r.key}: ${r.guardMessage}`);
  }
  const gap = rows.filter((r) => r.cause === 'detect-gap' || r.cause === 'no-signal');
  if (gap.length) {
    const bySignal: Record<string, number> = {};
    for (const r of gap) bySignal[r.signal ?? 'none'] = (bySignal[r.signal ?? 'none'] ?? 0) + 1;
    console.log(`\n서식 미지원 ${gap.length}개 — 사용된 시그널 분포: ${JSON.stringify(bySignal)}`);
    for (const r of gap.slice(0, 20)) console.log(`  ${r.key}: 검출 ${r.detected}/${r.problems} (${r.signal}) ${r.name}`);
  }
  fs.mkdirSync(path.join(ROOT, 'tmp-split'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp-split/text-layer-audit.json'), `${JSON.stringify({ target, sampled: picked.length, total: all.length, byCause, problemsByCause, rows }, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = order.filter((c) => byCause[c]).map((c) => `| ${c} | ${byCause[c]} | ${problemsByCause[c] ?? 0} | ${CAUSE_NOTE[c]} |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 통합본 폴백 원인 감사\n\n표본 ${picked.length}/${all.length}\n\n| 원인 | 해설집 | 통합본 문항 | 설명 |\n|---|---:|---:|---|\n${lines.join('\n')}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('텍스트 레이어 감사 실패:', err); process.exit(1); });
}
