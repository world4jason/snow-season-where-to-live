(() => {
  const apiBase = String(window.SNOW_API_BASE || '').replace(/\/$/, '');
  if (!apiBase) return;

  const CONFIG_URLS = ['config/watches.json', 'config/extra-watches.json'];
  const EXCLUSIONS_URL = 'config/excluded-resorts.json';
  let catalog = [];
  let adminToken = '';
  let currentMonitors = [];
  let monitorSummary = null;
  let root = null;

  const html = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  async function loadCatalog() {
    if (catalog.length) return catalog;
    const [groups, excludedRows] = await Promise.all([
      Promise.all(CONFIG_URLS.map(async (url) => {
        const response = await fetch(`${url}?v=${Date.now()}`);
        if (!response.ok) throw new Error(`Unable to load ${url}`);
        const rows = await response.json();
        return Array.isArray(rows) ? rows : [];
      })),
      fetch(`${EXCLUSIONS_URL}?v=${Date.now()}`)
        .then((response) => response.ok ? response.json() : [])
        .catch(() => []),
    ]);
    const excluded = new Set((Array.isArray(excludedRows) ? excludedRows : []).map((row) => String(row?.id || '')));
    const byId = new Map();
    groups.flat().forEach((watch) => {
      if (!excluded.has(String(watch.id))) byId.set(String(watch.id), watch);
    });
    catalog = Array.from(byId.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hant'));
    return catalog;
  }

  function ensureButton() {
    let button = document.querySelector('#monitorSettingsButton');
    if (button) return button;
    button = document.createElement('button');
    button.id = 'monitorSettingsButton';
    button.className = 'monitor-settings-button';
    button.type = 'button';
    button.textContent = '監控設定';
    document.querySelector('.top-actions')?.insertBefore(button, document.querySelector('.ghost-link'));
    button.addEventListener('click', openSettings);
    return button;
  }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'monitorSettingsOverlay';
    root.className = 'monitor-settings-overlay';
    root.hidden = true;
    root.innerHTML = `
      <div class="monitor-settings-backdrop" data-monitor-close></div>
      <section class="monitor-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="monitorSettingsTitle">
        <header class="monitor-settings-header">
          <div>
            <span class="monitor-settings-eyebrow">DAILY WATCHER</span>
            <h2 id="monitorSettingsTitle">每日監控設定</h2>
            <p>每天台灣時間 08:20 自動查一次。最多同時啟用 5 個住宿區，保留 SerpApi Free 額度給手動搜尋。</p>
          </div>
          <button class="monitor-settings-close" type="button" data-monitor-close aria-label="關閉">×</button>
        </header>

        <div id="monitorSummaryStrip" class="monitor-summary-strip"></div>

        <div class="monitor-auth">
          <label>
            ADMIN_TOKEN
            <input id="monitorAdminToken" type="password" autocomplete="off" placeholder="只留在此頁面記憶體" />
          </label>
          <button id="monitorLoadButton" type="button">載入設定</button>
          <span class="monitor-auth-note">Token 不寫入 GitHub、URL 或 localStorage；重整頁面後會清除。</span>
        </div>

        <section id="monitorEditor" class="monitor-editor" hidden>
          <div class="monitor-editor-toolbar">
            <strong>監控項目</strong>
            <span id="monitorCostNote" class="monitor-cost-note"></span>
          </div>
          <div class="monitor-row-head" aria-hidden="true">
            <span>啟用</span><span>住宿區</span><span>入住</span><span>退房</span><span>人數</span><span>每晚預算</span><span></span>
          </div>
          <div id="monitorRows" class="monitor-rows"></div>
          <div class="monitor-editor-actions">
            <span id="monitorMessage" class="monitor-message"></span>
            <div>
              <button id="monitorAddButton" class="monitor-add-button" type="button">＋ 新增監控</button>
              <button id="monitorSaveButton" class="monitor-save-button" type="button">儲存設定</button>
            </div>
          </div>
        </section>
      </section>
    `;
    document.body.appendChild(root);

    root.addEventListener('click', (event) => {
      if (event.target.closest('[data-monitor-close]')) closeSettings();
    });
    root.querySelector('#monitorLoadButton')?.addEventListener('click', loadPrivateSettings);
    root.querySelector('#monitorAddButton')?.addEventListener('click', addMonitorRow);
    root.querySelector('#monitorSaveButton')?.addEventListener('click', saveSettings);
    root.querySelector('#monitorRows')?.addEventListener('click', (event) => {
      const remove = event.target.closest('.monitor-remove');
      if (!remove) return;
      remove.closest('.monitor-row')?.remove();
      updateCostNote();
    });
    root.querySelector('#monitorRows')?.addEventListener('change', updateCostNote);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root && !root.hidden) closeSettings();
    });
    return root;
  }

  function renderSummary(summary = monitorSummary) {
    const host = ensureRoot().querySelector('#monitorSummaryStrip');
    if (!summary) {
      host.innerHTML = '<div class="monitor-summary-card"><span>目前監控</span><strong>—</strong></div>';
      return;
    }
    host.innerHTML = `
      <div class="monitor-summary-card"><span>目前啟用</span><strong>${Number(summary.enabled_count || 0)} / ${Number(summary.max_enabled || 5)}</strong></div>
      <div class="monitor-summary-card"><span>每日執行</span><strong>08:20</strong></div>
      <div class="monitor-summary-card"><span>31 天最壞用量</span><strong>${Number(summary.estimated_31_day_max_searches || 0)} searches</strong></div>
    `;
    const button = ensureButton();
    button.textContent = `監控 ${Number(summary.enabled_count || 0)}/${Number(summary.max_enabled || 5)}`;
  }

  function applyPublicMonitorIds(summary) {
    if (!Array.isArray(summary?.enabled_resort_ids)) return;
    const enabled = new Set(summary.enabled_resort_ids.map(String));
    const apply = () => {
      if (!window.state?.data?.watches) return false;
      state.data.watches.forEach((watch) => { watch.auto_monitor = enabled.has(String(watch.id)); });
      if (typeof renderAll === 'function') renderAll();
      return true;
    };
    if (apply()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (apply() || attempts > 50) clearInterval(timer);
    }, 100);
  }

  async function fetchSummary() {
    try {
      const response = await fetch(`${apiBase}/api/monitor-summary`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      monitorSummary = await response.json();
      renderSummary();
      applyPublicMonitorIds(monitorSummary);
    } catch {
      ensureButton();
      renderSummary(null);
    }
  }

  function setMessage(message, type = '') {
    const host = ensureRoot().querySelector('#monitorMessage');
    if (!host) return;
    host.textContent = message;
    host.classList.remove('success', 'error');
    if (type) host.classList.add(type);
  }

  function resortOptions(selectedId = '') {
    return catalog.map((watch) => `<option value="${html(watch.id)}" ${String(watch.id) === String(selectedId) ? 'selected' : ''}>${html(watch.name)}</option>`).join('');
  }

  function monitorRow(row = {}) {
    const adults = Number(row.adults || 2);
    return `
      <div class="monitor-row">
        <label class="monitor-enable"><input class="monitor-enabled" type="checkbox" ${row.enabled !== false ? 'checked' : ''} /> <span>ON</span></label>
        <select class="monitor-resort" aria-label="住宿區">${resortOptions(row.resort_id)}</select>
        <input class="monitor-in" type="date" value="${html(row.check_in || '')}" aria-label="入住日期" />
        <input class="monitor-out" type="date" value="${html(row.check_out || '')}" aria-label="退房日期" />
        <select class="monitor-adults" aria-label="旅客人數">${[1,2,3,4,5,6].map((n) => `<option value="${n}" ${n === adults ? 'selected' : ''}>${n} 人</option>`).join('')}</select>
        <div class="monitor-budget"><span>NT$</span><input class="monitor-budget-input" type="number" min="500" max="30000" step="250" value="${Number(row.max_price_per_night || 6000)}" aria-label="每晚預算" /></div>
        <button class="monitor-remove" type="button" aria-label="刪除監控">×</button>
      </div>`;
  }

  function renderRows(monitors) {
    currentMonitors = Array.isArray(monitors) ? monitors : [];
    ensureRoot().querySelector('#monitorRows').innerHTML = currentMonitors.map(monitorRow).join('');
    updateCostNote();
  }

  function readRows() {
    return Array.from(ensureRoot().querySelectorAll('.monitor-row')).map((row) => ({
      resort_id: row.querySelector('.monitor-resort')?.value || '',
      enabled: row.querySelector('.monitor-enabled')?.checked === true,
      check_in: row.querySelector('.monitor-in')?.value || '',
      check_out: row.querySelector('.monitor-out')?.value || '',
      adults: Number(row.querySelector('.monitor-adults')?.value || 2),
      max_price_per_night: Number(row.querySelector('.monitor-budget-input')?.value || 6000),
    }));
  }

  function updateCostNote() {
    const rows = readRows();
    const enabled = rows.filter((row) => row.enabled).length;
    const note = ensureRoot().querySelector('#monitorCostNote');
    if (note) note.textContent = `啟用 ${enabled}/5 · 31 天最多約 ${enabled * 31} searches`;
    const save = ensureRoot().querySelector('#monitorSaveButton');
    if (save) save.disabled = enabled > 5;
  }

  function defaultNewRow() {
    const used = new Set(readRows().map((row) => row.resort_id));
    const selected = window.state?.selectedResort && state.selectedResort !== 'all' && !used.has(state.selectedResort)
      ? state.selectedResort
      : catalog.find((watch) => !used.has(String(watch.id)))?.id || catalog[0]?.id || '';
    return {
      resort_id: selected,
      enabled: readRows().filter((row) => row.enabled).length < 5,
      check_in: document.querySelector('#liveCheckIn')?.value || '2027-01-15',
      check_out: document.querySelector('#liveCheckOut')?.value || '2027-01-18',
      adults: Number(document.querySelector('#liveGuests')?.value || 2),
      max_price_per_night: Number(document.querySelector('#liveBudget')?.value || 6000),
    };
  }

  function addMonitorRow() {
    const host = ensureRoot().querySelector('#monitorRows');
    if (host.children.length >= 12) return setMessage('最多 12 個設定列；同時最多啟用 5 個。', 'error');
    host.insertAdjacentHTML('beforeend', monitorRow(defaultNewRow()));
    updateCostNote();
  }

  async function loadPrivateSettings() {
    await loadCatalog();
    const input = ensureRoot().querySelector('#monitorAdminToken');
    adminToken = String(input?.value || '').trim();
    if (!adminToken) return setMessage('請輸入 ADMIN_TOKEN。', 'error');
    setMessage('讀取中…');
    try {
      const response = await fetch(`${apiBase}/api/monitors`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      monitorSummary = payload;
      renderSummary(payload);
      renderRows(payload.monitors || []);
      ensureRoot().querySelector('#monitorEditor').hidden = false;
      setMessage(payload.source === 'defaults' ? '目前使用預設 5 區；儲存後會改為你的自訂設定。' : '已載入自訂監控設定。', 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function saveSettings() {
    if (!adminToken) return setMessage('請先用 ADMIN_TOKEN 載入設定。', 'error');
    const monitors = readRows();
    const enabled = monitors.filter((row) => row.enabled).length;
    if (enabled > 5) return setMessage('目前 Free 額度策略最多同時啟用 5 個監控。', 'error');
    setMessage('儲存中…');
    const save = ensureRoot().querySelector('#monitorSaveButton');
    if (save) save.disabled = true;
    try {
      const response = await fetch(`${apiBase}/api/monitors`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ monitors }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      monitorSummary = payload;
      renderSummary(payload);
      renderRows(payload.monitors || monitors);
      applyPublicMonitorIds(payload);
      window.dispatchEvent(new CustomEvent('snow-monitors-updated', { detail: payload }));
      setMessage('已儲存。下一次每日 08:20 會依這份設定監控。', 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      if (save) save.disabled = false;
      updateCostNote();
    }
  }

  async function openSettings() {
    const overlay = ensureRoot();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    await Promise.all([loadCatalog().catch(() => []), fetchSummary()]);
    if (adminToken) {
      const tokenInput = overlay.querySelector('#monitorAdminToken');
      if (tokenInput) tokenInput.value = adminToken;
      loadPrivateSettings();
    }
  }

  function closeSettings() {
    if (!root) return;
    root.hidden = true;
    document.body.style.overflow = '';
  }

  ensureButton();
  fetchSummary();
})();
