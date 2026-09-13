/**
 * 화면 흐름 e2e — 해설지 버튼의 로그인/수신동의 게이트, URL 필터 복원·동기화, 회차 페이지.
 * /api/*는 dist-server 대역으로 로그인 상태를 바꿔 가며 실제 Chrome에서 확인한다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Problem } from '../../src/lib/types';
import { DESKTOP_VIEWPORT, DIST_DIR, launchBrowser, requireDist } from '../helpers/browser';
import { startDistServer, type DistServer } from '../helpers/dist-server';

const RESULT_LIMIT = 200; // SearchApp 표시 상한

let server: DistServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let problems: Problem[];
let latestHapsuk: { round: string; roundOrder: number; count: number; fileIds: Set<string> };

const enc = encodeURIComponent;
const latestHapsukUrl = () =>
  `${server.url}/?type=${enc('합숙')}&rmin=${latestHapsuk.roundOrder}&rmax=${latestHapsuk.roundOrder}`;

/** "전체 N건 (필터 적용 후 M건)"의 M */
async function filteredCount(p: Page): Promise<number> {
  const header = p.locator('p:visible', { hasText: /필터 적용 후/ }).first();
  await header.waitFor({ timeout: 30_000 });
  return Number((await header.textContent())?.match(/필터 적용 후\s*([\d,]+)\s*건/)?.[1].replace(/,/g, ''));
}

async function returnParamAfterLoginRedirect(p: Page): Promise<URL> {
  await p.waitForURL(/\/api\/auth\/naver\/login\?/, { timeout: 15_000 });
  return new URL(new URL(p.url()).searchParams.get('return')!, server.url);
}

beforeAll(async () => {
  requireDist();
  problems = JSON.parse(readFileSync(path.join(DIST_DIR, 'data/problems.json'), 'utf8'));
  const hapsuk = problems.filter((p) => p.sourceType === '합숙');
  const roundOrder = Math.max(...hapsuk.map((p) => p.roundOrder));
  const latest = hapsuk.filter((p) => p.roundOrder === roundOrder);
  latestHapsuk = {
    round: latest[0].round,
    roundOrder,
    count: latest.length,
    fileIds: new Set(latest.flatMap((p) => (p.explanationFileId ? [p.explanationFileId] : []))),
  };
  server = await startDistServer(DIST_DIR);
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

beforeEach(async () => {
  server.setUser(null);
  server.apiRequests.length = 0;
  context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
  page = await context.newPage();
});

afterEach(async () => {
  await context?.close();
});

describe('해설지 버튼 게이트', () => {
  it('E4: 비로그인 → "(로그인 필요)" 버튼 클릭 시 현재 검색 상태를 return으로 네이버 로그인 이동', async () => {
    expect(latestHapsuk.fileIds.size, '최신 합숙 회차에 해설지가 연결돼 있어야 함').toBeGreaterThan(0);
    await page.goto(latestHapsukUrl());
    await page.getByRole('button', { name: /해설지 보기.*로그인 필요/ }).first().click();

    const back = await returnParamAfterLoginRedirect(page);
    expect(back.origin).toBe(server.url);
    expect(back.searchParams.get('type')).toBe('합숙');
    expect(back.searchParams.get('rmin')).toBe(String(latestHapsuk.roundOrder));
  });

  it('E5: 로그인 + 미동의 → 동의 안내 → "동의하고 보기" → consent 저장 후 해설지 모달(서버 프록시 iframe)', async () => {
    server.setUser({ sub: 'naver:1001', name: '테스터', email: 'tester@example.com', marketingConsent: false });
    await page.goto(latestHapsukUrl());
    await page.getByRole('button', { name: /해설지 보기.*수신동의 필요/ }).first().click();

    const prompt = page.getByRole('dialog', { name: '수신동의 안내' });
    await prompt.getByRole('button', { name: '동의하고 보기' }).click();

    const modal = page.getByRole('dialog', { name: '해설지' });
    await modal.waitFor();
    const src = await modal.locator('iframe').getAttribute('src');
    expect(src).toMatch(/^\/api\/explanation\?fileId=/);
    expect(latestHapsuk.fileIds.has(new URL(src!, server.url).searchParams.get('fileId')!)).toBe(true);
    expect(server.apiRequests.filter((r) => r.path === '/api/consent')).toEqual([
      { method: 'POST', path: '/api/consent', body: JSON.stringify({ consent: true }) },
    ]);
    await prompt.waitFor({ state: 'detached' });
  });

  it('E6: 로그인 + 동의 → 바로 해설지 모달, ESC로 닫힘, consent 요청 없음', async () => {
    server.setUser({ sub: 'naver:1001', name: '테스터', email: 'tester@example.com', marketingConsent: true });
    await page.goto(latestHapsukUrl());
    const button = page.getByRole('button', { name: /해설지 보기/ }).first();
    await expect.poll(() => button.textContent()).not.toMatch(/필요/); // 인증 로딩 완료 대기
    await button.click();

    const modal = page.getByRole('dialog', { name: '해설지' });
    await modal.waitFor();
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
    expect(server.apiRequests.some((r) => r.path === '/api/consent')).toBe(false);
  });
});

describe('검색 필터', () => {
  it('E7: URL의 필터가 복원되고, 칩을 누르면 결과와 URL이 함께 바뀐다', async () => {
    await page.goto(`${server.url}/?type=${enc('합숙')}&session=${enc('1일차')}`);
    const day1 = problems.filter((p) => p.sourceType === '합숙' && p.session === '1일차');
    await expect.poll(() => filteredCount(page), { timeout: 30_000 }).toBe(Math.min(day1.length, RESULT_LIMIT));
    for (const text of (await page.locator('article').allTextContents()).slice(0, 30)) {
      expect(text).toContain('합숙');
      expect(text).toContain('1일차');
    }

    await page.getByRole('button', { name: '컴시응', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('cert')).toBe('컴시응');
    const day1App = day1.filter((p) => p.certScope === '컴시응');
    await expect.poll(() => filteredCount(page), { timeout: 15_000 }).toBe(Math.min(day1App.length, RESULT_LIMIT));
  });
});

describe('회차별 페이지', () => {
  it('E8: 회차 목록에서 최신 합숙 회차로 이동하면 해당 회차 문항이 모두 보인다', async () => {
    await page.goto(`${server.url}/rounds/`);
    await page.locator(`a[href="/rounds/${enc('합숙')}/${enc(latestHapsuk.round)}"]`).click();
    await page.waitForURL(new RegExp(`/rounds/${enc('합숙')}/`));
    await page.getByText(new RegExp(`총\\s*${latestHapsuk.count}\\s*건`)).first().waitFor();
    expect(await page.locator('article').count()).toBe(latestHapsuk.count);
  });

  it('E9: 회차 페이지의 카드도 해설지 게이트가 동작한다 (비로그인 → 로그인, return=회차 페이지)', async () => {
    await page.goto(`${server.url}/rounds/${enc('합숙')}/${enc(latestHapsuk.round)}/`);
    const button = page.getByRole('button', { name: /해설지 보기/ }).first();
    await button.scrollIntoViewIfNeeded(); // client:visible — 화면에 들어와야 하이드레이션
    await expect.poll(() => button.textContent(), { timeout: 15_000 }).toMatch(/로그인 필요/);
    await button.click();

    const back = await returnParamAfterLoginRedirect(page);
    expect(decodeURIComponent(back.pathname)).toBe(`/rounds/합숙/${latestHapsuk.round}/`);
  });
});
