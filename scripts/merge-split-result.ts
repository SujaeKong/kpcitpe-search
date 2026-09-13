/**
 * split-pdfs 결과(tmp-split/split-result.json)를 data/mappings/explanation-files.json에 머지.
 * split-pdfs 워크플로가 push 충돌 시 최신 main 위에 재적용하거나, 워크플로 산출물(split-result)로 수동 복구할 때 사용.
 *
 * 사용: npm run split:merge [-- <결과 파일 경로>]
 */
import path from 'node:path';
import url from 'node:url';
import { mergeSplitResultFile } from './split-pdfs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const resultPath = path.resolve(process.argv[2] ?? path.join(ROOT, 'tmp-split', 'split-result.json'));
const updated = mergeSplitResultFile(resultPath, path.join(ROOT, 'data', 'mappings', 'explanation-files.json'));
console.log(`✔ explanation-files.json에 ${updated}개 항목 분할 정보 머지 (${resultPath})`);
