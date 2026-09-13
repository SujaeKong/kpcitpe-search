/**
 * /api/explanation 프록시의 게이트 통과 이후 경로: 스트리밍 성공, Drive 오류, 잘못된 fileId, SA 미설정.
 * (비로그인 401·미동의 403은 api-handlers.test.ts)
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { callApi } from '../helpers/api-context';
import { makeUser } from '../helpers/fake-d1';
import { makeServiceAccount, stubGoogleFetch, TOKEN_URI } from '../helpers/google-sa';

let saJson: string;
const consented = makeUser({ marketing_consent: 1 });

beforeAll(async () => {
  saJson = (await makeServiceAccount()).json;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Drive 토큰 캐시가 모듈 전역이라 테스트마다 새로 import
async function handler() {
  vi.resetModules();
  return (await import('../../src/pages/api/explanation')).GET;
}

describe('/api/explanation — 로그인·동의 사용자', () => {
  it('A9: Drive PDF를 inline·비저장(no-store)·nosniff 헤더로 스트리밍', async () => {
    const fetchMock = stubGoogleFetch();
    const { res } = await callApi(await handler(), '/api/explanation?fileId=1AbCdEfGhIjKlMnOp', {
      as: consented,
      env: { GOOGLE_SERVICE_ACCOUNT_JSON: saJson },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('%PDF');
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'content-type': 'application/pdf',
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/files/1AbCdEfGhIjKlMnOp?alt=media'))).toBe(true);
  });

  it('A10: Drive가 404 등 실패하면 502 + 일반화된 메시지 (Drive 오류 내용 노출 X)', async () => {
    stubGoogleFetch({ driveStatus: 404 });
    const { res } = await callApi(await handler(), '/api/explanation?fileId=1AbCdEfGhIjKlMnOp', {
      as: consented,
      env: { GOOGLE_SERVICE_ACCOUNT_JSON: saJson },
    });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('secret-detail');
  });

  it('A11: fileId가 없거나 형식이 틀리면 400, Drive는 호출하지 않음', async () => {
    const fetchMock = stubGoogleFetch();
    const GET = await handler();
    for (const query of ['', '?fileId=', '?fileId=../../etc', '?fileId=short']) {
      const { res } = await callApi(GET, `/api/explanation${query}`, { as: consented, env: { GOOGLE_SERVICE_ACCOUNT_JSON: saJson } });
      expect(res.status, query).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('A12: 서비스계정 설정이 없거나 토큰 교환이 실패하면 500 (설정 오류)', async () => {
    stubGoogleFetch();
    let { res } = await callApi(await handler(), '/api/explanation?fileId=1AbCdEfGhIjKlMnOp', { as: consented });
    expect(res.status).toBe(500);

    stubGoogleFetch({ tokenStatus: 403 });
    ({ res } = await callApi(await handler(), '/api/explanation?fileId=1AbCdEfGhIjKlMnOp', {
      as: consented,
      env: { GOOGLE_SERVICE_ACCOUNT_JSON: saJson },
    }));
    expect(res.status).toBe(500);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url) === TOKEN_URI)).toBe(true);
  });
});
