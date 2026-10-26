const status = document.querySelector('#control-status');
const recoveryIntro = document.querySelector('#recovery-intro');
const recoveryNotes = document.querySelector('#recovery-notes');
const buttons = [document.querySelector('#restart'), document.querySelector('#stop')];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function applyRecoveryCopy(platform) {
  if (!recoveryIntro || !recoveryNotes) return;
  if (platform === 'win32') {
    recoveryIntro.textContent = 'To start again, open PowerShell or a terminal in the Utilities folder:';
    recoveryNotes.innerHTML = 'Other commands: npm run restart · npm run stop · npm run status. Reload after starting. Logs: .run/utilities.log. Use a native Windows <code>node</code>/<code>npm</code> for this deployment.';
  } else if (platform === 'linux' || platform === 'darwin') {
    recoveryIntro.textContent = 'To start again, open a WSL or Linux terminal in the Utilities folder:';
    recoveryNotes.innerHTML = 'Other commands: npm run restart · npm run stop · npm run status. Reload after starting. Logs: .run/utilities.log. Prefer Linux <code>node</code>/<code>npm</code> (not Windows Node via <code>/mnt/c/...</code>).';
  } else {
    recoveryIntro.textContent = 'To start again, open a terminal in the Utilities folder:';
    recoveryNotes.textContent = 'Other commands: npm run restart · npm run stop · npm run status. Reload after starting. Logs: .run/utilities.log. Deploy with one Node runtime (Windows or WSL), not both.';
  }
}

fetch('/api/health', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(health => { if (health?.platform) applyRecoveryCopy(health.platform); })
  .catch(() => {});

for (const button of buttons) button.addEventListener('click', async () => {
  const action = button.id;
  buttons.forEach(b => b.disabled = true);
  status.textContent = action === 'restart' ? 'Restarting manager…' : 'Stopping manager…';
  let accepted = false;
  try {
    const response = await fetch(`/api/Hello/${action}`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The request failed.');
    accepted = true;
    const deadline = Date.now() + 20000;
    let misses = 0;
    while (Date.now() < deadline) {
      await pause(500);
      let health = null;
      try {
        const check = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(1000) });
        if (check.ok) health = await check.json();
      } catch {}
      if (health?.platform) applyRecoveryCopy(health.platform);
      if (action === 'restart' && health?.ok && health.pid !== result.pid) {
        status.textContent = 'Manager restarted successfully. All utilities are available.';
        buttons.forEach(b => b.disabled = false);
        return;
      }
      if (action === 'stop') {
        misses = health ? 0 : misses + 1;
        if (misses >= 3) {
          status.textContent = 'Manager is stopped. To start again, follow the instructions below, then reload this page.';
          return;
        }
      }
    }
    throw new Error('Could not confirm completion. Use the manual controls below and check the log.');
  } catch (error) {
    status.textContent = `${accepted ? '' : 'Request was not confirmed. '}${error.message}`;
    buttons.forEach(b => b.disabled = false);
  }
});
