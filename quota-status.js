(() => {
  const apiBase = String(window.SNOW_API_BASE || '').replace(/\/$/, '');
  if (!apiBase) return;

  function ensureHost() {
    let host = document.querySelector('#quotaStatus');
    if (host) return host;
    host = document.createElement('span');
    host.id = 'quotaStatus';
    host.className = 'quota-status';
    host.textContent = 'SerpApi —';
    const actions = document.querySelector('.top-actions');
    if (actions) actions.insertBefore(host, actions.firstChild);
    return host;
  }

  async function updateQuotaStatus() {
    const host = ensureHost();
    try {
      const response = await fetch(`${apiBase}/api/status`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = await response.json();
      const account = status?.serpapi || status?.serpapi_pool?.keys?.[0] || null;
      const left = Number(account?.total_searches_left);
      const used = Number(account?.this_month_usage);
      const total = Number(account?.searches_per_month);
      const monitored = Number(status?.estimated_monitored_refresh_cost ?? status?.automatic_searches_per_run ?? 0);
      const monthAuto = Number(status?.estimated_monthly_automatic_max ?? monitored * 31);
      const full = Number(status?.estimated_full_catalog_refresh_cost ?? status?.catalog_count ?? 0);

      host.textContent = Number.isFinite(left) ? `SerpApi ${left} left` : 'SerpApi quota';
      const parts = [];
      if (Number.isFinite(used) && Number.isFinite(total)) parts.push(`本月 ${used} / ${total}`);
      if (Number.isFinite(left)) parts.push(`剩 ${left}`);
      if (Number.isFinite(monitored)) parts.push(`每日監控最多 ${monitored}`);
      if (Number.isFinite(monthAuto)) parts.push(`31 天監控最多 ${monthAuto}`);
      if (Number.isFinite(full)) parts.push(`全 catalog 最多 ${full}`);
      host.title = parts.join(' · ');
      host.classList.remove('quota-error');
    } catch {
      host.textContent = 'SerpApi ?';
      host.title = '目前無法取得 SerpApi 額度狀態';
      host.classList.add('quota-error');
    }
  }

  updateQuotaStatus();
  setInterval(updateQuotaStatus, 300000);
  window.addEventListener('snow-monitors-updated', updateQuotaStatus);
})();
