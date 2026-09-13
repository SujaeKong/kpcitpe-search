/**
 * 화면 흐름 e2e (2) — 검색창·검색 기록, 더 보기, 모바일(필터 drawer·해설지 새 탭), 로그인 메뉴, 404.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Problem } from '../../src/lib/types';
import { DESKTOP_VIEWPORT, DIST_DIR, launchBrowser, requireDist } from '../helpers/browser';
import { startDistServer, type DistServer, type StubUser } from '../helpers/dist-server';

const PAGE_SIZE = 30;
const RESULT_LIMIT = 200;

let server: DistServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let latestHapsukUrl: string;

const consentedUser: StubUser = { sub: 'naver:1001', name: '테스터', email: 'tester@example.com', marketingConsent: true };
const searchbox = () => page.getByRole('searchbox', { name: '검색' });
const resultHeader = (pattern: RegExp) => page.locator('p:visible', { hasText: pattern }).first();

async function openContext(options: Parameters<Browser['newContext']>[0] = { viewport: DESKTOP_VIEWPORT }) {
  await context?.close();
  context = await browser.newContext(options);
  page = await context.newPage();
}

beforeAll(async () => {
  requireDist();
  const problems: Problem[] = JSON.parse(readFileSync(path.join(DIST_DIR, 'data/problems.json'), 'utf8'));
  const hapsuk = problems.filter((p) => p.sourceType === '합숙' && p.explanationFileId);
  const latest = Math.max(...hapsuk.map((p) => p.roundOrder));
  server = await startDistServer(DIST_DIR);
  latestHapsukUrl = `${server.url}/?type=${encodeURIComponent('합숙')}&rmin=${latest}&rmax=${latest}`;
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

beforeEach(async () => {
  server.setUser(null);
  server.apiRequests.length = 0;
  await openContext();
});

afterEach(async () => {
  await context?.close();
});

describe('검색창', () => {
  it('E10: 입력하면 URL q·결과 수·하이라이트가 반영되고, 1.5초 뒤 검색 기록에 저장돼 새로고침 후 다시 쓸 수 있다', async () => {
    await page.goto(server.url);
    await resultHeader(/전체\s*[\d,]+\s*건/).waitFor();
    await searchbox().fill('블록체인');

    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('블록체인');
    await resultHeader(/건 검색됨/).waitFor();
    await page.locator('article mark', { hasText: '블록체인' }).first().waitFor();

    await page.waitForTimeout(1_800); // HISTORY_SAVE_DELAY 1.5초
    await page.reload();
    await searchbox().click();
    await page.getByText('최근 검색어').waitFor();

    await searchbox().fill('');
    await searchbox().click();
    await page.locator('li button', { hasText: '블록체인' }).first().click();
    await expect.poll(() => searchbox().inputValue()).toBe('블록체인');

    await searchbox().click();
    await page.getByRole('button', { name: '전체 지우기' }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('kpcitpe.search-history'))).toBe('[]');
    await expect.poll(() => page.getByText('최근 검색어').count()).toBe(0);
  });
});

describe('결과 목록', () => {
  it('E11: 처음엔 30건, "더 보기"마다 30건씩 늘고 200건 초과 안내가 보인다', async () => {
    await page.goto(server.url);
    await resultHeader(/전체\s*[\d,]+\s*건/).waitFor();
    await expect.poll(() => page.locator('article').count()).toBe(PAGE_SIZE);

    const more = page.getByRole('button', { name: /더 보기/ });
    expect(await more.textContent()).toContain(`${RESULT_LIMIT - PAGE_SIZE}건 남음`);
    await more.click();
    await expect.poll(() => page.locator('article').count()).toBe(PAGE_SIZE * 2);
    await page.getByText(`결과가 ${RESULT_LIMIT}건을 초과해 일부만 표시됩니다`).waitFor();
  });
});

describe('모바일 화면', () => {
  it('E12: 필터 drawer를 열어 칩을 고르면 필터 개수 배지가 붙고, 닫힌 뒤 URL에 반영된다', async () => {
    await openContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(server.url);
    await page.getByRole('button', { name: /필터/ }).first().click();
    const drawer = page.locator('div.fixed', { has: page.getByRole('heading', { name: '필터' }) });
    await drawer.getByRole('button', { name: '합숙', exact: true }).click();
    await drawer.getByRole('button', { name: '✕' }).click();
    await expect.poll(() => drawer.count()).toBe(0);

    await expect.poll(() => new URL(page.url()).searchParams.get('type')).toBe('합숙');
    expect(await page.getByRole('button', { name: /필터/ }).first().textContent()).toMatch(/필터\s*1/);
  });

  it('E13: 모바일에서 동의 사용자가 해설지를 누르면 모달 대신 새 탭으로 서버 프록시 PDF를 연다', async () => {
    await openContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    server.setUser(consentedUser);
    await page.goto(latestHapsukUrl);
    const button = page.getByRole('button', { name: /해설지 보기/ }).first();
    await expect.poll(() => button.textContent(), { timeout: 30_000 }).not.toMatch(/필요/);

    const [popup] = await Promise.all([context.waitForEvent('page'), button.click()]);
    await popup.waitForLoadState();
    expect(new URL(popup.url()).pathname).toBe('/api/explanation');
    expect(new URL(popup.url()).searchParams.get('fileId')).toBeTruthy();
    expect(await page.getByRole('dialog', { name: '해설지' }).count()).toBe(0);
  });
});

describe('로그인 메뉴', () => {
  it('E14: 비로그인 — "네이버 로그인" 링크가 현재 경로·검색어를 return으로 넘긴다', async () => {
    await page.goto(`${server.url}/?q=${encodeURIComponent('AI')}`);
    const login = page.getByRole('link', { name: /네이버 로그인/ });
    await login.waitFor();
    const href = new URL((await login.getAttribute('href'))!, server.url);
    expect(href.pathname).toBe('/api/auth/naver/login');
    expect(href.searchParams.get('return')).toBe('/?q=AI');
  });

  it('E15: 로그인 — 이름 메뉴에서 수신동의를 켜면 consent API 호출 후 체크 상태로 바뀌고, 로그아웃 링크가 있다', async () => {
    server.setUser({ ...consentedUser, marketingConsent: false });
    await page.goto(server.url);
    await page.getByRole('button', { name: /테스터/ }).click();
    await page.getByText('tester@example.com').waitFor();

    const checkbox = page.getByRole('checkbox', { name: /광고성 정보 수신 동의/ });
    expect(await checkbox.isChecked()).toBe(false);
    // 체크 상태는 서버 저장 → /api/me 재조회 후에 바뀌는 제어 컴포넌트라 check() 대신 click 후 대기
    await checkbox.click();
    await expect.poll(() => checkbox.isChecked()).toBe(true);
    expect(server.apiRequests.filter((r) => r.path === '/api/consent').map((r) => r.body)).toEqual([JSON.stringify({ consent: true })]);
    expect(await page.getByRole('link', { name: '로그아웃' }).getAttribute('href')).toBe('/api/auth/logout');
  });
});

describe('없는 주소', () => {
  it('E16: 없는 페이지·없는 회차는 404 상태로 안내 페이지와 검색·회차 목록 링크를 보여준다', async () => {
    for (const target of ['/nope-page', `/rounds/${encodeURIComponent('모의')}/1999.01/`]) {
      const response = await page.goto(`${server.url}${target}`);
      expect(response?.status(), target).toBe(404);
      await page.getByRole('heading', { name: '페이지를 찾을 수 없습니다' }).waitFor();
      expect(await page.getByRole('link', { name: '검색으로' }).getAttribute('href')).toBe('/');
      expect(await page.getByRole('link', { name: '회차별 목록' }).getAttribute('href')).toBe('/rounds/');
    }
  });
});
