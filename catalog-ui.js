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

  const originalRenderResults = renderResults;
  renderResults = function catalogRenderResults() {
    originalRenderResults();

    const watches = selectedWatches();
    const rows = filteredHotelRows();
    const pending = watches.filter((watch) => watch.pending === true);
    const title = document.querySelector('#resultTitle');
    const subtitle = document.querySelector('#resultSubtitle');
    const empty = document.querySelector('#emptyState');

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
    if (!watch?.pending) return;

    if (subtitle) subtitle.textContent = '尚未查詢這個住宿區。選好日期、人數與預算後按「搜尋此住宿區」。';
    if (empty) {
      empty.hidden = false;
      empty.innerHTML = '<h2>尚未查詢</h2><p>這不是「沒有房」；目前還沒有向 Google Hotels 查這個住宿區。</p>';
    }
  };
})();
