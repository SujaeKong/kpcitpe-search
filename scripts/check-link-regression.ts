/**
 * 배포 전 해설지 연결 회귀 검사 — 새로 빌드한 data/problems.json을 운영(또는 지정한 기준)과 비교한다.
 * sync·매핑·빌드 버그로 해설지 연결이 대량으로 끊기거나 회차가 사라지면 exit 1 (CI에서 배포 중단).
 *
 * 사용: npm run check:links [-- <기준 problems.json 경로 또는 URL>]  (기본: 운영 사이트)
 * 환경변수: ALLOW_LINK_DROP=1 (의도한 감소 허용), LIVE_BASE_URL, GITHUB_STEP_SUMMARY(있으면 요약 기록)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { compareExplanationLinks, formatLinkReport, type LinkProblem } from './lib/link-regression';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function loadBaseline(source: string): Promise<LinkProblem[] | null> {
  try {
    if (/^https?:\/\//.test(source)) {
      const res = await fetch(source, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as LinkProblem[];
    }
    return JSON.parse(fs.readFileSync(source, 'utf8')) as LinkProblem[];
  } catch (err) {
    console.log(`::warning::기준 데이터를 읽지 못해 검사를 건너뜀 (${source}): ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  const base = (process.env.LIVE_BASE_URL ?? 'https://kpcitpe-search.pages.dev').replace(/\/$/, '');
  const source = process.argv[2] ?? `${base}/data/problems.json`;
  const allowDrop = process.env.ALLOW_LINK_DROP === '1';

  const baseline = await loadBaseline(source);
  if (!baseline) return;
  const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'problems.json'), 'utf8')) as LinkProblem[];

  const report = compareExplanationLinks(baseline, built);
  const markdown = formatLinkReport(report, { allowDrop });
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);

  if (report.violations.length > 0) {
    if (allowDrop) {
      console.log('::warning::해설지 연결 급감이 [allow-link-drop]으로 허용됨');
    } else {
      console.log('::error::해설지 연결 급감 감지 — 배포 중단');
      process.exit(1);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('연결 회귀 검사 실패:', err);
    process.exit(1);
  });
}
