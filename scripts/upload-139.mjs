/**
 * 일회성 — 139회 정보관리 기출 통합 해설지 4개(1~4교시)를 Drive에 업로드.
 *
 * 올바른 위치: "01. 기출문제" 아래에 **"제139회 기출문제 해설집"** 폴더를 새로 만들고
 * 그 안에 업로드. sync-drive가 폴더명에서 회차(139)를, 파일명에서 종목·교시를 파싱한다.
 * (138 폴더에 올리면 회차가 138로 오인되므로 반드시 전용 폴더!)
 *
 * 인증: OAuth Delegation(쓰기). GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN
 *
 * 사용: node scripts/upload-139.mjs
 */
import fs from 'node:fs';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// "01. 기출문제" 폴더 (회차별 폴더들의 부모)
const KICHUL_ROOT_ID = '1_a9S6KE1hDw_WuPfp1rmiCNF8TC7tudm';
const FOLDER_NAME = '제139회 기출문제 해설집';

const DIR = '/Users/sujaekong/Downloads/139회_기출풀이_정보관리 기출풀이 해설지';
const FILES = [
  `${DIR}/139회_기출풀이_정보관리 1교시.pdf`,
  `${DIR}/139회_기출풀이_정보관리 2교시.pdf`,
  `${DIR}/139회_기출풀이_정보관리 3교시.pdf`,
  `${DIR}/139회_기출풀이_정보관리 4교시.pdf`,
];

function makeWriteDrive() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error('GOOGLE_OAUTH_* 필요');
  const o = new OAuth2Client(id, secret);
  o.setCredentials({ refresh_token: refresh });
  return google.drive({ version: 'v3', auth: o });
}

async function ensureFolder(drive, name, parentId) {
  const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const list = await drive.files.list({ q, fields: 'files(id,name)', supportsAllDrives: true });
  if (list.data.files && list.data.files.length) return list.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}

async function main() {
  for (const f of FILES) if (!fs.existsSync(f)) throw new Error(`파일 없음: ${f}`);
  const drive = makeWriteDrive();

  const folderId = await ensureFolder(drive, FOLDER_NAME, KICHUL_ROOT_ID);
  console.log(`대상 폴더: "${FOLDER_NAME}" (${folderId})\n`);

  const out = [];
  for (const path of FILES) {
    const name = path.split('/').pop();
    const q = `'${folderId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
    const existing = await drive.files.list({ q, fields: 'files(id,name)', supportsAllDrives: true });
    let id;
    if (existing.data.files && existing.data.files.length) {
      id = existing.data.files[0].id;
      console.log(`↻ 이미 존재: ${name} → ${id}`);
    } else {
      const res = await drive.files.create({
        requestBody: { name, parents: [folderId] },
        media: { mimeType: 'application/pdf', body: fs.createReadStream(path) },
        fields: 'id,name',
        supportsAllDrives: true,
      });
      id = res.data.id;
      console.log(`✔ 업로드: ${name} → ${id}`);
    }
    out.push({ fileId: id, fileName: name });
  }
  console.log(`\n폴더 ${folderId} 에 ${out.length}개 업로드 완료.`);
}

main().catch((e) => {
  console.error('❌', e.message || e);
  process.exit(1);
});
