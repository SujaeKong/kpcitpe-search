/**
 * 분할 시그널 회귀 테스트용 픽스처 캡처 — CI 전용(서비스계정으로 Drive PDF 다운로드).
 *
 * 매핑 항목마다 실제 PDF 페이지 텍스트를 뽑아 골격 텍스트(redactPageText)로 가리고,
 * 원문과 골격의 검출 결과가 같을 때만 tmp-split/fixtures/*.json.gz로 저장한다.
 * 워크플로 split-fixtures.yml 산출물을 tests/fixtures/split-signals/에 커밋해 쓴다.
 *
 * 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON, SPLIT_FIXTURE_KEYS(선택, 쉼표로 구분한 매핑 경로)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import { redactPageText } from './lib/split-redact';
import {
  checkSplitGuards,
  detectQuestionRangesWithSignal,
  downloadPdf,
  extractPageTexts,
  makeReadDrive,
  specFromMappingEntry,
} from './split-pdfs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'tmp-split', 'fixtures');

/** 시그널별 성공·실패 사례 (2026-09 분할 결과 기준) */
const FIXTURE_KEYS = [
  '기출/138/1_정보관리', // munje
  '합숙/2026.08/1일차_2교시', // munje — 마커가 페이지 상단 400자 뒤로 밀리는 논술형
  '모의/KPC/2026.07/1', // munje — 교시 통합 번호 16문항
  '모의/KPC/2023.12/4', // munje — 회차 보정 후 분할
  '기출/87/1_컴시응', // bracketmunje — 제목 정렬 가드로 어긋남 발견(2026-09-15), 재분할 금지
  '기출/87/1_정보관리', // bracketmunje — 재분할 금지(한 칸 어긋남)
  '기출/110/1_컴시응', // kpc-bunho
  '기출/89/1_정보관리', // kpc-rights-num 추정
  '모의/KPC/2012.12/2_컴시응', // kpc-domain 성공
  '모의/KPC/2012.12/1_정보관리', // kpc-domain 번호 시퀀스 비정상
  '모의/KPC/2010.10/1', // 22회 — 재분할 금지
  '모의/KPC/2016.11/2_컴시응', // kpc-mungje 성공
  '모의/KPC/2018.10/4_컴시응', // kpc-mungje 번호 시퀀스 비정상
  '모의/KPC/2018.10/3_정보관리', // kpc-mungje 검출 수 불일치
  '합숙/2015.07/1일차_1교시', // 107회 합숙
  '모의/KPC/2014.06/3_정보관리', // 검출 실패
];

const SLUG: Record<string, string> = { 기출: 'kichul', 합숙: 'hapsuk', 모의: 'moui', 정보관리: 'mgmt', 컴시응: 'app', 일차: 'd', 교시: 'p' };
const slugOf = (keyPath: string) =>
  keyPath.replace(/기출|합숙|모의|정보관리|컴시응|일차|교시/g, (w) => SLUG[w]).replace(/\//g, '__');

async function main() {
  const keys = process.env.SPLIT_FIXTURE_KEYS?.trim() ? process.env.SPLIT_FIXTURE_KEYS.split(',').map((k) => k.trim()) : FIXTURE_KEYS;
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mappings/explanation-files.json'), 'utf8'));
  const problems = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/problems.json'), 'utf8'));
  const drive = makeReadDrive();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let failed = 0;
  for (const keyPath of keys) {
    const parts = keyPath.split('/');
    const sourceType = parts[0] as '기출' | '합숙' | '모의';
    const entry = parts.reduce((node: any, k) => node?.[k], map);
    const spec = entry && specFromMappingEntry(sourceType, parts.at(-2)!, parts.at(-1)!, entry);
    if (!spec) {
      console.log(`⚠ 매핑 없음/키 형식 아님: ${keyPath}`);
      failed++;
      continue;
    }
    const titles = problems
      .filter(spec.problemFilter)
      .filter((p: any) => typeof p.questionNumber === 'number')
      .sort((a: any, b: any) => a.questionNumber - b.questionNumber)
      .map((p: any) => p.title as string);

    const pages = await extractPageTexts(await downloadPdf(drive, entry.id));
    const skeleton = pages.map(redactPageText);
    const original = detectQuestionRangesWithSignal(pages);
    const redacted = detectQuestionRangesWithSignal(skeleton);
    if (JSON.stringify(original) !== JSON.stringify(redacted)) {
      console.log(`✖ 골격 텍스트에서 검출 결과가 달라짐: ${keyPath}\n  원문 ${JSON.stringify(original)}\n  골격 ${JSON.stringify(redacted)}`);
      failed++;
      continue;
    }
    const lengthsKept = pages.every((p, i) => p.length === skeleton[i].length);
    const guard = checkSplitGuards(original.ranges, pages, titles);
    const guardNoAlignment = checkSplitGuards(original.ranges, skeleton, titles, { alignment: false });
    const fixture = {
      key: keyPath,
      fileName: entry.name,
      capturedAt: new Date().toISOString(),
      problemCount: titles.length,
      expected: {
        signal: original.signal,
        ranges: original.ranges,
        guard: guard.ok ? 'ok' : guard.reason,
        guardWithoutAlignment: guardNoAlignment.ok ? 'ok' : guardNoAlignment.reason,
      },
      pages: skeleton,
    };
    fs.writeFileSync(path.join(OUT_DIR, `${slugOf(keyPath)}.json.gz`), zlib.gzipSync(JSON.stringify(fixture)));
    console.log(
      `✔ ${keyPath}: ${original.signal} 검출 ${original.ranges.length} / 문항 ${titles.length} / 가드 ${fixture.expected.guard} / 페이지 ${pages.length} / 길이 보존 ${lengthsKept}`,
    );
  }
  if (failed > 0) {
    console.log(`\n실패 ${failed}건`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('픽스처 캡처 실패:', err);
    process.exit(1);
  });
}
