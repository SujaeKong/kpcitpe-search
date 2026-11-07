/**
 * 실험 — "검출 수는 맞는데 번호 시퀀스가 비정상"인 해설집(sequence 가드 중단, 전수 감사 169개/1,119문항)을
 * 번호를 **위치순 1..N으로 재배정**하면 제목 정렬이 통과하는지 확인한다. CI 전용(서비스계정 읽기).
 *
 * 배경: 그 169개는 전부 시그널 kpc-mungje다. 검출된 번호가 [1,5,9,12,16,19](6문항)처럼 쪽번호를 닮았다 —
 * 즉 **구간(시작 페이지)은 맞게 찾았고 번호만 엉뚱하게 읽었다**는 가설. 구간이 맞다면 번호를 버리고
 * 순서대로 매기면 되고, 그 판정은 제목 정렬(checkTitleAlignment offset 0)이 해 준다.
 *
 * 쓰기 없음. 결과: tmp-split/renumber-experiment.json
 * 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON, CONCURRENCY, AUDIT_ONLY, SAMPLE, DUMP(머리말 덤프 개수)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import {
  checkSplitGuards, checkTitleAlignment, detectRanges, downloadPdf, extractPageTexts, makeReadDrive,
} from './split-pdfs';
import { collect, sample } from './audit-text-layer';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function main() {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mappings/explanation-files.json'), 'utf8'));
  const problems = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/problems.json'), 'utf8'));
  const only = (process.env.AUDIT_ONLY ?? '').trim();
  const concurrency = Math.max(1, parseInt(process.env.CONCURRENCY ?? '8', 10));
  const dumpN = parseInt(process.env.DUMP ?? '3', 10);
  const drive = makeReadDrive();
  const all = sample(collect(map, problems, only), parseInt(process.env.SAMPLE ?? '0', 10));
  console.log(`대상 통합본 ${all.length}개 — sequence 중단 건만 재배정 실험`);

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
        const guard = checkSplitGuards(det.ranges, pages, t.titles);
        if (guard.ok || guard.reason !== 'sequence') { done++; continue; }

        // 위치순으로 번호 재배정 — 구간은 그대로, questionNumber만 1..N
        const byPage = [...det.ranges].sort((a, b) => a.startPage - b.startPage);
        const renumbered = byPage.map((r, i) => ({ ...r, questionNumber: t.numbers[i] }));
        const guard2 = checkSplitGuards(renumbered, pages, t.titles);
        const align = checkTitleAlignment(byPage.map((r) => pages[r.startPage - 1] ?? ''), t.titles);
        rows.push({
          key: t.key, name: t.fileName, pages: pages.length, problems: t.titles.length,
          signal: det.signal, detectedNums: byPage.map((r) => r.questionNumber),
          startPages: byPage.map((r) => r.startPage),
          after: guard2.ok ? 'ok' : guard2.reason, afterMessage: guard2.ok ? undefined : (guard2 as any).message,
          bestOffset: align.bestOffset, scores: align.scores,
        });
        if (dumps.length < dumpN) {
          dumps.push({
            key: t.key,
            heads: byPage.map((r) => ({ page: r.startPage, head: (pages[r.startPage - 1] ?? '').replace(/\s+/g, ' ').slice(0, 220) })),
          });
        }
      } catch (err) { rows.push({ key: t.key, error: (err as Error).message }); }
      if (++done % 50 === 0) console.log(`  …${done}/${all.length}`);
    }
  }));

  const okAfter = rows.filter((r) => r.after === 'ok');
  const stillBad = rows.filter((r) => r.after && r.after !== 'ok');
  console.log('\n━━━━━ 번호 위치순 재배정 결과 ━━━━━');
  console.log(`sequence 중단 ${rows.length}개 중`);
  console.log(`  재배정 후 가드 통과: ${okAfter.length}개 / ${okAfter.reduce((a, r) => a + r.problems, 0)}문항`);
  console.log(`  여전히 실패: ${stillBad.length}개`);
  const byReason: Record<string, number> = {};
  for (const r of stillBad) byReason[r.after] = (byReason[r.after] ?? 0) + 1;
  console.log(`  실패 사유: ${JSON.stringify(byReason)}`);
  console.log('\n실패 상세 (최대 20):');
  for (const r of stillBad.slice(0, 20)) console.log(`  ${r.key}: ${r.after} offset=${r.bestOffset} scores=${JSON.stringify(r.scores)} nums=[${r.detectedNums}]`);
  console.log('\n통과 샘플 (최대 15):');
  for (const r of okAfter.slice(0, 15)) console.log(`  ${r.key}: nums=[${r.detectedNums}] → 1..${r.problems}, 시작페이지=[${r.startPages}]`);
  for (const d of dumps) {
    console.log(`\n─── 머리말 덤프 ${d.key}`);
    for (const h of d.heads) console.log(`  p${h.page}: ${h.head}`);
  }
  fs.mkdirSync(path.join(ROOT, 'tmp-split'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp-split/renumber-experiment.json'), `${JSON.stringify({ rows, dumps }, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 번호 위치순 재배정 실험\n\n- sequence 중단 ${rows.length}개\n- 재배정 후 통과 ${okAfter.length}개 (${okAfter.reduce((a, r) => a + r.problems, 0)}문항)\n- 여전히 실패 ${stillBad.length}개 ${JSON.stringify(byReason)}\n`);
  }
}

main().catch((err) => { console.error('재배정 실험 실패:', err); process.exit(1); });
