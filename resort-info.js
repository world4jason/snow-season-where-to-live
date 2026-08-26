(() => {
  const PROFILE_URL = `config/resort-profiles.json?v=${Date.now()}`;
  const TAG_URL = `config/ranking-tags-by-id.json?v=${Date.now()}`;
  const TRAIL_MAP_URL = `config/trail-map-links.json?v=${Date.now()}`;
  const TAG_LABELS = {
    longest_run: '最長雪道',
    popularity: '人氣 Top 20',
    course_area_current: '面積 Top 20',
    course_area: '面積 Top 20',
    representative_scale: '大型雪區',
  };

  let profiles = {};
  let tagOverlay = {};
  let trailMaps = {};
  let mode = 'booking';
  let infoMap = null;
  let infoMarker = null;
  const geocodeCache = new Map();

  function googleMapsUrl(query) {
    const params = new URLSearchParams({ api: '1', query });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  function googleTransitUrl(name) {
    const query = `${name} ski resort access train bus 交通`;
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }

  function currentWatch() {
    if (state.selectedResort === 'all') return null;
    return (state.data?.watches || []).find((watch) => watch.id === state.selectedResort) || null;
  }

  function searchCurrentConditions() {
    mode = 'booking';
    applyMode();
    requestAnimationFrame(() => {
      document.querySelector('#liveSearchButton')?.click();
    });
  }

  function tagsFor(watch) {
    if (!watch) return [];
    const values = new Set([
      ...(Array.isArray(watch.ranking_tags) ? watch.ranking_tags : []),
      ...(Array.isArray(tagOverlay[watch.id]) ? tagOverlay[watch.id] : []),
    ].map((tag) => tag === 'course_area' ? 'course_area_current' : tag));
    return [...values].filter((tag) => TAG_LABELS[tag]);
  }

  function ensureShell() {
    let tabs = document.querySelector('#contentModeTabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.id = 'contentModeTabs';
      tabs.className = 'content-mode-tabs';
      tabs.innerHTML = `
        <button type="button" data-content-mode="booking" class="active">住宿</button>
        <button type="button" data-content-mode="resort">雪場簡介</button>
      `;
      const summary = document.querySelector('#summary');
      summary?.parentNode?.insertBefore(tabs, summary);
      tabs.addEventListener('click', (event) => {
        const button = event.target.closest('[data-content-mode]');
        if (!button) return;
        mode = button.dataset.contentMode;
        applyMode();
      });
    }

    let panel = document.querySelector('#resortInfoPanel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'resortInfoPanel';
      panel.className = 'resort-info-panel';
      panel.hidden = true;
      tabs.insertAdjacentElement('afterend', panel);
    }
    return panel;
  }

  function applyMode() {
    ensureShell();
    document.body.classList.toggle('resort-info-mode', mode === 'resort');
    document.querySelectorAll('#contentModeTabs [data-content-mode]').forEach((button) => {
      const active = button.dataset.contentMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const panel = document.querySelector('#resortInfoPanel');
    if (panel) panel.hidden = mode !== 'resort';
    if (mode === 'resort') renderResortInfo();
  }

  async function geocode(query) {
    if (!query) return null;
    if (geocodeCache.has(query)) return geocodeCache.get(query);
    const promise = fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, {
      headers: { 'Accept-Language': 'ja,en' },
    }).then(async (response) => {
      if (!response.ok) return null;
      const rows = await response.json();
      const first = rows?.[0];
      if (!first) return null;
      return { latitude: Number(first.lat), longitude: Number(first.lon) };
    }).catch(() => null);
    geocodeCache.set(query, promise);
    return promise;
  }

  function coordinatesFromWatch(watch) {
    const lat = Number(watch?.center?.latitude);
    const lon = Number(watch?.center?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { latitude: lat, longitude: lon };
    return null;
  }

  function mapZoomFor(watch) {
    const configured = Number(trailMaps?.[watch?.id]?.zoom);
    if (Number.isFinite(configured)) return configured;
    const coverCount = Array.isArray(watch?.covers) ? watch.covers.length : 1;
    if (coverCount >= 5) return 11;
    if (coverCount >= 3) return 12;
    return 13;
  }

  async function renderTrailMap(watch) {
    const host = document.querySelector('#resortInfoMap');
    if (!host || mode !== 'resort' || !watch) return;
    const query = watch.center_query || watch.query || watch.name;
    const coords = coordinatesFromWatch(watch) || await geocode(query);
    if (!host.isConnected || mode !== 'resort' || currentWatch()?.id !== watch.id) return;

    if (!coords || typeof L === 'undefined') {
      host.innerHTML = `
        <div class="resort-map-fallback">
          <strong>雪道圖座標尚未取得</strong>
          <a href="${escapeHtml(googleMapsUrl(query))}" target="_blank" rel="noopener">Google Maps 開啟位置</a>
        </div>`;
      return;
    }

    if (infoMap) {
      infoMap.remove();
      infoMap = null;
      infoMarker = null;
    }
    host.innerHTML = '';
    infoMap = L.map(host, { scrollWheelZoom: false, zoomControl: true }).setView(
      [coords.latitude, coords.longitude],
      mapZoomFor(watch),
    );

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      opacity: 0.62,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(infoMap);

    L.tileLayer('https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png', {
      maxZoom: 18,
      opacity: 0.92,
      attribution: 'Ski pistes &copy; OpenSnowMap / OpenStreetMap contributors',
    }).addTo(infoMap);

    infoMarker = L.circleMarker([coords.latitude, coords.longitude], {
      radius: 5,
      weight: 2,
      fillOpacity: 0.8,
    }).addTo(infoMap);
    infoMarker.bindPopup(escapeHtml(watch.name || '雪場'));
    setTimeout(() => infoMap?.invalidateSize(), 20);
  }

  function renderResortInfo() {
    const panel = ensureShell();
    const watch = currentWatch();
    if (!watch) {
      if (infoMap) {
        infoMap.remove();
        infoMap = null;
      }
      panel.innerHTML = `
        <div class="resort-info-empty">
          <span>SKI RESORT INFO</span>
          <h2>先選一個住宿區</h2>
          <p>雪場簡介是依目前選取的住宿 base 顯示；白馬、志賀等大區會顯示該住宿 base 對應的雪場群。</p>
          <button id="resortInfoChooseDestination" type="button">選住宿區</button>
        </div>`;
      document.querySelector('#resortInfoChooseDestination')?.addEventListener('click', () => {
        document.querySelector('#destinationBrowserButton')?.click();
      });
      return;
    }

    const profile = profiles[watch.id] || {};
    const trailMap = trailMaps[watch.id] || {};
    const tags = tagsFor(watch);
    const query = watch.center_query || watch.query || watch.name;
    const officialLinks = Array.isArray(profile.official_links) ? profile.official_links : [];
    const covers = Array.isArray(watch.covers) && watch.covers.length ? watch.covers : [watch.name];

    panel.innerHTML = `
      <div class="resort-info-header">
        <div>
          <span class="resort-info-eyebrow">SKI RESORT INFO</span>
          <h2>${escapeHtml(watch.name)}</h2>
          <p>${escapeHtml(covers.join(' · '))}</p>
        </div>
        <div class="resort-info-actions">
          <button id="resortInfoSearchStays" class="resort-info-search-cta" type="button">用目前條件找住宿</button>
          ${trailMap.url ? `<a href="${escapeHtml(trailMap.url)}" target="_blank" rel="noopener">官方雪道圖</a>` : ''}
          ${officialLinks.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label || '官方網站')}</a>`).join('')}
          <a href="${escapeHtml(googleMapsUrl(query))}" target="_blank" rel="noopener">Google Maps</a>
        </div>
      </div>

      <div class="resort-info-layout">
        <div class="resort-info-map-wrap">
          <div class="resort-info-map-toolbar">
            <div>
              <strong>雪道圖</strong>
              <span>雪道與纜車互動圖 · OpenSnowMap</span>
            </div>
            ${trailMap.url ? `<a href="${escapeHtml(trailMap.url)}" target="_blank" rel="noopener">${escapeHtml(trailMap.label || '官方 Trail Map')} ↗</a>` : ''}
          </div>
          <div id="resortInfoMap" class="resort-info-map"><span>雪道圖載入中…</span></div>
        </div>

        <div class="resort-info-facts">
          <article>
            <span>大小</span>
            <strong>${escapeHtml(profile.size || '詳見官方雪場資料')}</strong>
          </article>
          <article>
            <span>票價</span>
            <strong>${escapeHtml(profile.ticket_text || '官方最新票價')}</strong>
            ${profile.ticket_url ? `<a href="${escapeHtml(profile.ticket_url)}" target="_blank" rel="noopener">看官方票價</a>` : ''}
          </article>
          <article class="resort-info-transport">
            <span>簡單交通</span>
            <strong>${escapeHtml(profile.transport || '大眾交通／自駕方式依雪場官網為準')}</strong>
            <a href="${escapeHtml(googleTransitUrl(watch.name))}" target="_blank" rel="noopener">Google 查詳細交通</a>
          </article>
          <article class="resort-info-tags">
            <span>Tag</span>
            <div>${tags.length ? tags.map((tag) => `<i>${escapeHtml(TAG_LABELS[tag])}</i>`).join('') : '<em>一般雪場</em>'}</div>
          </article>
          <article class="resort-info-official">
            <span>官網</span>
            <div>${officialLinks.length ? officialLinks.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label || '官方網站')} ↗</a>`).join('') : '<em>尚未設定</em>'}</div>
          </article>
        </div>
      </div>
    `;
    document.querySelector('#resortInfoSearchStays')?.addEventListener('click', searchCurrentConditions);
    renderTrailMap(watch);
  }

  async function loadProfileData() {
    try {
      const [profileResponse, tagResponse, trailMapResponse] = await Promise.all([
        fetch(PROFILE_URL),
        fetch(TAG_URL),
        fetch(TRAIL_MAP_URL),
      ]);
      if (profileResponse.ok) profiles = await profileResponse.json();
      if (tagResponse.ok) tagOverlay = await tagResponse.json();
      if (trailMapResponse.ok) trailMaps = await trailMapResponse.json();
    } catch {
      profiles = profiles || {};
      tagOverlay = tagOverlay || {};
      trailMaps = trailMaps || {};
    }
    if (state?.data) {
      ensureShell();
      applyMode();
    }
  }

  const previousRenderAll = renderAll;
  renderAll = function resortInfoAwareRenderAll() {
    previousRenderAll();
    ensureShell();
    applyMode();
  };

  ensureShell();
  loadProfileData();
})();
