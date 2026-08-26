(() => {
  const CONFIG_URL = `config/watches.json?v=${Date.now()}`;
  const draft = {
    checkIn: null,
    checkOut: null,
    adults: null,
    budget: null,
  };

  const googleMapsUrl = (row) => {
    if (row.google_maps_url) return row.google_maps_url;
    const query = `${row.name || 'Hotel'}, ${row.resortName || 'Japan'}, Japan`;
    const params = new URLSearchParams({
      api: '1',
      query,
      utm_source: 'snow-season-where-to-live',
      utm_campaign: 'place_details_search',
    });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  };

  function commonValue(watches, field, fallback = '') {
    const first = watches[0];
    if (!first) return fallback;
    return watches.every((watch) => watch[field] === first[field]) ? first[field] : fallback;
  }

  function syncDraftFromData(force = false) {
    const watches = state.data?.watches || [];
    const first = watches[0];
    if (!first) return;
    if (force || draft.checkIn == null) draft.checkIn = commonValue(watches, 'check_in', first.check_in || '');
    if (force || draft.checkOut == null) draft.checkOut = commonValue(watches, 'check_out', first.check_out || '');
    if (force || draft.adults == null) draft.adults = Number(commonValue(watches, 'adults', first.adults || 2)) || 2;
    if (force || draft.budget == null) draft.budget = Number(commonValue(watches, 'max_price_per_night', first.max_price_per_night || 6000)) || 6000;
  }

  function monitoredWatches() {
    return (state.data?.watches || []).filter((watch) => watch.auto_monitor === true);
  }

  function requestedResortIds() {
    if (state.selectedResort !== 'all') return [state.selectedResort];
    return monitoredWatches().map((watch) => watch.id);
  }

  function searchButtonLabel() {
    return state.selectedResort === 'all'
      ? `搜尋 ${monitoredWatches().length} 個監控區`
      : '搜尋此住宿區';
  }

  function refreshButtonLabel() {
    return state.selectedResort === 'all' ? '選一區刷新' : '強制刷新';
  }

  function decorateHotelCards() {
    const rows = new Map(baseHotelRows().map((row) => [row.key, row]));
    document.querySelectorAll('.hotel-card').forEach((card) => {
      const row = rows.get(card.dataset.hotelKey);
      if (!row) return;

      const kicker = card.querySelector('.hotel-kicker');
      if (kicker && !card.querySelector('.source-badge')) {
        const badge = document.createElement('span');
        badge.className = 'source-badge';
        badge.textContent = 'Google Hotels';
        kicker.appendChild(badge);
      }

      const note = card.querySelector('.hotel-note');
      if (note) note.textContent = '✓ 指定日期有可售價格，且在預算內';

      const priceBox = card.querySelector('.hotel-price');
      if (priceBox && !card.querySelector('.google-maps-link')) {
        const link = document.createElement('a');
        link.className = 'google-maps-link';
        link.href = googleMapsUrl(row);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Google Maps';
        link.setAttribute('aria-label', `${row.name || '住宿'} 在 Google Maps 開啟`);
        priceBox.appendChild(link);
      }
    });
  }

  function renderQueryWarnings() {
    const resultColumn = document.querySelector('.results-column');
    const resultList = document.querySelector('#hotelResults');
    if (!resultColumn || !resultList) return;

    let warning = document.querySelector('#queryWarning');
    if (!warning) {
      warning = document.createElement('div');
      warning.id = 'queryWarning';
      warning.className = 'query-warning';
      resultColumn.insertBefore(warning, resultList);
    }

    const failures = selectedWatches().filter((watch) => watch.error);
    if (!failures.length) {
      warning.hidden = true;
      warning.textContent = '';
      return;
    }

    warning.hidden = false;
    warning.innerHTML = failures.map((watch) => `
      <div><strong>${escapeHtml(watch.name)}</strong><span>${escapeHtml(watch.error)}</span></div>
    `).join('');
  }

  function renderLodgingNote() {
    const resultColumn = document.querySelector('.results-column');
    const resultList = document.querySelector('#hotelResults');
    if (!resultColumn || !resultList) return;

    let note = document.querySelector('#lodgingStrategyNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'lodgingStrategyNote';
      note.className = 'lodging-strategy-note';
      resultColumn.insertBefore(note, resultList);
    }

    const watch = state.selectedResort === 'all' ? null : selectedWatches()[0];
    if (!watch?.lodging_note) {
      note.hidden = true;
      note.textContent = '';
      return;
    }

    note.hidden = false;
    note.innerHTML = `<strong>住宿範圍</strong><span>${escapeHtml(watch.lodging_note)}</span>`;
  }

  function mountDestinationControl() {
    const host = document.querySelector('#searchDestination');
    const allWatches = state.data?.watches || [];
    if (!host) return;

    const fieldLabel = document.querySelector('.search-destination .field-label');
    if (fieldLabel) fieldLabel.textContent = '顯示住宿區';

    host.innerHTML = `
      <select id="liveResortView" class="destination-inline-select" aria-label="顯示住宿區">
        <option value="all" ${state.selectedResort === 'all' ? 'selected' : ''}>全部 ${allWatches.length} 個住宿區</option>
        ${allWatches.map((watch) => {
          const suffix = watch.auto_monitor ? ' · 每日監控' : '';
          return `<option value="${escapeHtml(watch.id)}" ${state.selectedResort === watch.id ? 'selected' : ''}>${escapeHtml(watch.name + suffix)}</option>`;
        }).join('')}
      </select>
    `;

    document.querySelector('#liveResortView')?.addEventListener('change', (event) => {
      state.selectedResort = event.target.value;
      state.activeHotelKey = null;
      renderAll();
    });
  }

  function mountSearchControls() {
    syncDraftFromData();
    const dateHost = document.querySelector('#searchDates');
    const guestHost = document.querySelector('#searchGuests');
    const budgetHost = document.querySelector('#searchBudget');

    if (dateHost) {
      dateHost.innerHTML = `
        <div class="date-picker-row">
          <input id="liveCheckIn" type="date" value="${escapeHtml(draft.checkIn || '')}" aria-label="入住日期" />
          <span class="date-arrow">→</span>
          <input id="liveCheckOut" type="date" value="${escapeHtml(draft.checkOut || '')}" aria-label="退房日期" />
        </div>
      `;
    }

    if (guestHost) {
      guestHost.innerHTML = `
        <select id="liveGuests" class="search-inline-select" aria-label="旅客人數">
          ${[1, 2, 3, 4, 5, 6].map((count) => `<option value="${count}" ${count === draft.adults ? 'selected' : ''}>${count} 人</option>`).join('')}
        </select>
      `;
    }

    if (budgetHost) {
      budgetHost.innerHTML = `
        <input id="liveBudget" class="search-inline-input" type="number" min="500" max="30000" step="250" value="${Number(draft.budget || 6000)}" inputmode="numeric" aria-label="每晚最高預算（新台幣）" />
      `;
    }

    const checkInInput = document.querySelector('#liveCheckIn');
    const checkOutInput = document.querySelector('#liveCheckOut');
    const guestsInput = document.querySelector('#liveGuests');
    const budgetInput = document.querySelector('#liveBudget');

    checkInInput?.addEventListener('change', () => {
      draft.checkIn = checkInInput.value;
      if (checkInInput.value && (!checkOutInput?.value || checkOutInput.value <= checkInInput.value)) {
        const next = new Date(`${checkInInput.value}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        if (checkOutInput) checkOutInput.value = next.toISOString().slice(0, 10);
      }
      draft.checkOut = checkOutInput?.value || draft.checkOut;
    });
    checkOutInput?.addEventListener('change', () => { draft.checkOut = checkOutInput.value; });
    guestsInput?.addEventListener('change', () => { draft.adults = Number(guestsInput.value); });
    budgetInput?.addEventListener('input', () => { draft.budget = Number(budgetInput.value); });

    const searchButton = document.querySelector('#liveSearchButton');
    const refreshButton = document.querySelector('#liveRefreshButton');

    if (searchButton && searchButton.dataset.bound !== 'true') {
      searchButton.dataset.bound = 'true';
      searchButton.addEventListener('click', () => runLiveSearch(false));
    }
    if (refreshButton && refreshButton.dataset.bound !== 'true') {
      refreshButton.dataset.bound = 'true';
      refreshButton.addEventListener('click', () => runLiveSearch(true));
    }

    if (searchButton) searchButton.textContent = searchButtonLabel();
    if (refreshButton) {
      refreshButton.textContent = refreshButtonLabel();
      refreshButton.disabled = state.selectedResort === 'all';
      refreshButton.title = state.selectedResort === 'all'
        ? '為避免一次消耗多筆額度，請先選單一住宿區再強制刷新。'
        : '略過本站 6 小時快取與 SerpApi 1 小時快取，強制取得新結果。';
    }

    const selected = selectedWatches()[0]?.name;
    const autoCount = monitoredWatches().length;
    setSearchStatus(state.selectedResort === 'all'
      ? `搜尋會查 ${autoCount} 個每日監控區；強制刷新請先選單一住宿區。`
      : `${selected || '目前住宿區'}：搜尋優先用快取；強制刷新最多消耗 1 次新查詢。`);
  }

  function setSearchStatus(message, type = '') {
    const status = document.querySelector('#liveSearchStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.remove('success', 'error');
    if (type) status.classList.add(type);
  }

  function setActionBusy(busy, forceRefresh = false) {
    const searchButton = document.querySelector('#liveSearchButton');
    const refreshButton = document.querySelector('#liveRefreshButton');
    if (searchButton) searchButton.disabled = busy;
    if (refreshButton) refreshButton.disabled = busy || state.selectedResort === 'all';
    if (busy) {
      if (forceRefresh && refreshButton) refreshButton.textContent = '刷新中…';
      if (!forceRefresh && searchButton) searchButton.textContent = '搜尋中…';
    }
  }

  async function runLiveSearch(forceRefresh = false) {
    const apiBase = String(window.SNOW_API_BASE || '').replace(/\/$/, '');
    const checkIn = document.querySelector('#liveCheckIn')?.value || draft.checkIn || '';
    const checkOut = document.querySelector('#liveCheckOut')?.value || draft.checkOut || '';
    const adults = Number(document.querySelector('#liveGuests')?.value || draft.adults || 2);
    const budget = Number(document.querySelector('#liveBudget')?.value || draft.budget || 0);
    const resortIds = forceRefresh
      ? (state.selectedResort === 'all' ? [] : [state.selectedResort])
      : requestedResortIds();

    draft.checkIn = checkIn;
    draft.checkOut = checkOut;
    draft.adults = adults;
    draft.budget = budget;

    if (!apiBase) return setSearchStatus('Cloudflare API 尚未設定', 'error');
    if (forceRefresh && state.selectedResort === 'all') return setSearchStatus('強制刷新一次只允許 1 個住宿區，請先選一區。', 'error');
    if (!resortIds.length) return setSearchStatus('目前沒有可查詢的住宿區', 'error');
    if (!checkIn || !checkOut || checkOut <= checkIn) return setSearchStatus('請選有效的入住 / 退房日期', 'error');

    const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
    if (nights < 1 || nights > 14) return setSearchStatus('住宿天數需為 1–14 晚', 'error');
    if (!Number.isInteger(adults) || adults < 1 || adults > 6) return setSearchStatus('旅客人數需為 1–6 人', 'error');
    if (!Number.isFinite(budget) || budget < 500 || budget > 30000) return setSearchStatus('每晚預算需為 NT$500–30,000', 'error');

    setActionBusy(true, forceRefresh);
    setSearchStatus(forceRefresh
      ? '正在略過快取並取得最新房價…'
      : `正在搜尋 ${resortIds.length} 個住宿區（優先使用快取）…`);

    try {
      const response = await fetch(`${apiBase}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resort_ids: resortIds,
          check_in: checkIn,
          check_out: checkOut,
          adults,
          max_price_per_night: budget,
          force_refresh: forceRefresh,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 404) throw new Error('Cloudflare Worker 尚未部署新版，請重新 deploy。');
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      const incoming = payload.watches || [];
      if (!incoming.length) throw new Error('沒有收到住宿區資料');

      const byId = new Map((state.data?.watches || []).map((watch) => [watch.id, watch]));
      incoming.forEach((watch) => byId.set(watch.id, { ...watch, pending: false }));
      state.data.watches = Array.from(byId.values());
      state.data.checked_at = payload.checked_at || new Date().toISOString();
      state.data.source = payload.source || 'manual-search';
      state.filters.priceMax = null;

      const lastChecked = document.querySelector('#lastChecked');
      if (lastChecked) {
        lastChecked.textContent = new Date(state.data.checked_at).toLocaleString('zh-TW', {
          dateStyle: 'short',
          timeStyle: 'short',
        });
      }

      renderAll();
      const failures = incoming.filter((watch) => watch.error);
      if (failures.length) {
        setSearchStatus(`已完成，但 ${failures.length} 個住宿區查詢失敗`, 'error');
      } else {
        const label = incoming.length === 1 ? incoming[0].name : `${incoming.length} 個每日監控住宿區`;
        if (forceRefresh) {
          setSearchStatus(`${label}：已強制刷新最新結果`, 'success');
        } else {
          setSearchStatus(payload.cached ? `${label}：已載入 6 小時快取` : `${label}：已更新搜尋結果`, 'success');
        }
      }
    } catch (error) {
      setSearchStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setActionBusy(false, forceRefresh);
      const searchButton = document.querySelector('#liveSearchButton');
      const refreshButton = document.querySelector('#liveRefreshButton');
      if (searchButton) searchButton.textContent = searchButtonLabel();
      if (refreshButton) refreshButton.textContent = refreshButtonLabel();
    }
  }

  async function hydrateMissingWatches() {
    let config = [];
    try {
      const response = await fetch(CONFIG_URL);
      if (response.ok) config = await response.json();
    } catch {
      return;
    }
    if (!Array.isArray(config) || !config.length) return;

    let attempts = 0;
    while (state.data == null && attempts < 50) {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!state.data) state.data = { checked_at: null, watches: [] };
    const existing = new Map((state.data.watches || []).map((watch) => [watch.id, watch]));
    const ordered = [];

    config.forEach((watch) => {
      const current = existing.get(watch.id);
      if (current) {
        ordered.push({ ...watch, ...current });
      } else {
        ordered.push({
          ...watch,
          nights: Math.max(1, Math.round((Date.parse(`${watch.check_out}T00:00:00Z`) - Date.parse(`${watch.check_in}T00:00:00Z`)) / 86400000)),
          center: null,
          match_count: 0,
          lowest_price: null,
          properties: [],
          error: null,
          pending: true,
        });
      }
    });

    state.data.watches = ordered;
    syncDraftFromData();
    renderAll();
  }

  renderSearchBar = function enhancedRenderSearchBar() {
    mountDestinationControl();
    mountSearchControls();
  };

  const originalRenderResults = renderResults;
  renderResults = function enhancedRenderResults() {
    originalRenderResults();
    decorateHotelCards();
    renderQueryWarnings();
    renderLodgingNote();
  };

  hydrateMissingWatches();
})();
