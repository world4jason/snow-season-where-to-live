const money = (value, currency = 'TWD') => {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('zh-TW', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Number(value).toLocaleString()}`;
  }
};

const dateRange = (start, end) => `${start} → ${end}`;

function hotelCard(hotel, currency) {
  const link = hotel.link ? `<a class="btn" href="${hotel.link}" target="_blank" rel="noopener">查看住宿</a>` : '';
  const rating = hotel.rating ? `<span>★ ${hotel.rating}</span>` : '';
  const source = hotel.source ? `<span>${hotel.source}</span>` : '';
  return `
    <article class="hotel-card">
      <div class="hotel-main">
        <h4>${hotel.name}</h4>
        <div class="meta">${rating}${source}</div>
      </div>
      <div class="price-block">
        <strong>${money(hotel.nightly_price, currency)}</strong>
        <span>/ 晚</span>
      </div>
      ${link}
    </article>`;
}

function watchCard(watch) {
  const currency = watch.currency || 'TWD';
  const hasMatches = watch.match_count > 0;
  const stateClass = watch.error ? 'error' : hasMatches ? 'found' : 'none';
  const stateText = watch.error ? '查詢失敗' : hasMatches ? `找到 ${watch.match_count} 間` : '目前無符合住宿';
  const hotels = (watch.properties || []).slice(0, 5).map(h => hotelCard(h, currency)).join('');

  return `
    <article class="watch-card ${stateClass}">
      <div class="watch-head">
        <div>
          <div class="pill">${stateText}</div>
          <h2>${watch.name}</h2>
          <p>${dateRange(watch.check_in, watch.check_out)} · ${watch.adults || 2} 人 · ${watch.nights || ''} 晚</p>
        </div>
        <div class="budget">
          <span>預算 / 晚</span>
          <strong>${money(watch.max_price_per_night, currency)}</strong>
        </div>
      </div>

      <div class="watch-stats">
        <div><span>最低價</span><strong>${money(watch.lowest_price, currency)}</strong></div>
        <div><span>符合住宿</span><strong>${watch.match_count ?? 0}</strong></div>
        <div><span>搜尋地點</span><strong>${watch.query}</strong></div>
      </div>

      ${watch.error ? `<div class="error-box">${watch.error}</div>` : ''}
      ${hotels ? `<div class="hotel-list">${hotels}</div>` : ''}
    </article>`;
}

async function init() {
  const response = await fetch(`data/latest.json?v=${Date.now()}`);
  const data = await response.json();
  const watches = data.watches || [];

  document.querySelector('#lastChecked').textContent = data.checked_at
    ? new Date(data.checked_at).toLocaleString('zh-TW')
    : '尚未執行';

  if (!watches.length) {
    document.querySelector('#emptyState').hidden = false;
    return;
  }

  const totalMatches = watches.reduce((sum, w) => sum + (w.match_count || 0), 0);
  const foundCount = watches.filter(w => (w.match_count || 0) > 0).length;
  const best = watches.map(w => w.lowest_price).filter(v => v != null).sort((a,b) => a-b)[0];

  document.querySelector('#summary').innerHTML = `
    <div><span>監控條件</span><strong>${watches.length}</strong></div>
    <div><span>目前有房</span><strong>${foundCount}</strong></div>
    <div><span>符合住宿總數</span><strong>${totalMatches}</strong></div>
    <div><span>全站最低價</span><strong>${best ? money(best, watches[0].currency || 'TWD') : '—'}</strong></div>
  `;

  document.querySelector('#watchGrid').innerHTML = watches.map(watchCard).join('');
}

init().catch(err => {
  document.querySelector('#emptyState').hidden = false;
  document.querySelector('#emptyState').innerHTML = `<h2>資料載入失敗</h2><p>${err.message}</p>`;
});
