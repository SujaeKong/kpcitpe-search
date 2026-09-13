/**
 * 해설지 프록시의 Drive 접근: 서비스계정 JWT(RS256) → 토큰 교환 → files.get, 토큰 캐시.
 * 실제 RSA 키로 서명 검증까지 확인한다.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { base64UrlDecode, makeServiceAccount, stubGoogleFetch, TOKEN_URI } from '../helpers/google-sa';

let sa: Awaited<ReturnType<typeof makeServiceAccount>>;

beforeAll(async () => {
  sa = await makeServiceAccount();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 토큰 캐시가 모듈 전역이라 테스트마다 새로 import
async function freshDrive() {
  vi.resetModules();
  return import('../../src/lib/google-drive');
}

const tokenCalls = (fetchMock: ReturnType<typeof stubGoogleFetch>) => fetchMock.mock.calls.filter(([url]) => String(url) === TOKEN_URI);
const driveCalls = (fetchMock: ReturnType<typeof stubGoogleFetch>) => fetchMock.mock.calls.filter(([url]) => String(url) !== TOKEN_URI);

describe('서비스계정 Drive 접근', () => {
  it('G1: RS256으로 서명한 JWT(iss·drive.readonly·aud·1시간)로 토큰을 받아 Bearer로 files.get(alt=media) 호출', async () => {
    const fetchMock = stubGoogleFetch();
    const { fetchDriveFile } = await freshDrive();
    const res = await fetchDriveFile('1AbCdEfGhIjKlMnOp', { GOOGLE_SERVICE_ACCOUNT_JSON: sa.json });
    expect(await res.text()).toContain('%PDF');

    const [, tokenInit] = tokenCalls(fetchMock)[0];
    const form = new URLSearchParams(String(tokenInit!.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, p, s] = form.get('assertion')!.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims).toMatchObject({
      iss: 'kpc-bot@test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: TOKEN_URI,
    });
    expect(claims.exp - claims.iat).toBe(3600);
    const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', sa.publicKey, base64UrlDecode(s), new TextEncoder().encode(`${h}.${p}`));
    expect(verified).toBe(true);

    const [driveUrl, driveInit] = driveCalls(fetchMock)[0];
    expect(String(driveUrl)).toBe('https://www.googleapis.com/drive/v3/files/1AbCdEfGhIjKlMnOp?alt=media&supportsAllDrives=true');
    expect((driveInit!.headers as Record<string, string>).authorization).toBe('Bearer access-1');
  });

  it('G2: 같은 isolate 안에서는 토큰을 재사용한다 (요청마다 토큰 교환 X)', async () => {
    const fetchMock = stubGoogleFetch();
    const { fetchDriveFile } = await freshDrive();
    const env = { GOOGLE_SERVICE_ACCOUNT_JSON: sa.json };
    await fetchDriveFile('1AbCdEfGhIjKlMnOp', env);
    await fetchDriveFile('1ZyXwVuTsRqPoNmLk', env);
    expect(tokenCalls(fetchMock)).toHaveLength(1);
    expect(driveCalls(fetchMock).map(([, init]) => (init!.headers as Record<string, string>).authorization)).toEqual(['Bearer access-1', 'Bearer access-1']);
  });

  it('G3: 만료 1분 이내 토큰은 다시 교환한다', async () => {
    const fetchMock = stubGoogleFetch({ expiresIn: 30 });
    const { fetchDriveFile } = await freshDrive();
    const env = { GOOGLE_SERVICE_ACCOUNT_JSON: sa.json };
    await fetchDriveFile('1AbCdEfGhIjKlMnOp', env);
    await fetchDriveFile('1AbCdEfGhIjKlMnOp', env);
    expect(tokenCalls(fetchMock)).toHaveLength(2);
  });

  it('G4: SA 설정 누락·필드 누락·토큰 교환 실패는 명확한 에러', async () => {
    const { fetchDriveFile } = await freshDrive();
    stubGoogleFetch();
    await expect(fetchDriveFile('1AbCdEfGhIjKlMnOp', {})).rejects.toThrow('미설정');
    await expect(fetchDriveFile('1AbCdEfGhIjKlMnOp', { GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"x"}' })).rejects.toThrow('필드 누락');
    stubGoogleFetch({ tokenStatus: 401 });
    await expect(fetchDriveFile('1AbCdEfGhIjKlMnOp', { GOOGLE_SERVICE_ACCOUNT_JSON: sa.json })).rejects.toThrow('토큰 교환 실패: 401');
  });

  it('G5: fileId는 URL 경로에 인코딩해 넣는다', async () => {
    const fetchMock = stubGoogleFetch();
    const { fetchDriveFile } = await freshDrive();
    await fetchDriveFile('a/b?c=d', { GOOGLE_SERVICE_ACCOUNT_JSON: sa.json });
    expect(String(driveCalls(fetchMock)[0][0])).toContain('/files/a%2Fb%3Fc%3Dd?alt=media');
  });
});
