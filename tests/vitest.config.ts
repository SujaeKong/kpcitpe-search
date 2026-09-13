import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 실행: npm test (unit) / npm run test:e2e / npm run test:live — tests/README.md 참고
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
