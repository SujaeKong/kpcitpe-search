/**
 * 텍스트 레이어 감사 — "PDF에 글자가 없어서" 분할이 안 되는 규모를 센다. CI 전용(서비스계정 읽기).
 *
 * 배경: 모의 2023.12 1교시는 13·15번 해설이 **텍스트 레이어 없는 이미지 페이지**로 들어가 있어
 * `문 제 N.` 마커도 제목 토큰도 추출되지 않는다(페이지 크기도 595×841 vs 595.2×841.92로 다름).
 * 텍스트 기반 검출로는 원리상 불가능하고 통합본 폴백이 맞다. OCR 도입 가치를 판단하려면
 * 그런 페이지가 전체에서 얼마나 되는지 알아야 한다.
 *
 * 모드 (AUDIT_TARGET):
 *   combined(기본) — 미분할·부분분할 통합본을 표본 추출해 빈 페이지 수·검출 결과·누락 번호 집계.
 *                    실패 원인을 '빈 페이지로 설명됨 / 검출 수 불일치 / 시그널 없음'으로 분류.
 *   splits        — 이미 올라간 분할본의 텍스트 길이 측정 (내용 감사의 weak 판정이 이미지 탓인지 확인).
 *
 * 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON, CONCURRENCY(기본 6), AUDIT_ONLY(키 접두어),
 *          AUDIT_TARGET(combined|splits), SAMPLE(표본 수, 0=전체)
 * 결과: tmp-split/text-layer-audit.json
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { detectRanges, downloadPdf, extractPageTexts, makeReadDrive, specFromMappingEntry } from './split-pdfs';

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
        const missing = t.numbers.filter((_, i) => !det.ranges.some((r) => r.questionNumber === t.numbers[i]));
        // 빈 페이지가 누락 문항 수를 설명하는가 (OCR로 살릴 수 있는 후보)
        const cause = det.ranges.length === 0 ? (blanks >= pages.length / 2 ? 'image-heavy' : 'no-signal')
          : blanks > 0 && missing.length > 0 ? 'blank-pages'
          : 'count-mismatch';
        rows.push({ key: t.key, name: t.fileName, pages: pages.length, blanks, detected: det.ranges.length, problems: t.titles.length, splitCount: t.splitCount, missing: missing.length, cause });
      } catch (err) { rows.push({ key: t.key, name: t.fileName, error: (err as Error).message, cause: 'error' }); }
      if (++done % 25 === 0) console.log(`  …${done}/${picked.length}`);
    }
  }));

  const byCause: Record<string, number> = {};
  const problemsByCause: Record<string, number> = {};
  for (const r of rows) {
    byCause[r.cause] = (byCause[r.cause] ?? 0) + 1;
    problemsByCause[r.cause] = (problemsByCause[r.cause] ?? 0) + (r.missing ?? 0);
  }
  console.log('\n━━━━━ 통합본 폴백 원인 분류 ━━━━━');
  console.log('entry 수:', JSON.stringify(byCause));
  console.log('미분할 문항 수:', JSON.stringify(problemsByCause));
  const blankRows = rows.filter((r) => r.blanks > 0);
  console.log(`\n빈(이미지) 페이지가 있는 통합본: ${blankRows.length}/${rows.length}개`);
  for (const r of blankRows.slice(0, 15)) console.log(`  ${r.key}: ${r.pages}p 중 빈 ${r.blanks}p / 검출 ${r.detected}/${r.problems} (${r.cause})`);
  fs.mkdirSync(path.join(ROOT, 'tmp-split'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp-split/text-layer-audit.json'), `${JSON.stringify({ target, sampled: picked.length, total: all.length, byCause, problemsByCause, rows }, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 텍스트 레이어 감사\n\n- 표본 ${picked.length}/${all.length}\n- 원인(entry): ${JSON.stringify(byCause)}\n- 원인(문항): ${JSON.stringify(problemsByCause)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('텍스트 레이어 감사 실패:', err); process.exit(1); });
}
