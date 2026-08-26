(() => {
  const apiBase = String(window.SNOW_API_BASE || '').replace(/\/$/, '');
  if (!apiBase) return;

  const CONFIG_URLS = ['config/watches.json', 'config/extra-watches.json'];
  const EXCLUSIONS_URL = 'config/excluded-resorts.json';
  const MapsUrl = window.GoogleMapsHotelUrl;
  let catalog = [];
  let adminToken = '';
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
            <h2 id="monitorSettingsTitle">監控與 Google Maps 參照</h2>
            <p>可儲存全部住宿區的 Maps 參照；只有勾選 Auto 的項目每天 08:20 使用 SerpApi，自動監控最多同時 5 筆。</p>
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
            <strong>住宿條件與 Maps 參照</strong>
            <span id="monitorCostNote" class="monitor-cost-note"></span>
          </div>
          <div class="monitor-row-head" aria-hidden="true">
            <span>Auto</span><span>住宿區</span><span>入住</span><span>退房</span><span>人數</span><span>每晚預算</span><span></span>
          </div>
          <div id="monitorRows" class="monitor-rows"></div>
          <div class="monitor-editor-actions">
            <span id="monitorMessage" class="monitor-message"></span>
            <div>
              <button id="monitorAddButton" class="monitor-add-button" type="button">＋ 新增住宿區</button>
              <button id="monitorSaveButton" class="monitor-save-button" type="button">儲存設定</button>
            </div>
          </div>
        </section>
      </section>
    `;
    document.body.appendChild(root);

    root.addEventListener('click', (event) => {
      if (event.target.closest('[data-monitor-close]')) return closeSettings();
      const remove = event.target.closest('.monitor-remove');
      if (remove) {
        remove.closest('.monitor-row')?.remove();
        updateCostNote();
        return;
      }
      const parse = event.target.closest('.monitor-maps-parse');
      if (parse) return parseMapsRow(parse.closest('.monitor-row'));
      const sync = event.target.closest('.monitor-maps-sync');
      if (sync) return syncMapsRow(sync.closest('.monitor-row'));
      const open = event.target.closest('.monitor-maps-open');
      if (open) return openMapsRow(open.closest('.monitor-row'));
    });
    root.querySelector('#monitorLoadButton')?.addEventListener('click', loadPrivateSettings);
    root.querySelector('#monitorAddButton')?.addEventListener('click', addMonitorRow);
    root.querySelector('#monitorSaveButton')?.addEventListener('click', saveSettings);
    root.querySelector('#monitorRows')?.addEventListener('change', updateCostNote);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root && !root.hidden) closeSettings();
    });
    return root;
  }

  function renderSummary(summary = monitorSummary) {
    const host = ensureRoot().querySelector('#monitorSummaryStrip');
    if (!summary) {
      host.innerHTML = '<div class="monitor-summary-card"><span>目前自動監控</span><strong>—</strong></div>';
      return;
    }
    host.innerHTML = `
      <div class="monitor-summary-card"><span>Auto 啟用</span><strong>${Number(summary.enabled_count || 0)} / ${Number(summary.max_enabled || 5)}</strong></div>
      <div class="monitor-summary-card"><span>每日執行</span><strong>08:20</strong></div>
      <div class="monitor-summary-card"><span>31 天最壞用量</span><strong>${Number(summary.estimated_31_day_max_searches || 0)} searches</strong></div>
    `;
    ensureButton().textContent = `監控 ${Number(summary.enabled_count || 0)}/${Number(summary.max_enabled || 5)}`;
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

  function mapsMeta(row) {
    if (!row.google_maps_url || !MapsUrl) return '';
    try {
      const parsed = MapsUrl.parse(row.google_maps_url);
      const pieces = [];
      if (Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude)) pieces.push(`${parsed.latitude.toFixed(4)}, ${parsed.longitude.toFixed(4)}`);
      if (parsed.check_in) pieces.push(parsed.check_in);
      if (parsed.nights) pieces.push(`${parsed.nights} 晚`);
      if (parsed.adults) pieces.push(`${parsed.adults} 人`);
      if (parsed.max_price_per_night) pieces.push(`NT$${Number(parsed.max_price_per_night).toLocaleString('zh-TW')}/晚`);
      return pieces.join(' · ');
    } catch {
      return '尚未解析';
    }
  }

  function monitorRow(row = {}) {
    const adults = Number(row.adults || 2);
    const mapsUrl = String(row.google_maps_url || '');
    return `
      <div class="monitor-row">
        <label class="monitor-enable"><input class="monitor-enabled" type="checkbox" ${row.enabled !== false ? 'checked' : ''} /> <span>ON</span></label>
        <select class="monitor-resort" aria-label="住宿區">${resortOptions(row.resort_id)}</select>
        <input class="monitor-in" type="date" value="${html(row.check_in || '')}" aria-label="入住日期" />
        <input class="monitor-out" type="date" value="${html(row.check_out || '')}" aria-label="退房日期" />
        <select class="monitor-adults" aria-label="旅客人數">${[1,2,3,4,5,6].map((n) => `<option value="${n}" ${n === adults ? 'selected' : ''}>${n} 人</option>`).join('')}</select>
        <div class="monitor-budget"><span>NT$</span><input class="monitor-budget-input" type="number" min="500" max="30000" step="250" value="${Number(row.max_price_per_night || 6000)}" aria-label="每晚預算" /></div>
        <button class="monitor-remove" type="button" aria-label="刪除住宿區">×</button>
        <div class="monitor-maps-field">
          <span class="monitor-maps-label">Google Maps</span>
          <input class="monitor-maps-input" type="url" value="${html(mapsUrl)}" placeholder="貼上 Google Maps 飯店搜尋 URL，可解析日期／人數／預算" aria-label="Google Maps 飯店搜尋 URL" />
          <button class="monitor-maps-parse" type="button">解析帶入</button>
          <button class="monitor-maps-sync" type="button" ${mapsUrl ? '' : 'disabled'}>同步 URL</button>
          <button class="monitor-maps-open" type="button">Maps ↗</button>
          <small class="monitor-maps-meta">${html(mapsMeta(row))}</small>
        </div>
      </div>`;
  }

  function renderRows(monitors) {
    ensureRoot().querySelector('#monitorRows').innerHTML = (Array.isArray(monitors) ? monitors : []).map(monitorRow).join('');
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
      google_maps_url: String(row.querySelector('.monitor-maps-input')?.value || '').trim(),
    }));
  }

  function updateCostNote() {
    const rows = readRows();
    const enabled = rows.filter((row) => row.enabled).length;
    const mapsCount = rows.filter((row) => row.google_maps_url).length;
    const note = ensureRoot().querySelector('#monitorCostNote');
    if (note) note.textContent = `Auto ${enabled}/5 · 31 天最多 ${enabled * 31} searches · Maps 參照 ${mapsCount}`;
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
      google_maps_url: '',
    };
  }

  function addMonitorRow() {
    const host = ensureRoot().querySelector('#monitorRows');
    if (host.children.length >= catalog.length) return setMessage(`目前 catalog 只有 ${catalog.length} 個住宿區。`, 'error');
    host.insertAdjacentHTML('beforeend', monitorRow(defaultNewRow()));
    updateCostNote();
  }

  function rowConditions(row) {
    return {
      check_in: row.querySelector('.monitor-in')?.value || '',
      check_out: row.querySelector('.monitor-out')?.value || '',
      adults: Number(row.querySelector('.monitor-adults')?.value || 2),
      max_price_per_night: Number(row.querySelector('.monitor-budget-input')?.value || 6000),
    };
  }

  function setMapsRowMeta(row, text, type = '') {
    const meta = row?.querySelector('.monitor-maps-meta');
    if (!meta) return;
    meta.textContent = text;
    meta.classList.remove('success', 'error');
    if (type) meta.classList.add(type);
  }

  function parseMapsRow(row) {
    if (!row || !MapsUrl) return setMessage('Google Maps URL parser 尚未載入。', 'error');
    const input = row.querySelector('.monitor-maps-input');
    try {
      const parsed = MapsUrl.parse(input?.value || '');
      if (parsed.check_in) row.querySelector('.monitor-in').value = parsed.check_in;
      if (parsed.check_out) row.querySelector('.monitor-out').value = parsed.check_out;
      if (parsed.adults && parsed.adults >= 1 && parsed.adults <= 6) row.querySelector('.monitor-adults').value = String(parsed.adults);
      if (parsed.max_price_per_night && parsed.max_price_per_night >= 500 && parsed.max_price_per_night <= 30000) {
        row.querySelector('.monitor-budget-input').value = String(parsed.max_price_per_night);
      }
      const pieces = ['已解析'];
      if (Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude)) pieces.push(`中心 ${parsed.latitude.toFixed(4)}, ${parsed.longitude.toFixed(4)}`);
      if (parsed.nights) pieces.push(`${parsed.nights} 晚`);
      if (!parsed.exact_checkout_encoded && parsed.check_in) pieces.push('URL 未包含明確晚數，退房日未改');
      setMapsRowMeta(row, pieces.join(' · '), 'success');
      row.querySelector('.monitor-maps-sync').disabled = false;
      updateCostNote();
    } catch (error) {
      setMapsRowMeta(row, error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function syncMapsRow(row) {
    if (!row || !MapsUrl) return;
    const input = row.querySelector('.monitor-maps-input');
    try {
      const result = MapsUrl.sync(input?.value || '', rowConditions(row));
      input.value = result.url;
      const warnings = [];
      if (!result.checkout_synced) warnings.push('退房/晚數無法同步');
      if (!result.adults_synced) warnings.push('人數無法同步');
      if (!result.price_synced) warnings.push('預算無法同步');
      setMapsRowMeta(row, warnings.length ? `已同步可識別欄位 · ${warnings.join(' · ')}` : '已把目前條件同步回 Maps URL', warnings.length ? '' : 'success');
      updateCostNote();
    } catch (error) {
      setMapsRowMeta(row, error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function openMapsRow(row) {
    if (!row) return;
    const input = row.querySelector('.monitor-maps-input');
    const raw = String(input?.value || '').trim();
    let target = raw;
    if (!target && MapsUrl) {
      const selected = catalog.find((watch) => String(watch.id) === String(row.querySelector('.monitor-resort')?.value));
      target = MapsUrl.mapsSearchFallback(`hotels near ${selected?.name || 'Japan ski resort'}`);
    }
    if (target) window.open(target, '_blank', 'noopener');
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
      setMessage(payload.source === 'defaults' ? '目前使用預設 Auto 監控；可貼 Maps URL 建立免費人工參照。' : '已載入自訂設定。', 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function saveSettings() {
    if (!adminToken) return setMessage('請先用 ADMIN_TOKEN 載入設定。', 'error');
    const monitors = readRows();
    const enabled = monitors.filter((row) => row.enabled).length;
    if (enabled > 5) return setMessage('目前 Free 額度策略最多同時啟用 5 個 Auto 監控。', 'error');
    if (monitors.length > catalog.length) return setMessage(`設定列不可超過 ${catalog.length} 個住宿區。`, 'error');
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
      setMessage('已儲存。Maps 參照不耗 SerpApi；只有 Auto=ON 的項目每天 08:20 自動查。', 'success');
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
