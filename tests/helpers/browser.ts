import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext } from 'playwright';

export const DIST_DIR = fileURLToPath(new URL('../../dist', import.meta.url));
export const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

export function requireDist(): void {
  if (!existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error('dist/가 없습니다. `npm run test:e2e`(빌드 포함) 또는 `npm run build` 후 실행하세요.');
  }
}

// 설치된 Chrome 우선, 없으면 Playwright 번들 Chromium (npx playwright install chromium)
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

/** 디스크 캐시가 남는 브라우저 프로필 (재방문 시나리오용) */
export async function launchPersistent(profileDir: string): Promise<BrowserContext> {
  const options = { headless: true, viewport: DESKTOP_VIEWPORT };
  try {
    return await chromium.launchPersistentContext(profileDir, { ...options, channel: 'chrome' });
  } catch {
    return await chromium.launchPersistentContext(profileDir, options);
  }
}
