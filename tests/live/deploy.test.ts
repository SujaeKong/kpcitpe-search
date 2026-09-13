/**
 * 운영 배포 점검 — 실제 사이트에 요청을 보낸다 (읽기 전용, 로그인 없음).
 * 대상: LIVE_BASE_URL (기본 https://kpcitpe-search.pages.dev)
 * 신규 회차 업로드·배포 후, 또는 캐시/API 코드 수정 후 실행.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = (process.env.LIVE_BASE_URL ?? 'https://kpcitpe-search.pages.dev').replace(/\/$/, '');
const LOCAL_DATA = fileURLToPath(new URL('../../data/problems.json', import.meta.url));

interface LiveProblem {
  id: string;
  sourceType: string;
  round: string;
  roundOrder: number;
  title: string;
}

/** 브라우저가 매 로드마다 서버에 재검증하는 정책인지 (max-age=0 / no-cache / no-store) */
function mustRevalidate(cacheControl: string | null): boolean {
  if (!cacheControl) return false;
  if (/no-cache|no-store/.test(cacheControl)) return true;
  return /max-age=0(?!\d)/.test(cacheControl);
}

function countByRound(problems: LiveProblem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of problems) {
    const key = `${p.sourceType}|${p.round}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

let problems: LiveProblem[];
let problemsEtag: string | null;
let indexHtml: string;

beforeAll(async () => {
  const [dataRes, indexRes] = await Promise.all([fetch(`${BASE}/data/problems.json`), fetch(`${BASE}/`)]);
  problemsEtag = dataRes.headers.get('etag');
  problems = dataRes.ok ? await dataRes.json() : [];
  indexHtml = indexRes.ok ? await indexRes.text() : '';
});

describe(`캐시 정책 (${BASE})`, () => {
  it('L1: index.html은 매번 재검증된다 (새 JS 번들이 바로 적용되도록)', async () => {
    const res = await fetch(`${BASE}/`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(mustRevalidate(res.headers.get('cache-control'))).toBe(true);
  });

  it('L2: problems.json은 매번 재검증되고 ETag가 있다', async () => {
    const res = await fetch(`${BASE}/data/problems.json`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(mustRevalidate(res.headers.get('cache-control'))).toBe(true);
    expect(res.headers.get('etag')).toBeTruthy();
  });

  it('L3: problems.json 조건부 요청(If-None-Match)은 304로 응답한다', async () => {
    expect(problemsEtag).toBeTruthy();
    const res = await fetch(`${BASE}/data/problems.json`, { headers: { 'if-none-match': problemsEtag! } });
    expect(res.status).toBe(304);
  });

  it('L4: 배포된 JS가 모두 200이고, problems.json 로더는 no-cache를 쓰며 force-cache를 쓰지 않는다', async () => {
    const seen = new Map<string, string>();
    let queue = [...new Set(indexHtml.match(/\/_astro\/[\w.-]+\.js/g) ?? [])];
    expect(queue.length).toBeGreaterThan(0);

    while (queue.length) {
      const batch = queue;
      queue = [];
      await Promise.all(
        batch.map(async (asset) => {
          const res = await fetch(`${BASE}${asset}`);
          expect(res.status, asset).toBe(200);
          const code = await res.text();
          seen.set(asset, code);
          for (const m of code.matchAll(/["']\.\/([\w.-]+\.js)["']/g)) {
            const dep = `/_astro/${m[1]}`;
            if (!seen.has(dep) && !queue.includes(dep) && !batch.includes(dep)) queue.push(dep);
          }
        }),
      );
    }

    const loaders = [...seen].filter(([, code]) => code.includes('problems.json'));
    expect(loaders.length, 'problems.json을 불러오는 번들을 찾지 못함').toBeGreaterThan(0);
    for (const [asset, code] of loaders) {
      expect(code.includes('no-cache'), `${asset}에 no-cache 없음`).toBe(true);
    }
    const forceCache = [...seen].filter(([, code]) => code.includes('force-cache')).map(([a]) => a);
    expect(forceCache).toEqual([]);
  });
});

describe('운영 데이터', () => {
  it('L5: problems.json이 비어 있지 않고 id가 중복되지 않는다', () => {
    expect(problems.length).toBeGreaterThan(10_000);
    const ids = new Set(problems.map((p) => p.id));
    expect(problems.length - ids.size).toBe(0);
    expect(problems.filter((p) => !p.title || !p.round || !p.sourceType)).toEqual([]);
  });

  it.skipIf(!existsSync(LOCAL_DATA))(
    'L6: 로컬 빌드(data/problems.json)와 회차별 문항 수가 같다 — 배포 누락/지연 감지 (먼저 npm run build:data)',
    () => {
      const local = countByRound(JSON.parse(readFileSync(LOCAL_DATA, 'utf8')));
      const live = countByRound(problems);
      const diffs = [...new Set([...local.keys(), ...live.keys()])]
        .filter((key) => local.get(key) !== live.get(key))
        .map((key) => `${key}: 로컬 ${local.get(key) ?? 0} / 운영 ${live.get(key) ?? 0}`);
      expect(diffs).toEqual([]);
    },
  );

  it('L7: 유형별 최신 회차의 회차 페이지가 열리고 문항 수가 데이터와 같다', async () => {
    const latest = new Map<string, LiveProblem>();
    for (const p of problems) {
      const cur = latest.get(p.sourceType);
      if (!cur || p.roundOrder > cur.roundOrder) latest.set(p.sourceType, p);
    }
    const counts = countByRound(problems);

    for (const p of latest.values()) {
      const pageUrl = `${BASE}/rounds/${encodeURIComponent(p.sourceType)}/${encodeURIComponent(p.round)}/`;
      const res = await fetch(pageUrl);
      expect(res.status, pageUrl).toBe(200);
      const expected = counts.get(`${p.sourceType}|${p.round}`);
      expect(await res.text(), `${p.sourceType} ${p.round}`).toMatch(new RegExp(`총\\s*${expected}\\s*건`));
    }
  });
});

describe('사용자별 API (비로그인)', () => {
  it('L8: /api/me → user:null, 캐시 금지(no-store)', async () => {
    const res = await fetch(`${BASE}/api/me`);
    expect(await res.json()).toEqual({ user: null });
    expect(res.headers.get('cache-control') ?? '(없음)').toMatch(/no-store/);
  });

  it('L9: /api/explanation → 401 (해설지 게이트)', async () => {
    const res = await fetch(`${BASE}/api/explanation?fileId=1AbCdEfGhIjKlMnOpQrStUvWxYz012345`);
    expect(res.status).toBe(401);
  });

  it('L10: /api/admin/users, users.csv → 403', async () => {
    expect((await fetch(`${BASE}/api/admin/users`)).status).toBe(403);
    expect((await fetch(`${BASE}/api/admin/users.csv`)).status).toBe(403);
  });
});
