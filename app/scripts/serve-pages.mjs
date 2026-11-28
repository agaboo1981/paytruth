#!/usr/bin/env node
/**
 * Stage Next `out/` under `.pages-root/paytruth` (matching basePath) and
 * serve it. Used for local preview and Playwright after `next build`.
 */
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = join(appRoot, 'out');
const stageRoot = join(appRoot, '.pages-root');
const siteDir = join(stageRoot, 'paytruth');

function parsePort(argv) {
  const idx = argv.indexOf('--port');
  if (idx !== -1 && argv[idx + 1]) return Number(argv[idx + 1]);
  const eq = argv.find((a) => a.startsWith('--port='));
  if (eq) return Number(eq.slice('--port='.length));
  return Number(process.env.PORT || 4173);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function stage() {
  if (!existsSync(outDir)) {
    console.error('serve-pages: missing app/out. Run `npm run build` (or `npm run build:mock`) first.');
    process.exit(1);
  }
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(siteDir, { recursive: true });
  cpSync(outDir, siteDir, { recursive: true });
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const resolved = resolve(root, '.' + decoded);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || rel.includes('\0')) return null;
  return resolved;
}

async function readExisting(file) {
  try {
    const st = statSync(file);
    if (st.isDirectory()) return null;
    return await readFile(file);
  } catch {
    return null;
  }
}

stage();
const port = parsePort(process.argv.slice(2));
if (!Number.isFinite(port) || port <= 0) {
  console.error('serve-pages: invalid port');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  let pathname = url.pathname;

  if (pathname === '/' || pathname === '/paytruth') {
    res.writeHead(308, { Location: `/paytruth/${url.search}` });
    res.end();
    return;
  }

  const target = safeJoin(stageRoot, pathname);
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }

  const candidates = [];
  candidates.push(target);
  if (!extname(target)) {
    candidates.push(join(target, 'index.html'));
    candidates.push(`${target}.html`);
  }

  let body = null;
  let file = null;
  for (const c of candidates) {
    body = await readExisting(c);
    if (body) {
      file = c;
      break;
    }
  }

  if (!body) {
    const notFound = join(stageRoot, 'paytruth', '404.html');
    const nf = await readExisting(notFound);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(nf || 'Not found');
    return;
  }

  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(body);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Serving GitHub Pages staging root at http://0.0.0.0:${port}/paytruth/`);
});
