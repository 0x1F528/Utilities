import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';
test('discovery, static files, APIs and request boundaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'utilities-test-'));
  const server = createServer({ root, port: 8765 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (url, headers = {}) => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: url, headers: { Host: '127.0.0.1:8765', ...headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
  try {
    assert.deepEqual(JSON.parse((await request('/api/utilities')).body), []);
    await mkdir(path.join(root, 'New Tool'));
    await writeFile(path.join(root, 'New Tool', 'index.html'), '<h1>Ready</h1>');
    await writeFile(path.join(root, 'New Tool', 'utility.json'), '{"name":"<test>"}');
    await writeFile(path.join(root, 'New Tool', 'api.mjs'), 'export function handle(req,res,ctx){ctx.json(200,{path:ctx.pathname})}');
    assert.equal(JSON.parse((await request('/api/utilities')).body)[0].folder, 'New Tool');
    assert.match((await request('/')).body, /&lt;test&gt;/);
    assert.equal((await request('/New%20Tool/')).body, '<h1>Ready</h1>');
    assert.equal((await request('/New%20Tool')).status, 308);
    assert.deepEqual(JSON.parse((await request('/api/New%20Tool/ping')).body), { path: '/ping' });
    for (const url of ['/New%20Tool/api.mjs', '/%2e%2e/package.json', '/New%20Tool/.env', '/New%20Tool/%5c..%5csecret']) assert.equal((await request(url)).status, 403);
    assert.equal((await request('/%ZZ')).status, 400);
    assert.equal((await request('/', { Host: 'attacker.example' })).status, 403);
    assert.equal((await request('/api/New%20Tool/', { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await request('/api/New%20Tool/', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await request('/missing/')).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
