/**
 * e2e용 로컬 서버 — 빌드 결과(dist/)를 Cloudflare Pages와 같은 캐시 정책으로 서빙.
 * - 정적 파일: Cache-Control: public, max-age=0, must-revalidate + ETag (If-None-Match → 304)
 * - /_astro/*: public/_headers와 같은 장기 캐시(immutable)
 * - /data/problems.json 내용은 setProblems()로 교체 가능 (= 새 데이터 배포 시뮬레이션)
 * - /api/* 는 대역: me(setUser로 로그인 상태 지정), consent, explanation, 네이버 로그인
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StubUser {
  sub: string;
  name?: string;
  email?: string;
  marketingConsent?: boolean;
}

export interface DistServer {
  url: string;
  setProblems(problems: unknown[]): void;
  /** /data/problems.json 요청마다 응답한 상태코드 (200 = 전체 전송, 304 = 캐시 재사용) */
  problemsStatuses: number[];
  /** /api/me가 돌려줄 사용자 (null = 비로그인) */
  setUser(user: StubUser | null): void;
  /** /api/* 요청 기록 */
  apiRequests: { method: string; path: string; body: string }[];
  close(): Promise<void>;
}

export async function startDistServer(distDir: string): Promise<DistServer> {
  const root = path.resolve(distDir);
  let problemsBody = readFileSync(path.join(root, 'data/problems.json'));
  let user: StubUser | null = null;
  const problemsStatuses: number[] = [];
  const apiRequests: DistServer['apiRequests'] = [];

  const json = (res: http.ServerResponse, body: unknown) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
    res.end(JSON.stringify(body));
  };

  const handleApi = (req: http.IncomingMessage, res: http.ServerResponse, pathname: string, body: string) => {
    apiRequests.push({ method: req.method ?? 'GET', path: pathname, body });
    if (pathname === '/api/me') return json(res, { user });
    if (pathname === '/api/consent' && req.method === 'POST') {
      const consent = JSON.parse(body || '{}').consent === true;
      if (user) user = { ...user, marketingConsent: consent };
      return json(res, { ok: true, marketingConsent: consent });
    }
    if (pathname === '/api/explanation' || pathname === '/api/auth/naver/login') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<p>stub ${pathname}</p>`);
    }
    res.writeHead(404).end();
  };

  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);

    if (pathname.startsWith('/api/')) {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => handleApi(req, res, pathname, Buffer.concat(chunks).toString('utf8')));
      return;
    }

    let body: Buffer | null = null;
    let ext = '.json';
    if (pathname === '/data/problems.json') {
      body = problemsBody;
    } else {
      let file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (existsSync(file)) {
        body = readFileSync(file);
        ext = path.extname(file);
      }
    }
    if (!body) {
      // Cloudflare Pages처럼 dist/404.html이 있으면 404 상태로 그 페이지를 준다
      const notFound = path.join(root, '404.html');
      if (existsSync(notFound)) {
        res.writeHead(404, { 'content-type': CONTENT_TYPES['.html'] });
        res.end(readFileSync(notFound));
      } else {
        res.writeHead(404).end();
      }
      return;
    }

    const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
    const status = req.headers['if-none-match'] === etag ? 304 : 200;
    if (pathname === '/data/problems.json') problemsStatuses.push(status);
    res.writeHead(status, {
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      // public/_headers와 동일: 해시 파일명 자산만 장기 캐시, 나머지는 매번 재검증
      'cache-control': pathname.startsWith('/_astro/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
      etag,
    });
    res.end(status === 304 ? undefined : body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    setProblems(problems) {
      problemsBody = Buffer.from(JSON.stringify(problems));
    },
    problemsStatuses,
    setUser(next) {
      user = next;
    },
    apiRequests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
