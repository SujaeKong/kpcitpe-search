/**
 * 실제 Chrome으로 "예전 방문자가 새로고침해도 신규 문항 카드가 안 보임" 시나리오 재현.
 * dist/(npm run build 결과)를 Cloudflare Pages와 같은 캐시 헤더로 서빙하고,
 * 방문 → problems.json 교체(배포) → 새로고침/재방문 순서로 카드 노출을 확인한다.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startDistServer, type DistServer } from '../helpers/dist-server';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
const TOKEN = 'E2E신규문항검증토큰';

let server: DistServer;
let baseProblems: Record<string, unknown>[];
let profileDir: string;
let context: BrowserContext | null = null;

// 설치된 Chrome 우선, 없으면 Playwright 번들 Chromium (npx playwright install chromium)
async function launch(): Promise<BrowserContext> {
  const options = { headless: true, viewport: { width: 1280, height: 900 } };
  try {
    return await chromium.launchPersistentContext(profileDir, { ...options, channel: 'chrome' });
  } catch {
    return await chromium.launchPersistentContext(profileDir, options);
  }
}

/** 검색 결과 헤더의 "전체 N건"을 읽는다 (데이터 로딩이 끝날 때까지 대기) */
async function readTotal(page: Page): Promise<number> {
  const header = page.locator('p:visible', { hasText: /전체\s*[\d,]+\s*건/ }).first();
  await header.waitFor({ timeout: 30_000 });
  const match = (await header.textContent())?.match(/전체\s*([\d,]+)\s*건/);
  return Number(match?.[1].replace(/,/g, ''));
}

function freshCard(page: Page) {
  return page.locator('article', { hasText: TOKEN });
}

function deployNewProblem() {
  const template = baseProblems[0];
  server.setProblems([
    ...baseProblems,
    { ...template, id: 'e2e-fresh-1', title: `${TOKEN} 신규 회차 문항`, content: 'E2E 신규 문항', explanationFileId: null },
  ]);
}

const searchUrl = () => `${server.url}/?q=${encodeURIComponent(TOKEN)}`;

describe('신규 데이터 배포 후 예전 방문자 화면', () => {
  beforeAll(async () => {
    if (!existsSync(path.join(DIST, 'index.html'))) {
      throw new Error('dist/가 없습니다. `npm run test:e2e`(빌드 포함) 또는 `npm run build` 후 실행하세요.');
    }
    baseProblems = JSON.parse(readFileSync(path.join(DIST, 'data/problems.json'), 'utf8'));
    server = await startDistServer(DIST);
  });

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(async () => {
    server.setProblems(baseProblems);
    server.problemsStatuses.length = 0;
    profileDir = mkdtempSync(path.join(tmpdir(), 'kpcitpe-e2e-'));
    context = await launch();
  });

  afterEach(async () => {
    await context?.close();
    context = null;
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('E1: 같은 탭에서 새로고침만 해도 신규 문항 카드와 전체 건수가 반영된다', async () => {
    const page = await context!.newPage();
    await page.goto(searchUrl());
    const before = await readTotal(page);
    expect(await freshCard(page).count()).toBe(0);

    deployNewProblem();
    await page.reload();

    await expect.poll(() => readTotal(page), { timeout: 30_000 }).toBe(before + 1);
    await freshCard(page).first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  it('E2: 브라우저를 닫았다가 다시 열어도(디스크 캐시 보유) 신규 문항이 보인다', async () => {
    const first = await context!.newPage();
    await first.goto(searchUrl());
    const before = await readTotal(first);
    await context!.close();

    deployNewProblem();
    context = await launch();
    const page = await context.newPage();
    await page.goto(searchUrl());

    await expect.poll(() => readTotal(page), { timeout: 30_000 }).toBe(before + 1);
    await freshCard(page).first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  it('E3: 데이터가 그대로면 재방문 시 304로 캐시를 재사용한다 (10MB 재다운로드 없음)', async () => {
    const page = await context!.newPage();
    await page.goto(server.url);
    await readTotal(page);
    await page.goto(`${server.url}/?q=${encodeURIComponent('블록체인')}`);
    await readTotal(page);

    expect(server.problemsStatuses).toEqual([200, 304]);
  });
});
