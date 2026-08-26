(() => {
  const LABELS = {
    longest_run: '單一最長雪道榜',
    popularity: '人氣 Top 20',
    course_area_current: '面積 Top 20',
    representative_scale: '大型雪場／聯網代表',
  };

  let overlay = {};

  function combinedTags(watch) {
    const tags = new Set([
      ...(Array.isArray(watch?.ranking_tags) ? watch.ranking_tags : []),
      ...(Array.isArray(overlay?.[watch?.id]) ? overlay[watch.id] : []),
    ]);
    return [...tags].filter((tag) => LABELS[tag]);
  }

  function renderRankingBadges() {
    const resultColumn = document.querySelector('.results-column');
    const resultList = document.querySelector('#hotelResults');
    if (!resultColumn || !resultList) return;

    let host = document.querySelector('#rankingBadges');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rankingBadges';
      host.className = 'ranking-badges';
      resultColumn.insertBefore(host, resultList);
    }

    if (state.selectedResort === 'all') {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    const watch = selectedWatches()[0];
    const tags = combinedTags(watch);
    if (!tags.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    host.hidden = false;
    host.innerHTML = `
      <span class="ranking-badges-label">榜單標籤</span>
      ${tags.map((tag) => `<span class="ranking-badge" data-ranking-tag="${escapeHtml(tag)}">${escapeHtml(LABELS[tag])}</span>`).join('')}
    `;
  }

  const previousRenderResults = renderResults;
  renderResults = function rankingAwareRenderResults() {
    previousRenderResults();
    renderRankingBadges();
  };

  async function loadOverlay() {
    try {
      const response = await fetch(`config/ranking-tags-by-id.json?v=${Date.now()}`);
      if (response.ok) overlay = await response.json();
    } catch {
      overlay = {};
    }

    for (let attempt = 0; attempt < 60 && !state?.data; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (state?.data) renderAll();
  }

  loadOverlay();
})();
