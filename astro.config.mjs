import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// GitHub Pages 배포 기준.
// 사용자/조직 페이지(<user>.github.io)면 base는 '/' 유지.
// 프로젝트 페이지(<user>.github.io/kpcitpe-search)면 base를 '/kpcitpe-search'로 바꿀 것.
const SITE = process.env.SITE_URL ?? 'https://example.github.io';
const BASE = process.env.BASE_PATH ?? '/kpcitpe-search';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  vite: {
    ssr: {
      noExternal: ['fuse.js'],
    },
  },
});
