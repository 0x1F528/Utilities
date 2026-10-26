import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, open, unlink, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ROOT } from '../server.js';

const run = path.join(ROOT, '.run');
const pidFile = path.join(run, 'utilities.pid');
const windowsStartup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'LocalUtilities.vbs');
const linuxUnitDir = path.join(homedir(), '.config', 'systemd', 'user');
const linuxUnitPath = path.join(linuxUnitDir, 'local-utilities.service');
const cronTag = '# local-utilities-autostart';

async function health() {
  try {
    const response = await fetch('http://127.0.0.1:8765/api/health', { signal: AbortSignal.timeout(1500) });
    const data = await response.json();
    return data.ok && data.root === ROOT ? data : null;
  } catch {
    return null;
  }
}

async function start() {
  if (await health()) return console.log('Utilities is already running.');
  await mkdir(run, { recursive: true });
  const log = await open(path.join(run, 'utilities.log'), 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log.fd, log.fd],
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  await log.close();
  for (let i = 0; i < 30; i++) {
    const data = await health();
    if (data?.pid === child.pid) {
      await writeFile(pidFile, String(child.pid));
      return console.log('Utilities started: http://127.0.0.1:8765');
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Server did not start. See .run/utilities.log; port 8765 may be occupied.');
}

async function stop() {
  const data = await health();
  if (!data) return console.log('Utilities is not running.');
  process.kill(data.pid);
  for (let i = 0; i < 30 && await health(); i++) await new Promise(r => setTimeout(r, 100));
  if (await health()) throw new Error('Server did not stop.');
  await unlink(pidFile).catch(() => {});
  console.log('Utilities stopped.');
}

function hasSystemdUser() {
  try {
    execFileSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function installWindowsAutostart() {
  const quote = value => value.replaceAll('"', '""');
  const command = `"${process.execPath}" "${path.join(ROOT, 'scripts', 'control.js')}" start`;
  await writeFile(windowsStartup, `Set shell = CreateObject("WScript.Shell")\r\nshell.Run "${quote(command)}", 0, False\r\n`);
  console.log('Autostart installed for Windows sign-in.');
}

async function installLinuxAutostart() {
  await mkdir(run, { recursive: true });
  const startCommand = `${process.execPath} ${JSON.stringify(path.join(ROOT, 'scripts', 'control.js'))} start`;

  if (hasSystemdUser()) {
    const unit = `[Unit]
Description=Local utilities dashboard (port 8765)
After=default.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${ROOT}
ExecStart=${process.execPath} ${path.join(ROOT, 'scripts', 'control.js')} start
ExecStop=${process.execPath} ${path.join(ROOT, 'scripts', 'control.js')} stop

[Install]
WantedBy=default.target
`;
    await mkdir(linuxUnitDir, { recursive: true });
    await writeFile(linuxUnitPath, unit);
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    execFileSync('systemctl', ['--user', 'enable', 'local-utilities.service'], { stdio: 'inherit' });
    try {
      execFileSync('loginctl', ['enable-linger', process.env.USER || ''], { stdio: 'ignore' });
    } catch {
      /* linger is optional in WSL */
    }
    console.log('Autostart installed as systemd user service: local-utilities.service');
    console.log('  status: systemctl --user status local-utilities');
    return;
  }

  const line = `@reboot ${startCommand} ${cronTag}`;
  let existing = '';
  try {
    existing = execFileSync('crontab', ['-l'], { encoding: 'utf8' });
  } catch {
    existing = '';
  }
  if (existing.includes(cronTag)) {
    console.log('crontab @reboot entry already present');
  } else {
    const next = `${existing.trimEnd()}\n${line}\n`;
    execFileSync('crontab', ['-'], { input: next, stdio: ['pipe', 'inherit', 'inherit'] });
    console.log('Autostart installed via crontab @reboot (WSL distro boot).');
  }
}

async function uninstallAutostart() {
  if (process.platform === 'win32') {
    await unlink(windowsStartup).catch(e => {
      if (e.code !== 'ENOENT') throw e;
    });
    console.log('Autostart removed.');
    return;
  }

  let removed = false;
  try {
    await access(linuxUnitPath);
    if (hasSystemdUser()) {
      try {
        execFileSync('systemctl', ['--user', 'disable', '--now', 'local-utilities.service'], { stdio: 'ignore' });
      } catch {
        /* may already be inactive */
      }
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    }
    await unlink(linuxUnitPath).catch(() => {});
    removed = true;
  } catch {
    /* no unit */
  }

  try {
    const existing = execFileSync('crontab', ['-l'], { encoding: 'utf8' });
    if (existing.includes(cronTag)) {
      const next = existing
        .split(/\r?\n/)
        .filter(line => !line.includes(cronTag))
        .join('\n')
        .replace(/\n+$/, '\n');
      execFileSync('crontab', ['-'], { input: next === '\n' ? '' : next, stdio: ['pipe', 'inherit', 'inherit'] });
      removed = true;
    }
  } catch {
    /* no crontab */
  }

  console.log(removed ? 'Autostart removed.' : 'No autostart entry found.');
}

try {
  // Let the browser control response finish before stopping its server.
  if (process.argv[3] === '--defer') await new Promise(resolve => setTimeout(resolve, 750));
  switch (process.argv[2]) {
    case 'start':
      await start();
      break;
    case 'stop':
      await stop();
      break;
    case 'restart':
      await stop();
      await start();
      break;
    case 'status': {
      console.log(await health() ? 'Running at http://127.0.0.1:8765' : 'Stopped');
      try {
        console.log((await readFile(path.join(run, 'utilities.log'), 'utf8')).trim().split('\n').slice(-5).join('\n'));
      } catch {
        /* no log yet */
      }
      break;
    }
    case 'install': {
      if (process.platform === 'win32') await installWindowsAutostart();
      else if (process.platform === 'linux' || process.platform === 'darwin') await installLinuxAutostart();
      else throw new Error(`Autostart is not supported on ${process.platform}.`);
      await start();
      break;
    }
    case 'uninstall':
      await uninstallAutostart();
      break;
    default:
      throw new Error('Use start, stop, restart, status, install, or uninstall.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
