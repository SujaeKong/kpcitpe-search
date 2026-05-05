/**
 * 합숙 옛 회차 폴더명에 (YYYY-MM) 접미사 추가하는 1회성 스크립트.
 *
 * 사용자가 직접 Drive에서 12개 폴더를 일일이 이름 변경하는 부담을 줄이기 위함.
 * 매핑 표는 problems.json의 합숙 round와 회차 폴더를 1:1 매칭한 추정값.
 *
 * 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_HAPSUK_FOLDER_ID
 *
 * idempotent: 이미 (YYYY-MM)이 들어간 폴더는 skip.
 */
import fs from 'node:fs';
import { google } from 'googleapis';

const HAPSUK_FOLDER_ID =
  process.env.DRIVE_HAPSUK_FOLDER_ID ?? '1ZzSqSJpXvHaXuufIfV1WyhvXu8x1v2ey';

const RENAME_MAP: Record<string, string> = {
  '093회합숙': '093회합숙(2011-02)',
  '095회합숙': '095회합숙(2011-08)',
  '096회합숙': '096회합숙(2012-02)',
  '098회합숙': '098회합숙(2012-08)',
  '099회합숙': '099회합숙(2013-01)',
  '101회합숙': '101회합숙(2013-07)',
  '102회합숙': '102회합숙(2014-01)',
  '104회합숙': '104회합숙(2014-07)',
  '105회합숙': '105회합숙(2015-01)',
  '107회합숙': '107회합숙(2015-07)',
};

function loadCredentials(): unknown {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 필요');
  const t = raw.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  if (fs.existsSync(t)) return JSON.parse(fs.readFileSync(t, 'utf8'));
  throw new Error('JSON도 파일경로도 아님');
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials() as any,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: `'${HAPSUK_FOLDER_ID}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name)',
    pageSize: 500,
  });

  const folders = res.data.files ?? [];
  console.log(`합숙 폴더 ${folders.length}개 조회`);

  let renamed = 0;
  let skipped = 0;
  let untouched = 0;

  for (const f of folders) {
    if (!f.id || !f.name) continue;
    const current = f.name.normalize('NFC').trim();

    // 이미 (YYYY-MM) 들어가 있으면 skip
    if (/\(\d{4}-\d{1,2}\)/.test(current)) {
      skipped++;
      continue;
    }

    const target = RENAME_MAP[current];
    if (!target) {
      untouched++;
      continue;
    }

    try {
      await drive.files.update({ fileId: f.id, requestBody: { name: target } });
      console.log(`  ✓ ${current} → ${target}`);
      renamed++;
    } catch (err) {
      console.warn(`  ✗ ${current} 실패: ${(err as Error).message}`);
    }
  }

  console.log(`\n━━━━━ 결과 ━━━━━`);
  console.log(`  변경됨   : ${renamed}`);
  console.log(`  이미 OK  : ${skipped}`);
  console.log(`  매핑 없음: ${untouched}`);
}

main().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
