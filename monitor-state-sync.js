(() => {
  const apiBase = String(window.SNOW_API_BASE || '').replace(/\/$/, '');
  if (!apiBase) return;

  function apply(summary) {
    if (!Array.isArray(summary?.enabled_resort_ids)) return false;
    if (typeof state === 'undefined' || !state?.data?.watches) return false;
    const enabled = new Set(summary.enabled_resort_ids.map(String));
    state.data.watches.forEach((watch) => {
      watch.auto_monitor = enabled.has(String(watch.id));
    });
    if (typeof renderAll === 'function') renderAll();
    return true;
  }

  function applyEventually(summary) {
    if (apply(summary)) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (apply(summary) || attempts >= 60) clearInterval(timer);
    }, 100);
  }

  async function sync() {
    try {
      const response = await fetch(`${apiBase}/api/monitor-summary`, { cache: 'no-store' });
      if (!response.ok) return;
      applyEventually(await response.json());
    } catch {
      // Keep static config badges when the API is temporarily unavailable.
    }
  }

  window.addEventListener('snow-monitors-updated', (event) => applyEventually(event.detail));
  sync();
})();
