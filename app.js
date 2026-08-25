const state = {
  data: null,
  selectedResort: 'all',
  sort: 'price',
  filters: {
    priceMax: null,
    minRating: 0,
    maxDistance: null,
    freeCancellation: false,
    breakfastIncluded: false,
    skiInOut: false,
  },
  map: null,
  markerLayer: null,
  centerLayer: null,
  markers: new Map(),
  activeHotelKey: null,
};

const $ = (selector) => document.querySelector(selector);

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const safeUrl = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

const money = (value, currency = 'TWD') => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  try {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toLocaleString('zh-TW')}`;
  }
};

const compactMoney = (value, currency = 'TWD') => {
  if (value == null) return '—';
  const symbols = { TWD: 'NT$', JPY: '¥', USD: '$' };
  return `${symbols[currency] || `${currency} `}${Math.round(Number(value)).toLocaleString('zh-TW')}`;
};

const shortDate = (dateString) => {
  if (!dateString) return '—';
  const [year, month, day] = dateString.split('-').map(Number);
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
};

const hasNumber = (value) => Number.isFinite(Number(value));

function selectedWatches() {
  const watches = state.data?.watches || [];
  if (state.selectedResort === 'all') return watches;
  return watches.filter((watch) => watch.id === state.selectedResort);
}

function baseHotelRows() {
  const rows = [];
  selectedWatches().forEach((watch) => {
    (watch.properties || []).forEach((hotel, index) => {
      rows.push({
        ...hotel,
        key: `${watch.id}:${index}`,
        watchId: watch.id,
        resortName: watch.name,
        currency: watch.currency || 'TWD',
        nights: watch.nights || 1,
        budget: watch.max_price_per_night,
        center: watch.center || null,
      });
    });
  });
  return rows;
}

function maxBudgetForSelection() {
  const values = selectedWatches()
    .map((watch) => Number(watch.max_price_per_night))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 6000;
}

function tagAvailable(rows, key) {
  return rows.some((row) => row.tags?.[key] === true);
}

function normalizeFilters() {
  const rows = baseHotelRows();
  const maxBudget = maxBudgetForSelection();

  if (state.filters.priceMax != null) {
    state.filters.priceMax = Math.min(Number(state.filters.priceMax), maxBudget);
  }
  if (!tagAvailable(rows, 'free_cancellation')) state.filters.freeCancellation = false;
  if (!tagAvailable(rows, 'breakfast_included')) state.filters.breakfastIncluded = false;
  if (!tagAvailable(rows, 'ski_in_out')) state.filters.skiInOut = false;
}

function filteredHotelRows() {
  const priceCap = state.filters.priceMax ?? Infinity;
  const rows = baseHotelRows().filter((row) => {
    if (hasNumber(row.nightly_price) && Number(row.nightly_price) > priceCap) return false;
    if (state.filters.minRating > 0 && Number(row.rating || 0) < state.filters.minRating) return false;
    if (state.filters.maxDistance != null) {
      if (!hasNumber(row.distance_to_center_km)) return false;
      if (Number(row.distance_to_center_km) > state.filters.maxDistance) return false;
    }
    if (state.filters.freeCancellation && row.tags?.free_cancellation !== true) return false;
    if (state.filters.breakfastIncluded && row.tags?.breakfast_included !== true) return false;
    if (state.filters.skiInOut && row.tags?.ski_in_out !== true) return false;
    return true;
  });

  rows.sort((a, b) => {
    if (state.sort === 'rating') {
      const ratingDelta = (Number(b.rating) || 0) - (Number(a.rating) || 0);
      if (ratingDelta !== 0) return ratingDelta;
    }
    if (state.sort === 'distance') {
      const aDistance = hasNumber(a.distance_to_center_km) ? Number(a.distance_to_center_km) : Infinity;
      const bDistance = hasNumber(b.distance_to_center_km) ? Number(b.distance_to_center_km) : Infinity;
      const distanceDelta = aDistance - bDistance;
      if (distanceDelta !== 0) return distanceDelta;
    }
    return (Number(a.nightly_price) || Infinity) - (Number(b.nightly_price) || Infinity);
  });

  return rows;
}

function renderTabs() {
  const watches = state.data?.watches || [];
  const tabs = [
    { id: 'all', name: '全部雪場' },
    ...watches.map((watch) => ({ id: watch.id, name: watch.name })),
  ];

  $('#resortTabs').innerHTML = tabs.map((tab) => `
    <button
      class="resort-tab ${state.selectedResort === tab.id ? 'active' : ''}"
      type="button"
      data-resort="${escapeHtml(tab.id)}"
      aria-pressed="${state.selectedResort === tab.id ? 'true' : 'false'}"
    >${escapeHtml(tab.name)}</button>
  `).join('');
}

function renderSearchBar() {
  const watches = selectedWatches();
  const first = watches[0];
  const allSame = (field) => watches.length && watches.every((watch) => watch[field] === first[field]);

  $('#searchDestination').textContent = state.selectedResort === 'all'
    ? `全部 ${watches.length} 個雪場`
    : first?.name || '—';

  $('#searchDates').textContent = !first
    ? '—'
    : allSame('check_in') && allSame('check_out')
      ? `${shortDate(first.check_in)} → ${shortDate(first.check_out)}`
      : '依各雪場條件';

  $('#searchGuests').textContent = !first
    ? '—'
    : allSame('adults')
      ? `${first.adults || 2} 人`
      : '依各雪場條件';

  $('#searchBudget').textContent = !first
    ? '—'
    : allSame('max_price_per_night') && allSame('currency')
      ? `${money(first.max_price_per_night, first.currency || 'TWD')} 以下`
      : '依各雪場預算';
}

function setAmenityControl(inputId, rowId, available, checked) {
  const input = $(inputId);
  const row = $(rowId);
  input.disabled = !available;
  input.checked = available && checked;
  row.classList.toggle('unavailable', !available);
}

function renderFilterControls() {
  const rows = baseHotelRows();
  const watches = selectedWatches();
  const first = watches[0];
  const currency = first?.currency || 'TWD';
  const maxBudget = maxBudgetForSelection();
  const priceValue = state.filters.priceMax ?? maxBudget;
  const slider = $('#priceFilter');

  slider.max = String(Math.max(250, Math.ceil(maxBudget / 250) * 250));
  slider.value = String(Math.min(priceValue, Number(slider.max)));
  slider.disabled = rows.length === 0;
  $('#priceFilterValue').textContent = `${money(Number(slider.value), currency)} 以下`;

  $('#ratingFilter').value = String(state.filters.minRating);
  $('#distanceFilter').value = state.filters.maxDistance == null ? '' : String(state.filters.maxDistance);

  setAmenityControl('#freeCancellationFilter', '#freeCancellationRow', tagAvailable(rows, 'free_cancellation'), state.filters.freeCancellation);
  setAmenityControl('#breakfastFilter', '#breakfastRow', tagAvailable(rows, 'breakfast_included'), state.filters.breakfastIncluded);
  setAmenityControl('#skiInOutFilter', '#skiInOutRow', tagAvailable(rows, 'ski_in_out'), state.filters.skiInOut);
}

function renderSummary() {
  const watches = selectedWatches();
  const rows = filteredHotelRows();
  const baseRows = baseHotelRows();
  const foundResorts = new Set(rows.map((row) => row.watchId)).size;
  const best = rows.length
    ? rows.reduce((current, row) => (
      Number(row.nightly_price) < Number(current.nightly_price) ? row : current
    ), rows[0])
    : null;

  $('#summary').innerHTML = `
    <div><span>比較雪場</span><strong>${watches.length}</strong></div>
    <div><span>篩選後有住宿</span><strong>${foundResorts} / ${watches.length}</strong></div>
    <div><span>顯示住宿</span><strong>${rows.length} / ${baseRows.length}</strong></div>
    <div><span>目前最低每晚</span><strong>${best ? money(best.nightly_price, best.currency) : '—'}</strong></div>
  `;
}

function tagChip(text, className = '') {
  return `<span class="feature-chip ${className}">${escapeHtml(text)}</span>`;
}

function hotelCard(row) {
  const image = safeUrl(row.thumbnail);
  const link = safeUrl(row.link);
  const total = row.total_price ?? (row.nightly_price != null ? Number(row.nightly_price) * Number(row.nights || 1) : null);
  const rating = row.rating != null
    ? `<span class="rating-good">★ ${escapeHtml(row.rating)}</span>`
    : '<span>尚無評分</span>';
  const reviews = row.reviews != null ? `<span>${Number(row.reviews).toLocaleString('zh-TW')} 則評價</span>` : '';
  const hotelClass = row.hotel_class ? `<span>${escapeHtml(row.hotel_class)}</span>` : '';
  const source = row.source ? `<span class="source-badge">${escapeHtml(row.source)}</span>` : '';
  const propertyType = row.property_type ? `<span>${escapeHtml(row.property_type)}</span>` : '';
  const distance = hasNumber(row.distance_to_center_km)
    ? `<span class="distance-badge">距搜尋中心 ${Number(row.distance_to_center_km).toFixed(1)} km</span>`
    : '';

  const featureChips = [
    row.tags?.free_cancellation ? tagChip('免費取消', 'good') : '',
    row.tags?.breakfast_included ? tagChip('含早餐', 'good') : '',
    row.tags?.ski_in_out ? tagChip('Ski-in / Ski-out', 'ski') : '',
  ].filter(Boolean).join('');

  const photo = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(row.name)}" loading="lazy" referrerpolicy="no-referrer" />`
    : '<div class="photo-fallback" aria-label="沒有住宿照片">⌂</div>';
  const action = link
    ? `<a class="hotel-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">查看住宿</a>`
    : '';

  return `
    <article class="hotel-card" tabindex="0" data-hotel-key="${escapeHtml(row.key)}">
      <div class="hotel-photo">${photo}</div>
      <div class="hotel-info">
        <div class="hotel-kicker">
          <span class="resort-badge">${escapeHtml(row.resortName)}</span>
          ${source}
        </div>
        <h3>${escapeHtml(row.name || '未命名住宿')}</h3>
        <div class="hotel-meta">
          ${rating}
          ${reviews}
          ${hotelClass}
          ${propertyType}
        </div>
        <div class="distance-row">${distance}</div>
        ${featureChips ? `<div class="feature-chips">${featureChips}</div>` : ''}
        <span class="hotel-note">✓ 在你的每晚預算內</span>
      </div>
      <div class="hotel-price">
        <span class="price-label">每晚最低</span>
        <strong class="nightly-price">${money(row.nightly_price, row.currency)}</strong>
        <span class="total-price">${row.nights || 1} 晚約 ${money(total, row.currency)}</span>
        ${action}
      </div>
    </article>
  `;
}

function renderResults() {
  const watches = selectedWatches();
  const rows = filteredHotelRows();
  const baseRows = baseHotelRows();
  const isAll = state.selectedResort === 'all';
  const title = isAll ? `${watches.length} 個雪場住宿` : watches[0]?.name || '住宿搜尋結果';

  $('#resultTitle').textContent = title;
  $('#resultSubtitle').textContent = rows.length
    ? `顯示 ${rows.length} / ${baseRows.length} 間住宿；點卡片或地圖價格可互相定位。`
    : baseRows.length
      ? `原本有 ${baseRows.length} 間住宿，但沒有符合目前篩選。`
      : '目前沒有符合預算的住宿。';

  $('#hotelResults').innerHTML = rows.map(hotelCard).join('');
  $('#emptyState').hidden = rows.length > 0;

  document.querySelectorAll('.hotel-card').forEach((card) => {
    const activate = () => activateHotel(card.dataset.hotelKey, true);
    card.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      activate();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
    card.addEventListener('mouseenter', () => activateHotel(card.dataset.hotelKey, false));
  });

  renderMap(rows);
}

function createMap() {
  if (state.map || typeof L === 'undefined') return;
  state.map = L.map('map', { zoomControl: true, scrollWheelZoom: true }).setView([37.4, 138.6], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);
  state.centerLayer = L.layerGroup().addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
}

function priceIcon(row, active = false) {
  return L.divIcon({
    className: 'price-marker-wrapper',
    html: `<div class="price-marker ${active ? 'is-active' : ''}">${escapeHtml(compactMoney(row.nightly_price, row.currency))}</div>`,
    iconSize: [78, 34],
    iconAnchor: [39, 17],
  });
}

function resortIcon() {
  return L.divIcon({
    className: 'resort-marker-wrapper',
    html: '<div class="resort-marker">⛷</div>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function renderMap(rows) {
  createMap();
  state.markers.clear();
  state.activeHotelKey = null;

  if (!state.map || !state.markerLayer || !state.centerLayer) {
    $('#mapEmpty').hidden = false;
    return;
  }

  state.markerLayer.clearLayers();
  state.centerLayer.clearLayers();

  const located = rows.filter((row) => hasNumber(row.latitude) && hasNumber(row.longitude));
  const centeredWatches = selectedWatches().filter((watch) => (
    hasNumber(watch.center?.latitude) && hasNumber(watch.center?.longitude)
  ));
  $('#mapEmpty').hidden = located.length > 0 || centeredWatches.length > 0;

  const bounds = [];

  centeredWatches.forEach((watch) => {
    const latlng = [Number(watch.center.latitude), Number(watch.center.longitude)];
    bounds.push(latlng);
    const marker = L.marker(latlng, { icon: resortIcon(), zIndexOffset: 1000 }).addTo(state.centerLayer);
    marker.bindTooltip(escapeHtml(watch.name), {
      permanent: true,
      direction: 'top',
      className: 'resort-tooltip',
      offset: [0, -11],
    });
    marker.bindPopup(`
      <div class="hotel-popup">
        <strong>${escapeHtml(watch.name)}</strong>
        <span>搜尋中心 · ${escapeHtml(watch.center.display_name || watch.query || '')}</span>
        <small>住宿距離為直線距離</small>
      </div>
    `);
  });

  located.forEach((row) => {
    const latlng = [Number(row.latitude), Number(row.longitude)];
    bounds.push(latlng);
    const marker = L.marker(latlng, { icon: priceIcon(row) }).addTo(state.markerLayer);
    const distanceText = hasNumber(row.distance_to_center_km)
      ? ` · ${Number(row.distance_to_center_km).toFixed(1)} km`
      : '';
    marker.bindPopup(`
      <div class="hotel-popup">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${escapeHtml(row.resortName)} · ${escapeHtml(money(row.nightly_price, row.currency))}/晚${escapeHtml(distanceText)}</span>
      </div>
    `);
    marker.on('click', () => activateHotel(row.key, true, true));
    state.markers.set(row.key, { marker, row });
  });

  if (!bounds.length) return;
  if (bounds.length === 1) {
    state.map.setView(bounds[0], 13);
  } else {
    state.map.fitBounds(bounds, { padding: [44, 44], maxZoom: 13 });
  }
  setTimeout(() => state.map.invalidateSize(), 0);
}

function activateHotel(key, shouldCenter = false, fromMarker = false) {
  if (!key) return;
  state.activeHotelKey = key;

  document.querySelectorAll('.hotel-card').forEach((card) => {
    card.classList.toggle('selected', card.dataset.hotelKey === key);
  });

  state.markers.forEach(({ marker, row }, markerKey) => {
    marker.setIcon(priceIcon(row, markerKey === key));
  });

  const markerInfo = state.markers.get(key);
  if (markerInfo && shouldCenter && state.map) {
    state.map.panTo(markerInfo.marker.getLatLng(), { animate: true });
    if (!fromMarker) markerInfo.marker.openPopup();
  }

  if (fromMarker) {
    const card = document.querySelector(`[data-hotel-key="${CSS.escape(key)}"]`);
    if (card && window.innerWidth > 820) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function renderAll() {
  normalizeFilters();
  renderTabs();
  renderSearchBar();
  renderFilterControls();
  renderSummary();
  renderResults();
}

function resetFilters() {
  state.filters = {
    priceMax: null,
    minRating: 0,
    maxDistance: null,
    freeCancellation: false,
    breakfastIncluded: false,
    skiInOut: false,
  };
  renderAll();
}

function bindControls() {
  $('#resortTabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-resort]');
    if (!button) return;
    state.selectedResort = button.dataset.resort;
    state.activeHotelKey = null;
    renderAll();
  });

  $('#sortSelect').addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderResults();
  });

  $('#priceFilter').addEventListener('input', (event) => {
    state.filters.priceMax = Number(event.target.value);
    renderAll();
  });

  $('#ratingFilter').addEventListener('change', (event) => {
    state.filters.minRating = Number(event.target.value) || 0;
    renderAll();
  });

  $('#distanceFilter').addEventListener('change', (event) => {
    state.filters.maxDistance = event.target.value === '' ? null : Number(event.target.value);
    renderAll();
  });

  $('#freeCancellationFilter').addEventListener('change', (event) => {
    state.filters.freeCancellation = event.target.checked;
    renderAll();
  });

  $('#breakfastFilter').addEventListener('change', (event) => {
    state.filters.breakfastIncluded = event.target.checked;
    renderAll();
  });

  $('#skiInOutFilter').addEventListener('change', (event) => {
    state.filters.skiInOut = event.target.checked;
    renderAll();
  });

  $('#resetFilters').addEventListener('click', resetFilters);

  $('#mapToggle').addEventListener('click', () => {
    const layout = $('#bookingLayout');
    const showingMap = layout.classList.toggle('show-map');
    $('#mapToggle').textContent = showingMap ? '住宿清單' : '地圖';
    $('#mapToggle').setAttribute('aria-pressed', showingMap ? 'true' : 'false');
    if (showingMap && state.map) setTimeout(() => state.map.invalidateSize(), 20);
  });
}

async function init() {
  bindControls();
  const response = await fetch(`data/latest.json?v=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  state.data = await response.json();

  $('#lastChecked').textContent = state.data.checked_at
    ? new Date(state.data.checked_at).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })
    : '尚未執行';

  const watches = state.data.watches || [];
  if (!watches.length) {
    $('#resultSubtitle').textContent = '尚未有搜尋資料。請先從 GitHub Actions 執行一次 Check ski stays。';
    $('#emptyState').hidden = false;
    $('#mapEmpty').hidden = false;
    return;
  }

  renderAll();
}

init().catch((error) => {
  $('#resultSubtitle').textContent = '資料載入失敗。';
  $('#emptyState').hidden = false;
  $('#emptyState').innerHTML = `<h2>資料載入失敗</h2><p>${escapeHtml(error.message)}</p>`;
  $('#mapEmpty').hidden = false;
});
