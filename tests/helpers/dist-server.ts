/**
 * e2e용 로컬 정적 서버 — 빌드 결과(dist/)를 Cloudflare Pages와 같은 캐시 정책으로 서빙.
 * - 모든 정적 파일: Cache-Control: public, max-age=0, must-revalidate + ETag (If-None-Match → 304)
 * - /data/problems.json 내용은 setProblems()로 교체 가능 (= 새 데이터 배포 시뮬레이션)
 * - /api/me 는 비로그인 응답으로 고정
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

export interface DistServer {
  url: string;
  setProblems(problems: unknown[]): void;
  /** /data/problems.json 요청마다 응답한 상태코드 (200 = 전체 전송, 304 = 캐시 재사용) */
  problemsStatuses: number[];
  close(): Promise<void>;
}

export async function startDistServer(distDir: string): Promise<DistServer> {
  const root = path.resolve(distDir);
  let problemsBody = readFileSync(path.join(root, 'data/problems.json'));
  const problemsStatuses: number[] = [];

  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);

    if (pathname === '/api/me') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
      res.end('{"user":null}');
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
      res.writeHead(404).end();
      return;
    }

    const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
    const status = req.headers['if-none-match'] === etag ? 304 : 200;
    if (pathname === '/data/problems.json') problemsStatuses.push(status);
    res.writeHead(status, {
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=0, must-revalidate',
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
