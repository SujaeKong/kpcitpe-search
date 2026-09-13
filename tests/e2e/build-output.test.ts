/**
 * 빌드 결과물(dist/) 점검 — 회차 페이지 생성 누락, 캐시 헤더·라우팅 설정, 데이터 사본.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Problem } from '../../src/lib/types';
import { DIST_DIR, requireDist } from '../helpers/browser';

let problems: Problem[];
let groups: Map<string, { sourceType: string; round: string; count: number }>;

beforeAll(() => {
  requireDist();
  problems = JSON.parse(readFileSync(path.join(DIST_DIR, 'data/problems.json'), 'utf8'));
  groups = new Map();
  for (const p of problems) {
    const key = `${p.sourceType}|${p.round}`;
    const g = groups.get(key) ?? { sourceType: p.sourceType, round: p.round, count: 0 };
    g.count++;
    groups.set(key, g);
  }
});

describe('dist/ 빌드 결과물', () => {
  it('O1: 모든 (출처, 회차)마다 회차 페이지가 생성되고 "총 N건"이 데이터와 같다', () => {
    const problemsFound: string[] = [];
    for (const { sourceType, round, count } of groups.values()) {
      const page = path.join(DIST_DIR, 'rounds', sourceType, round, 'index.html');
      if (!existsSync(page)) {
        problemsFound.push(`${sourceType} ${round}: 페이지 없음`);
        continue;
      }
      if (!new RegExp(`총\\s*${count}\\s*건`).test(readFileSync(page, 'utf8'))) problemsFound.push(`${sourceType} ${round}: 총 ${count}건 아님`);
    }
    expect(problemsFound).toEqual([]);
  });

  it('O2: 회차 목록(/rounds/)이 모든 회차로 링크한다', () => {
    const html = readFileSync(path.join(DIST_DIR, 'rounds/index.html'), 'utf8');
    const missing = [...groups.values()]
      .map(({ sourceType, round }) => `/rounds/${encodeURIComponent(sourceType)}/${encodeURIComponent(round)}`)
      .filter((href) => !html.includes(`href="${href}"`));
    expect(missing).toEqual([]);
  });

  it('O3: _headers는 /_astro/*만 장기 캐시, _routes.json은 정적 자산을 워커에서 제외', () => {
    const headers = readFileSync(path.join(DIST_DIR, '_headers'), 'utf8');
    expect(headers).toMatch(/^\/_astro\/\*\s*\n\s+Cache-Control:.*immutable/m);
    expect(headers).not.toMatch(/^\/(data|rounds)?\/?\*?\s*$/m); // HTML·데이터에 규칙을 걸면 같은 캐시 장애 재발
    const routes = JSON.parse(readFileSync(path.join(DIST_DIR, '_routes.json'), 'utf8'));
    expect(routes.exclude).toEqual(expect.arrayContaining(['/_astro/*', '/data/*', '/rounds/*']));
  });

  it('O5: 404 페이지(dist/404.html)가 생성된다 — 없으면 Cloudflare Pages가 없는 주소에 index.html을 200으로 줌', () => {
    const html = readFileSync(path.join(DIST_DIR, '404.html'), 'utf8');
    expect(html).toContain('페이지를 찾을 수 없습니다');
  });

  it('O4: 배포되는 dist/data/problems.json이 방금 빌드한 data/problems.json과 같다', () => {
    const built = fileURLToPath(new URL('../../data/problems.json', import.meta.url));
    expect(readFileSync(path.join(DIST_DIR, 'data/problems.json')).equals(readFileSync(built))).toBe(true);
  });
});
