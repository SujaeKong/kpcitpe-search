/**
 * 이번 빌드에서 처음 문항이 생긴, 아직 분할 안 된 매핑 키를 콤마로 이어 stdout에 출력한다.
 * (해설지 PDF를 엑셀보다 먼저 올린 회차 구제 — scripts/lib/pending-splits.ts 참고)
 *
 * 배포 워크플로가 이 값을 split-pdfs의 keys 입력으로 넘긴다. 기준 데이터를 못 읽으면
 * 빈 값을 출력해 아무것도 트리거하지 않는다(경고만). 로그는 전부 stderr로 보낸다.
 *
 * 사용: tsx scripts/detect-pending-splits.ts [<기준 problems.json 경로 또는 URL>]
 * 환경변수: LIVE_BASE_URL (기본: 운영 사이트)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { pendingSplitKeys, type ProblemLike } from './lib/pending-splits';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function loadBaseline(source: string): Promise<ProblemLike[] | null> {
  try {
    if (/^https?:\/\//.test(source)) {
      const res = await fetch(source, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ProblemLike[];
    }
    return JSON.parse(fs.readFileSync(source, 'utf8')) as ProblemLike[];
  } catch (err) {
    console.error(`::warning::기준 데이터를 읽지 못해 분할 대상 탐지를 건너뜀 (${source}): ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  const base = (process.env.LIVE_BASE_URL ?? 'https://kpcitpe-search.pages.dev').replace(/\/$/, '');
  const baseline = await loadBaseline(process.argv[2] ?? `${base}/data/problems.json`);
  if (!baseline) return;

  const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'problems.json'), 'utf8')) as ProblemLike[];
  const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mappings', 'explanation-files.json'), 'utf8'));

  const keys = pendingSplitKeys(baseline, built, mapping);
  console.error(keys.length > 0 ? `분할 대기 키 ${keys.length}개: ${keys.join(', ')}` : '분할 대기 키 없음');
  process.stdout.write(keys.join(','));
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::warning::분할 대상 탐지 실패: ${err}`);
  });
}
