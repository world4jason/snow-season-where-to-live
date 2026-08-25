(() => {
  const googleMapsUrl = (row) => {
    const hasCoords = Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude));
    const query = hasCoords
      ? `${Number(row.latitude)},${Number(row.longitude)}`
      : `${row.name || 'Hotel'}, ${row.resortName || 'Japan'}, Japan`;
    const params = new URLSearchParams({
      api: '1',
      query,
      utm_source: 'snow-season-where-to-live',
      utm_campaign: 'place_details_search',
    });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  };

  function decorateGoogleMapsLinks() {
    const rows = new Map(baseHotelRows().map((row) => [row.key, row]));
    document.querySelectorAll('.hotel-card').forEach((card) => {
      if (card.querySelector('.google-maps-link')) return;
      const row = rows.get(card.dataset.hotelKey);
      const priceBox = card.querySelector('.hotel-price');
      if (!row || !priceBox) return;

      const link = document.createElement('a');
      link.className = 'google-maps-link';
      link.href = googleMapsUrl(row);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Google Maps';
      link.setAttribute('aria-label', `${row.name || '住宿'} 在 Google Maps 開啟`);
      priceBox.appendChild(link);
    });
  }

  function currentDateValues() {
    const watches = selectedWatches();
    const first = watches[0];
    if (!first) return { checkIn: '', checkOut: '' };
    const sameIn = watches.every((watch) => watch.check_in === first.check_in);
    const sameOut = watches.every((watch) => watch.check_out === first.check_out);
    return {
      checkIn: sameIn ? first.check_in : '',
      checkOut: sameOut ? first.check_out : '',
    };
  }

  function mountDatePicker() {
    const host = document.querySelector('#searchDates');
    if (!host) return;

    const { checkIn, checkOut } = currentDateValues();
    host.innerHTML = `
      <div class="date-picker-row">
        <input id="liveCheckIn" type="date" value="${escapeHtml(checkIn)}" aria-label="入住日期" />
        <span class="date-arrow">→</span>
        <input id="liveCheckOut" type="date" value="${escapeHtml(checkOut)}" aria-label="退房日期" />
        <button id="liveDateSearch" class="date-search-button" type="button">查詢</button>
      </div>
      <span id="liveDateStatus" class="date-search-status">${state.selectedResort === 'all' ? '會查目前全部雪場' : '會查目前選取雪場'}</span>
    `;

    const checkInInput = document.querySelector('#liveCheckIn');
    const checkOutInput = document.querySelector('#liveCheckOut');
    const searchButton = document.querySelector('#liveDateSearch');
    if (!checkInInput || !checkOutInput || !searchButton) return;

    checkInInput.addEventListener('change', () => {
      if (checkInInput.value && (!checkOutInput.value || checkOutInput.value <= checkInInput.value)) {
        const next = new Date(`${checkInInput.value}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        checkOutInput.value = next.toISOString().slice(0, 10);
      }
    });

    searchButton.addEventListener('click', runLiveDateSearch);
  }

  function setDateStatus(message, isError = false) {
    const status = document.querySelector('#liveDateStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  async function runLiveDateSearch() {
    const checkInInput = document.querySelector('#liveCheckIn');
    const checkOutInput = document.querySelector('#liveCheckOut');
    const button = document.querySelector('#liveDateSearch');
    const apiBase = String(window.SNOW_API_BASE || '').replace(/\/$/, '');
    const checkIn = checkInInput?.value || '';
    const checkOut = checkOutInput?.value || '';

    if (!apiBase) {
      setDateStatus('Cloudflare API 尚未設定', true);
      return;
    }
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setDateStatus('請選有效的入住／退房日期', true);
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = '查詢中…';
    }
    setDateStatus(state.selectedResort === 'all' ? '正在查全部雪場…' : '正在查目前雪場…');

    try {
      const response = await fetch(`${apiBase}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resort_ids: state.selectedResort === 'all' ? 'all' : [state.selectedResort],
          check_in: checkIn,
          check_out: checkOut,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);

      const incoming = payload.watches || [];
      if (!incoming.length) throw new Error('沒有收到雪場資料');

      const byId = new Map((state.data?.watches || []).map((watch) => [watch.id, watch]));
      incoming.forEach((watch) => byId.set(watch.id, watch));
      state.data.watches = Array.from(byId.values());
      state.data.checked_at = payload.checked_at || new Date().toISOString();

      const lastChecked = document.querySelector('#lastChecked');
      if (lastChecked) {
        lastChecked.textContent = new Date(state.data.checked_at).toLocaleString('zh-TW', {
          dateStyle: 'short',
          timeStyle: 'short',
        });
      }

      renderAll();
      setDateStatus(payload.cached ? '已載入快取結果' : '已更新即時結果');
    } catch (error) {
      setDateStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.textContent = '查詢';
      }
    }
  }

  const originalRenderSearchBar = renderSearchBar;
  renderSearchBar = function enhancedRenderSearchBar() {
    originalRenderSearchBar();
    mountDatePicker();
  };

  const originalRenderResults = renderResults;
  renderResults = function enhancedRenderResults() {
    originalRenderResults();
    decorateGoogleMapsLinks();
  };

  let attempts = 0;
  const boot = () => {
    attempts += 1;
    if (state?.data?.watches?.length) {
      renderAll();
      return;
    }
    if (attempts < 50) setTimeout(boot, 100);
  };
  setTimeout(boot, 0);
})();
