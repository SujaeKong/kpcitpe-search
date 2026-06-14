/**
 * 일회성 마이그레이션 — 기존에 'anyone'(링크 있는 누구나) 공개로 업로드된
 * 해설지 PDF들의 공개 권한을 제거해 비공개로 전환.
 *
 * 이후 사이트는 /api/explanation 프록시(로그인 + 수신동의 검증)를 통해서만
 * 해설지를 열람할 수 있다. split-pdfs.ts도 더 이상 공개 권한을 부여하지 않는다.
 *
 * 대상 파일 ID: data/mappings/explanation-files.json 의 모든 `id`
 *   (통합 PDF + 문항별 split PDF 모두 포함)
 *
 * 인증: split-pdfs.ts의 쓰기 경로와 동일한 OAuth Delegation (파일 소유자).
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN
 *
 * 실행:
 *   DRY_RUN=1 npx tsx scripts/unshare-explanations.ts   # 미리보기(권한 변경 없음)
 *   npx tsx scripts/unshare-explanations.ts              # 실제 제거
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

const __filename = url.fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const MAPPING_PATH = path.join(ROOT, 'data/mappings/explanation-files.json');
const DRY_RUN = process.env.DRY_RUN === '1';

function makeWriteDrive() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN 필요');
  }
  const oauth = new OAuth2Client(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: oauth });
}

/** 매핑 트리를 재귀 순회하며 모든 string `id`를 수집 */
function collectIds(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.id === 'string') out.add(obj.id);
  for (const v of Object.values(obj)) collectIds(v, out);
}

async function removeAnyonePermission(drive: any, fileId: string): Promise<'removed' | 'none' | 'error'> {
  try {
    const perms = await drive.permissions.list({
      fileId,
      fields: 'permissions(id,type)',
      supportsAllDrives: true,
    });
    const anyonePerms = (perms.data.permissions ?? []).filter((p: any) => p.type === 'anyone');
    if (anyonePerms.length === 0) return 'none';
    if (DRY_RUN) return 'removed'; // 미리보기에선 실제 삭제 안 함
    for (const p of anyonePerms) {
      await drive.permissions.delete({ fileId, permissionId: p.id, supportsAllDrives: true });
    }
    return 'removed';
  } catch (e) {
    console.error(`   ✗ ${fileId}: ${(e as Error).message}`);
    return 'error';
  }
}

async function main() {
  if (!fs.existsSync(MAPPING_PATH)) throw new Error(`매핑 파일 없음: ${MAPPING_PATH}`);
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
  const ids = new Set<string>();
  collectIds(mapping, ids);
  const fileIds = [...ids];

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}대상 해설지 파일: ${fileIds.length}건`);
  const drive = makeWriteDrive();

  let removed = 0;
  let none = 0;
  let error = 0;
  for (let i = 0; i < fileIds.length; i++) {
    const fileId = fileIds[i];
    const r = await removeAnyonePermission(drive, fileId);
    if (r === 'removed') removed++;
    else if (r === 'none') none++;
    else error++;
    if ((i + 1) % 25 === 0 || i === fileIds.length - 1) {
      console.log(`  ...${i + 1}/${fileIds.length} (비공개화 ${removed}, 이미비공개 ${none}, 오류 ${error})`);
    }
  }

  console.log(
    `\n완료 — 총 ${fileIds.length}건: ${DRY_RUN ? '제거 예정' : '비공개화'} ${removed}, 이미 비공개 ${none}, 오류 ${error}`,
  );
  if (DRY_RUN) console.log('DRY_RUN 모드였습니다. 실제 적용하려면 DRY_RUN 없이 다시 실행하세요.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
