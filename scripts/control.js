import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../server.js';
const run = path.join(ROOT, '.run');
const pidFile = path.join(run, 'utilities.pid');
const startup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'LocalUtilities.vbs');
async function health() {
  try { const response = await fetch('http://127.0.0.1:8765/api/health', { signal: AbortSignal.timeout(1500) }); const data = await response.json(); return data.ok && data.root === ROOT ? data : null; } catch { return null; }
}
async function start() {
  if (await health()) return console.log('Utilities is already running.');
  await mkdir(run, { recursive: true });
  const log = await open(path.join(run, 'utilities.log'), 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref(); await log.close();
  for (let i = 0; i < 30; i++) { const data = await health(); if (data?.pid === child.pid) { await writeFile(pidFile, String(child.pid)); return console.log('Utilities started: http://127.0.0.1:8765'); } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Server did not start. See .run/utilities.log; port 8765 may be occupied.');
}
async function stop() {
  const data = await health();
  if (!data) return console.log('Utilities is not running.');
  process.kill(data.pid);
  for (let i = 0; i < 30 && await health(); i++) await new Promise(r => setTimeout(r, 100));
  if (await health()) throw new Error('Server did not stop.');
  await unlink(pidFile).catch(() => {}); console.log('Utilities stopped.');
}
try {
  // Let the browser control response finish before stopping its server.
  if (process.argv[3] === '--defer') await new Promise(resolve => setTimeout(resolve, 750));
  switch (process.argv[2]) {
    case 'start': await start(); break;
    case 'stop': await stop(); break;
    case 'restart': await stop(); await start(); break;
    case 'status': { console.log(await health() ? 'Running at http://127.0.0.1:8765' : 'Stopped'); try { console.log((await readFile(path.join(run, 'utilities.log'), 'utf8')).trim().split('\n').slice(-5).join('\n')); } catch {} break; }
    case 'install': {
      if (process.platform !== 'win32') throw new Error('Windows is required.');
      const quote = value => value.replaceAll('"', '""');
      const command = `"${process.execPath}" "${path.join(ROOT, 'scripts', 'control.js')}" start`;
      await writeFile(startup, `Set shell = CreateObject("WScript.Shell")\r\nshell.Run "${quote(command)}", 0, False\r\n`);
      console.log('Autostart installed for Windows sign-in.'); await start(); break;
    }
    case 'uninstall': await unlink(startup).catch(e => { if (e.code !== 'ENOENT') throw e; }); console.log('Autostart removed.'); break;
    default: throw new Error('Use start, stop, restart, status, install, or uninstall.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
