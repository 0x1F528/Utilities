import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

let pending = false;
export async function handle(req, res, { root, pathname, json }) {
  if (!['/stop', '/restart'].includes(pathname)) return json(404, { error: 'Unknown endpoint' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(405, { error: 'Use POST for server controls' });
  }
  if (pending) return json(409, { error: 'A server control action is already in progress.' });
  pending = true;
  let log;
  try {
    await mkdir(path.join(root, '.run'), { recursive: true });
    log = await open(path.join(root, '.run', 'utilities.log'), 'a');
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'control.js'), pathname.slice(1), '--defer'], {
      cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd]
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    const timer = setTimeout(() => { pending = false; }, 15000);
    timer.unref();
    json(202, { accepted: true, pid: process.pid });
  } catch (error) {
    pending = false;
    console.error('Could not launch server control:', error);
    json(500, { error: 'Could not launch server control. Use the manual instructions below.' });
  } finally { await log?.close(); }
}
