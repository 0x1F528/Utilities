import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readdir, readFile, stat, realpath } from 'node:fs/promises';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const excluded = new Set(['scripts', 'lib', 'test', 'node_modules']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export async function discover(root = ROOT) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || excluded.has(entry.name)) continue;
    const folder = path.join(root, entry.name);
    try { if (!(await stat(path.join(folder, 'index.html'))).isFile()) continue; } catch { continue; }
    let metadata = {};
    try { metadata = JSON.parse(await readFile(path.join(folder, 'utility.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') console.error(`Invalid metadata in ${entry.name}: ${error.message}`); }
    result.push({ folder: entry.name, name: typeof metadata?.name === 'string' ? metadata.name : entry.name, description: typeof metadata?.description === 'string' ? metadata.description : '', icon: typeof metadata?.icon === 'string' ? metadata.icon : '◈' });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
function send(res, status, body, type = 'text/plain; charset=utf-8') { res.writeHead(status, { 'Content-Type': type }); res.end(body); }
export function createServer({ root = ROOT, port = 8765 } = {}) {
  const host = `127.0.0.1:${port}`;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (![host, `localhost:${port}`].includes(req.headers.host)) return send(res, 403, 'Invalid host');
      if (req.headers.origin && ![`http://${host}`, `http://localhost:${port}`].includes(req.headers.origin)) return send(res, 403, 'Invalid origin');
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'Cross-site requests are blocked');
      const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(s => s === '..' || s.startsWith('.'))) return send(res, 403, 'Forbidden path');
      const utilities = await discover(root);
      if (pathname === '/api/health') return send(res, 200, JSON.stringify({ ok: true, pid: process.pid, root, platform: process.platform }), 'application/json');
      if (pathname === '/api/utilities') return send(res, 200, JSON.stringify(utilities), 'application/json');
      if (pathname === '/') {
        if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method not allowed');
        return send(res, 200, req.method === 'HEAD' ? '' : dashboard(utilities), mime['.html']);
      }
      const segments = pathname.split('/').filter(Boolean);
      if (segments[0] === 'api') {
        const utility = utilities.find(u => u.folder === segments[1]);
        if (!utility) return send(res, 404, 'Unknown utility API');
        const modulePath = path.join(root, utility.folder, 'api.mjs');
        try { await stat(modulePath); } catch { return send(res, 404, 'Utility has no API'); }
        const module = await import(pathToFileURL(modulePath).href);
        if (typeof module.handle !== 'function') throw new Error('api.mjs must export handle');
        await module.handle(req, res, { root, utilityRoot: path.join(root, utility.folder), pathname: '/' + segments.slice(2).join('/'), json: (status, data) => send(res, status, JSON.stringify(data), 'application/json') });
        if (!res.writableEnded) res.end();
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method not allowed');
      if (!utilities.some(u => u.folder === segments[0])) return send(res, 404, 'Utility not found');
      if (segments.some(s => ['node_modules', 'api.mjs', 'package.json', 'package-lock.json'].includes(s)) || !Object.hasOwn(mime, path.extname(pathname).toLowerCase()) && path.extname(pathname)) return send(res, 403, 'File is not public');
      let filename = path.resolve(root, '.' + pathname);
      let info;
      try { info = await stat(filename); } catch { return send(res, 404, 'File not found'); }
      if (info.isDirectory()) {
        if (!pathname.endsWith('/')) { res.writeHead(308, { Location: encodeURI(pathname + '/') }); return res.end(); }
        filename = path.join(filename, 'index.html');
      }
      let actual;
      try { actual = await realpath(filename); } catch { return send(res, 404, 'Directory has no index.html'); }
      const utilityRoot = path.join(await realpath(root), segments[0]);
      const relative = path.relative(utilityRoot, actual);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return send(res, 403, 'Forbidden path');
      const body = await readFile(actual);
      send(res, 200, req.method === 'HEAD' ? '' : body, mime[path.extname(actual).toLowerCase()] || 'application/octet-stream');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, error instanceof URIError ? 400 : 500, JSON.stringify({ error: error instanceof URIError ? 'Malformed URL' : 'Internal server error' }), 'application/json');
      else res.end();
    }
  });
}
function dashboard(utilities) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Utilities</title><style>*{box-sizing:border-box}body{margin:0;background:#10151d;color:#edf1f7;font:16px system-ui}main{max-width:1050px;margin:70px auto;padding:24px}header{border-bottom:1px solid #303b4c;margin-bottom:32px;padding-bottom:24px}p{color:#aab8cc;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}a{display:block;background:#1a2433;border:1px solid #344359;border-radius:16px;padding:24px;color:inherit;text-decoration:none}a:hover{border-color:#8fbaff;background:#202e42}a:focus-visible{outline:3px solid #8fbaff}.icon{font-size:30px}h1{font-size:40px;margin:10px 0}h2{font-size:21px}small{color:#9eaec5}</style><main><header><small>YOUR LOCAL WORKSPACE</small><h1>Utilities</h1><p>Small tools. Ready when you need them.</p></header><div class="grid">${utilities.map(u => `<a href="/${encodeURIComponent(u.folder)}/"><span class="icon">${escape(u.icon)}</span><h2>${escape(u.name)}</h2><p>${escape(u.description || 'Open utility')}</p></a>`).join('') || '<p>Add a folder containing index.html to get started.</p>'}</div><p><small>${utilities.length} utilities · Runs on this computer · Refresh to discover new tools</small></p></main></html>`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(8765, '127.0.0.1', () => console.log('Utilities listening at http://127.0.0.1:8765'));
}
