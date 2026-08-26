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
    return state.selectedResort === 'all' ? '更新每日監控' : '搜尋此住宿區';
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
    const allWatches = state.data?.watches || [];
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

    const button = document.querySelector('#liveSearchButton');
    if (button && button.dataset.bound !== 'true') {
      button.dataset.bound = 'true';
      button.addEventListener('click', runLiveSearch);
    }
    if (button) button.textContent = searchButtonLabel();

    const selected = selectedWatches()[0]?.name;
    const autoCount = monitoredWatches().length;
    setSearchStatus(state.selectedResort === 'all'
      ? `全部頁只更新 ${autoCount} 個每日監控住宿區，保護免費額度`
      : `只查 ${selected || '目前住宿區'}，一次約用 1 次 SerpApi`);
  }

  function setSearchStatus(message, type = '') {
    const status = document.querySelector('#liveSearchStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.remove('success', 'error');
    if (type) status.classList.add(type);
  }

  async function runLiveSearch() {
    const apiBase = String(window.SNOW_API_BASE || '').replace(/\/$/, '');
    const checkIn = document.querySelector('#liveCheckIn')?.value || draft.checkIn || '';
    const checkOut = document.querySelector('#liveCheckOut')?.value || draft.checkOut || '';
    const adults = Number(document.querySelector('#liveGuests')?.value || draft.adults || 2);
    const budget = Number(document.querySelector('#liveBudget')?.value || draft.budget || 0);
    const button = document.querySelector('#liveSearchButton');
    const resortIds = requestedResortIds();

    draft.checkIn = checkIn;
    draft.checkOut = checkOut;
    draft.adults = adults;
    draft.budget = budget;

    if (!apiBase) return setSearchStatus('Cloudflare API 尚未設定', 'error');
    if (!resortIds.length) return setSearchStatus('目前沒有可查詢的住宿區', 'error');
    if (!checkIn || !checkOut || checkOut <= checkIn) return setSearchStatus('請選有效的入住 / 退房日期', 'error');

    const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
    if (nights < 1 || nights > 14) return setSearchStatus('住宿天數需為 1–14 晚', 'error');
    if (!Number.isInteger(adults) || adults < 1 || adults > 6) return setSearchStatus('旅客人數需為 1–6 人', 'error');
    if (!Number.isFinite(budget) || budget < 500 || budget > 30000) return setSearchStatus('每晚預算需為 NT$500–30,000', 'error');

    if (button) {
      button.disabled = true;
      button.textContent = '搜尋中…';
    }
    setSearchStatus(`正在查 ${resortIds.length} 個住宿區…`);

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
        setSearchStatus(payload.cached ? `${label}：已載入 6 小時快取` : `${label}：已更新即時房價`, 'success');
      }
    } catch (error) {
      setSearchStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      const currentButton = document.querySelector('#liveSearchButton');
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = searchButtonLabel();
      }
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
