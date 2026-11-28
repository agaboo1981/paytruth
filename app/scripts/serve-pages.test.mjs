import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function get(path, port, hostname = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

test('static server rejects malformed requests and continues serving valid requests on all interfaces', { timeout: 15000 }, async () => {
  // Run a copy with isolated build/staging directories, without touching a live preview.
  const root = await mkdtemp(join(tmpdir(), 'paytruth-server-test-'));
  let child;
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'out'));
    await copyFile(new URL('./serve-pages.mjs', import.meta.url), join(root, 'scripts', 'serve-pages.mjs'));
    await writeFile(join(root, 'out', 'index.html'), '<h1>Paytruth test</h1>');
    await writeFile(join(root, 'out', 'hello world.txt'), 'asset');
    await writeFile(join(root, 'out', '404.html'), 'Missing page');

    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));

    child = spawn(process.execPath, [join(root, 'scripts', 'serve-pages.mjs'), '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      let output = '';
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error(`Server exited before startup: ${code}`)));
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes(`http://0.0.0.0:${port}/paytruth/`)) resolve();
      });
    });

    for (const path of ['/paytruth/%', '/paytruth/%E0%A4%A', '/paytruth/%FF', 'http://[invalid']) {
      const response = await get(path, port);
      assert.equal(response.status, 400, path);
      assert.equal(response.body, 'Bad request', path);
      assert.equal(response.headers['content-type'], 'text/plain', path);
      assert.equal((await get('/paytruth/', port)).body, '<h1>Paytruth test</h1>');
      assert.equal(child.exitCode, null, 'server must survive malformed input');
    }

    for (const path of ['/?q=%25', '/paytruth?q=%25']) {
      const response = await get(path, port);
      assert.equal(response.status, 308);
      assert.equal(response.headers.location, '/paytruth/?q=%25');
    }
    assert.equal((await get('/paytruth/hello%20world.txt', port)).body, 'asset');
    assert.equal((await get('/paytruth/?q=%', port)).status, 200);
    assert.equal((await get('/paytruth/%2e%2e%2f%2e%2e%2foutside', port)).status, 400);
    assert.equal((await get('/paytruth/missing', port)).status, 404);

    const external = Object.values(networkInterfaces()).flat().find((entry) => entry.family === 'IPv4' && !entry.internal);
    if (external) assert.equal((await get('/paytruth/', port, external.address)).status, 200);
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
