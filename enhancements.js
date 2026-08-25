(() => {
  const CONFIG_URL = `config/watches.json?v=${Date.now()}`;

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

  function commonValue(watches, field, fallback = '') {
    const first = watches[0];
    if (!first) return fallback;
    return watches.every((watch) => watch[field] === first[field]) ? first[field] : fallback;
  }

  function mountDestinationControl() {
    const host = document.querySelector('#searchDestination');
    const allWatches = state.data?.watches || [];
    if (!host) return;

    const fieldLabel = document.querySelector('.search-destination .field-label');
    if (fieldLabel) fieldLabel.textContent = '顯示雪場';

    host.innerHTML = `
      <select id="liveResortView" class="destination-inline-select" aria-label="顯示雪場">
        <option value="all" ${state.selectedResort === 'all' ? 'selected' : ''}>全部 ${allWatches.length} 個雪場</option>
        ${allWatches.map((watch) => `<option value="${escapeHtml(watch.id)}" ${state.selectedResort === watch.id ? 'selected' : ''}>${escapeHtml(watch.name)}</option>`).join('')}
      </select>
    `;

    const select = document.querySelector('#liveResortView');
    if (select) {
      select.addEventListener('change', () => {
        state.selectedResort = select.value;
        state.activeHotelKey = null;
        renderAll();
      });
    }
  }

  function mountSearchControls() {
    const allWatches = state.data?.watches || [];
    const first = allWatches[0];
    const checkIn = commonValue(allWatches, 'check_in', first?.check_in || '');
    const checkOut = commonValue(allWatches, 'check_out', first?.check_out || '');
    const adults = Number(commonValue(allWatches, 'adults', first?.adults || 2)) || 2;
    const budget = Number(commonValue(allWatches, 'max_price_per_night', first?.max_price_per_night || 6000)) || 6000;

    const dateHost = document.querySelector('#searchDates');
    const guestHost = document.querySelector('#searchGuests');
    const budgetHost = document.querySelector('#searchBudget');

    if (dateHost) {
      dateHost.innerHTML = `
        <div class="date-picker-row">
          <input id="liveCheckIn" type="date" value="${escapeHtml(checkIn)}" aria-label="入住日期" />
          <span class="date-arrow">→</span>
          <input id="liveCheckOut" type="date" value="${escapeHtml(checkOut)}" aria-label="退房日期" />
        </div>
      `;
    }

    if (guestHost) {
      guestHost.innerHTML = `
        <select id="liveGuests" class="search-inline-select" aria-label="旅客人數">
          ${[1, 2, 3, 4, 5, 6].map((count) => `<option value="${count}" ${count === adults ? 'selected' : ''}>${count} 人</option>`).join('')}
        </select>
      `;
    }

    if (budgetHost) {
      budgetHost.innerHTML = `
        <div class="budget-input-wrap">
          <span class="budget-prefix">NT$</span>
          <input id="liveBudget" class="search-inline-input" type="number" min="500" max="30000" step="250" value="${budget}" inputmode="numeric" aria-label="每晚最高預算" />
        </div>
      `;
    }

    const checkInInput = document.querySelector('#liveCheckIn');
    const checkOutInput = document.querySelector('#liveCheckOut');
    if (checkInInput && checkOutInput) {
      checkInInput.addEventListener('change', () => {
        if (checkInInput.value && (!checkOutInput.value || checkOutInput.value <= checkInInput.value)) {
          const next = new Date(`${checkInInput.value}T00:00:00Z`);
          next.setUTCDate(next.getUTCDate() + 1);
          checkOutInput.value = next.toISOString().slice(0, 10);
        }
      });
    }

    const button = document.querySelector('#liveSearchButton');
    if (button && button.dataset.bound !== 'true') {
      button.dataset.bound = 'true';
      button.addEventListener('click', runLiveSearch);
    }

    const selected = selectedWatches()[0]?.name;
    setSearchStatus(state.selectedResort === 'all'
      ? `搜尋全部 ${allWatches.length} 個雪場`
      : `搜尋會更新全部 ${allWatches.length} 個雪場；目前顯示 ${selected || '所選雪場'}`);
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
    const checkIn = document.querySelector('#liveCheckIn')?.value || '';
    const checkOut = document.querySelector('#liveCheckOut')?.value || '';
    const adults = Number(document.querySelector('#liveGuests')?.value || 2);
    const budget = Number(document.querySelector('#liveBudget')?.value || 0);
    const button = document.querySelector('#liveSearchButton');

    if (!apiBase) {
      setSearchStatus('Cloudflare API 尚未設定', 'error');
      return;
    }
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setSearchStatus('請選有效的入住 / 退房日期', 'error');
      return;
    }
    const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
    if (nights < 1 || nights > 14) {
      setSearchStatus('住宿天數需為 1–14 晚', 'error');
      return;
    }
    if (!Number.isInteger(adults) || adults < 1 || adults > 6) {
      setSearchStatus('旅客人數需為 1–6 人', 'error');
      return;
    }
    if (!Number.isFinite(budget) || budget < 500 || budget > 30000) {
      setSearchStatus('每晚預算需為 NT$500–30,000', 'error');
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = '搜尋中…';
    }
    setSearchStatus(`正在更新全部 ${state.data?.watches?.length || 5} 個雪場…`);

    try {
      const response = await fetch(`${apiBase}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resort_ids: 'all',
          check_in: checkIn,
          check_out: checkOut,
          adults,
          max_price_per_night: budget,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);

      const incoming = payload.watches || [];
      if (!incoming.length) throw new Error('沒有收到雪場資料');

      state.data.watches = incoming;
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
      setSearchStatus(payload.cached ? '已載入 6 小時快取結果' : '已更新五個雪場即時房價', 'success');
    } catch (error) {
      setSearchStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      const currentButton = document.querySelector('#liveSearchButton');
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = '搜尋房間';
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
    config.forEach((watch) => {
      if (!existing.has(watch.id)) {
        existing.set(watch.id, {
          ...watch,
          nights: Math.max(1, Math.round((Date.parse(`${watch.check_out}T00:00:00Z`) - Date.parse(`${watch.check_in}T00:00:00Z`)) / 86400000)),
          center: null,
          match_count: 0,
          lowest_price: null,
          properties: [],
          error: null,
        });
      }
    });
    state.data.watches = Array.from(existing.values());
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
  };

  hydrateMissingWatches();
})();
