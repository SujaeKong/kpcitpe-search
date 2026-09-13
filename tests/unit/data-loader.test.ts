/**
 * problems.json 로더 회귀 테스트.
 * 2026-09 장애: force-cache + 버전 고정 sessionStorage 때문에 예전 방문자가
 * 새로고침해도 신규 회차 카드를 못 봄. 같은 구조가 다시 들어오지 않게 막는다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
const sample = [{ id: 'kichul-140-mgmt-1-1' }, { id: 'hapsuk-kpc-2026.08-1' }];

// 로더는 모듈 레벨 inflight 캐시가 있어 테스트마다 새로 import
async function freshLoader() {
  vi.resetModules();
  return import('../../src/lib/data-loader');
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('data-loader', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => Response.json(sample));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('U1: 매 로드마다 서버 재검증(no-cache)으로 /data/problems.json을 요청한다', async () => {
    const { loadProblems } = await freshLoader();
    await expect(loadProblems()).resolves.toEqual(sample);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data/problems.json', { cache: 'no-cache' });
  });

  it('U2: sessionStorage에 옛 데이터가 있어도 쓰지 않고 서버 데이터를 반환한다', async () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ version: 3, problems: [{ id: 'stale' }] })),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('sessionStorage', storage);

    const { loadProblems } = await freshLoader();
    await expect(loadProblems()).resolves.toEqual(sample);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('U3: 같은 페이지에서 동시에 여러 번 호출해도 요청은 1회만 보낸다', async () => {
    const { loadProblems } = await freshLoader();
    const [a, b] = await Promise.all([loadProblems(), loadProblems()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('U4: 응답이 실패하면 상태코드를 담은 에러를 던진다', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('nope', { status: 503, statusText: 'Service Unavailable' }));
    const { loadProblems } = await freshLoader();
    await expect(loadProblems()).rejects.toThrow(/503/);
  });

  it('U5: src/ 어디에도 force-cache가 없다 (옛 데이터 고정 재발 방지)', () => {
    const offenders = walk(SRC_DIR).filter((f) => readFileSync(f, 'utf8').includes('force-cache'));
    expect(offenders).toEqual([]);
  });
});
