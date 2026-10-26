const status = document.querySelector('#control-status');
const buttons = [document.querySelector('#restart'), document.querySelector('#stop')];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
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
