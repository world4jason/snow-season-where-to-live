(() => {
  const originalRenderTabs = renderTabs;
  renderTabs = function catalogRenderTabs() {
    originalRenderTabs();
    const allButton = document.querySelector('#resortTabs [data-resort="all"]');
    if (allButton) allButton.textContent = '全部住宿區';
  };

  const originalRenderSummary = renderSummary;
  renderSummary = function catalogRenderSummary() {
    originalRenderSummary();
    const cards = document.querySelectorAll('#summary > div');
    const firstLabel = cards[0]?.querySelector('span');
    if (firstLabel) firstLabel.textContent = '住宿區';
  };

  function mapsSearchUrl(watch) {
    const query = `hotels near ${watch?.center_query || watch?.query || watch?.name || 'Japan ski resort'}`;
    const params = new URLSearchParams({ api: '1', query });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  function referenceRows(watch) {
    return (Array.isArray(watch?.over_budget_properties) ? watch.over_budget_properties : [])
      .filter((row) => row?.nightly_price != null)
      .sort((a, b) => Number(a.nightly_price) - Number(b.nightly_price))
      .slice(0, 5);
  }

  function renderBudgetReference(watch, empty) {
    const currency = watch?.currency || 'TWD';
    const budget = Number(watch?.max_price_per_night || 0);
    const refs = referenceRows(watch);
    const mapsUrl = mapsSearchUrl(watch);

    empty.hidden = false;
    empty.classList.add('budget-empty-state');
    empty.innerHTML = `
      <h2>每晚 ${escapeHtml(money(budget, currency))} 內目前 0 間</h2>
      <p>Google Hotels 這次沒有回傳符合「每晚預算」的住宿。這不等於整個 ${escapeHtml(watch?.name || '住宿區')} 沒房。</p>
      ${refs.length ? `
        <div class="budget-reference-list">
          <strong>高於預算的參考住宿</strong>
          ${refs.map((row) => `
            <div class="budget-reference-row">
              <span>${escapeHtml(row.name || '住宿')}</span>
              <b>${escapeHtml(money(row.nightly_price, currency))} / 晚</b>
              <a href="${escapeHtml(row.google_maps_url || mapsUrl)}" target="_blank" rel="noopener">Google Maps</a>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="budget-empty-actions">
        <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener">Google Maps 查看附近住宿</a>
      </div>
      <small>Maps 僅用來參考住宿位置；日期、房價與可售狀態仍以 Google Hotels 搜尋結果為準。</small>
    `;
  }

  const originalRenderResults = renderResults;
  renderResults = function catalogRenderResults() {
    originalRenderResults();

    const watches = selectedWatches();
    const rows = filteredHotelRows();
    const pending = watches.filter((watch) => watch.pending === true);
    const title = document.querySelector('#resultTitle');
    const subtitle = document.querySelector('#resultSubtitle');
    const empty = document.querySelector('#emptyState');

    if (empty) empty.classList.remove('budget-empty-state');

    if (state.selectedResort === 'all') {
      if (title) title.textContent = `${watches.length} 個住宿區`;
      if (subtitle && pending.length) {
        subtitle.textContent = rows.length
          ? `目前顯示 ${rows.length} 間已查詢住宿；另有 ${pending.length} 個住宿區尚未查詢，請選取後即時搜尋。`
          : `目前有 ${pending.length} 個住宿區尚未查詢；請先選一個住宿區再搜尋。`;
      }
      return;
    }

    const watch = watches[0];
    if (!watch) return;

    // A returned/search-completed watch must not be described as "never searched" merely because
    // an older catalog placeholder left pending=true in the browser state.
    const searchStatus = String(watch.search_status || '');
    const hasSearchEvidence = watch.pending === false
      || searchStatus.length > 0
      || Array.isArray(watch.over_budget_properties)
      || Number(watch.match_count || 0) > 0
      || (Array.isArray(watch.properties) && watch.properties.length > 0);

    if (watch.pending === true && !hasSearchEvidence) {
      if (subtitle) subtitle.textContent = '尚未查詢這個住宿區。選好日期、人數與每晚預算後按「搜尋此住宿區」。';
      if (empty) {
        empty.hidden = false;
        empty.innerHTML = '<h2>尚未查詢</h2><p>這不是「沒有房」；目前還沒有向 Google Hotels 查這個住宿區。</p>';
      }
      return;
    }

    if (!rows.length && !(watch.error)) {
      if (subtitle) {
        subtitle.textContent = `已查詢：每晚 ${money(watch.max_price_per_night, watch.currency || 'TWD')} 內目前沒有回傳符合條件的住宿。`;
      }
      if (empty) renderBudgetReference(watch, empty);
    }
  };
})();
