/**
 * 이번 sync로 새로 생겼거나 파일이 교체된 매핑 키를 콤마로 이어 출력한다 (없으면 빈 출력).
 * sync-drive 워크플로가 split-pdfs에 `keys` 입력으로 넘겨 신규 회차만 분할하는 데 쓴다.
 *
 * 사용: tsx scripts/print-new-mapping-keys.ts <이전 매핑.json> [현재 매핑.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { newMappingKeys } from './lib/mapping-diff';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p: string) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {});

const prevPath = process.argv[2];
const nextPath = process.argv[3] ?? path.join(ROOT, 'data', 'mappings', 'explanation-files.json');
if (!prevPath) {
  console.error('사용: tsx scripts/print-new-mapping-keys.ts <이전 매핑.json> [현재 매핑.json]');
  process.exit(2);
}
process.stdout.write(newMappingKeys(read(prevPath), read(nextPath)).join(','));
