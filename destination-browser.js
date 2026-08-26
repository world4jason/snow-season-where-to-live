(() => {
  const TAG_LABELS = {
    longest_run: '最長雪道',
    popularity: '人氣 Top 20',
    course_area_current: '面積 Top 20',
    representative_scale: '大型／聯網',
  };

  const REGION_ORDER = ['北海道', '東北', '長野', '新潟', '關東', '中部・關西', '其他'];
  let tagOverlay = {};
  let browser = null;
  const browserState = {
    query: '',
    region: '全部',
    tag: 'all',
    view: 'gallery',
  };

  function regionOf(watch) {
    const text = `${watch?.name || ''} ${watch?.query || ''} ${watch?.center_query || ''} ${(watch?.covers || []).join(' ')}`;
    if (/Hokkaido|北海道|札幌|二世谷|Niseko|Rusutsu|留壽都|富良野|Furano|Tomamu|Kiroro|Sahoro|佐幌|Kurodake|黑岳|Kamui|Yubari|夕張/i.test(text)) return '北海道';
    if (/Aomori|Iwate|Yamagata|Fukushima|青森|岩手|山形|福島|安比|Appi|藏王|Zao|Nekoma|天元台|Tengendai|八甲田|Hakkoda|雫石|Shizukuishi/i.test(text)) return '東北';
    if (/Nagano|長野|Hakuba|白馬|志賀|Nozawa|野澤|野沢|Sugadaira|菅平|Togakushi|戶隱|戸隠|Kijimadaira|木島平|Iiyama|飯山|Otari|小谷|Omachi|大町|Ryuoo|竜王|Ontake|御嶽|Komagane|駒根|Senjojiki|千疊敷|Togari|戶狩/i.test(text)) return '長野';
    if (/Niigata|新潟|Yuzawa|湯澤|湯沢|Myoko|妙高|Maiko|舞子|Joetsu|上越|Okutadami|奧只見|奥只見|Arai|岩原|Iwappara|Kandatsu|神立|Naeba|苗場|Kagura|神樂|かぐら/i.test(text)) return '新潟';
    if (/Gunma|群馬|Marunuma|丸沼/i.test(text)) return '關東';
    if (/Gifu|岐阜|Toyama|富山|Aichi|愛知|Hyogo|兵庫|Biwako|琵琶湖|Okuibuki|奧伊吹|奥伊吹|Washigatake|鷲岳|Hachi|鉢高原|Tateyama|立山/i.test(text)) return '中部・關西';
    return '其他';
  }

  function rankingTags(watch) {
    return [...new Set([
      ...(Array.isArray(watch?.ranking_tags) ? watch.ranking_tags : []),
      ...(Array.isArray(tagOverlay?.[watch?.id]) ? tagOverlay[watch.id] : []),
    ])].filter((tag) => TAG_LABELS[tag]);
  }

  function selectedWatch() {
    if (state.selectedResort === 'all') return null;
    return (state.data?.watches || []).find((watch) => watch.id === state.selectedResort) || null;
  }

  function replaceDestinationControl() {
    const host = document.querySelector('#searchDestination');
    if (!host) return;
    const watch = selectedWatch();
    const count = state.data?.watches?.length || 0;
    const label = watch?.name || '全部住宿區';
    const meta = watch ? `${regionOf(watch)} · ${rankingTags(watch).length ? rankingTags(watch).map((tag) => TAG_LABELS[tag]).join(' / ') : '住宿搜尋區'}` : `${count} 個住宿 base · 點擊瀏覽`;

    host.innerHTML = `
      <button id="destinationBrowserButton" class="destination-browser-button" type="button" aria-haspopup="dialog">
        <span class="destination-browser-main">${escapeHtml(label)}</span>
        <span class="destination-browser-meta">${escapeHtml(meta)}</span>
        <span class="destination-browser-chevron" aria-hidden="true">⌄</span>
      </button>
    `;
    document.querySelector('#destinationBrowserButton')?.addEventListener('click', openBrowser);
  }

  function ensureBrowser() {
    if (browser) return browser;
    browser = document.createElement('div');
    browser.className = 'destination-browser-overlay';
    browser.hidden = true;
    browser.innerHTML = `
      <div class="destination-browser-backdrop" data-close-browser></div>
      <section class="destination-browser-dialog" role="dialog" aria-modal="true" aria-labelledby="destinationBrowserTitle">
        <header class="destination-browser-header">
          <div>
            <span class="destination-browser-eyebrow">DESTINATION BROWSER</span>
            <h2 id="destinationBrowserTitle">選住宿區</h2>
            <p>先用地區或榜單標籤縮小範圍，再選一個住宿 base 搜尋房價。</p>
          </div>
          <button class="destination-browser-close" type="button" data-close-browser aria-label="關閉">×</button>
        </header>

        <div class="destination-browser-tools">
          <label class="destination-browser-search">
            <span aria-hidden="true">⌕</span>
            <input id="destinationBrowserSearch" type="search" placeholder="搜尋：白馬、野澤、北海道、湯澤…" autocomplete="off" />
          </label>
          <div class="destination-view-toggle" aria-label="顯示模式">
            <button type="button" data-browser-view="gallery" class="active">卡片</button>
            <button type="button" data-browser-view="list">清單</button>
          </div>
        </div>

        <div class="destination-browser-section">
          <span class="destination-filter-label">地區</span>
          <div id="destinationRegionFilters" class="destination-filter-chips"></div>
        </div>
        <div class="destination-browser-section">
          <span class="destination-filter-label">榜單 / 狀態</span>
          <div id="destinationTagFilters" class="destination-filter-chips"></div>
        </div>

        <div class="destination-browser-quick">
          <button type="button" class="destination-quick-card" data-destination-id="all">
            <span class="destination-quick-icon">⌂</span>
            <span><strong>全部住宿區</strong><small>瀏覽完整聯集；搜尋時仍只更新每日監控 5 區</small></span>
          </button>
          <button type="button" class="destination-quick-card" data-browser-tag="monitored">
            <span class="destination-quick-icon">↻</span>
            <span><strong>每日監控 5 區</strong><small>野澤、安比、斑尾、越後湯澤、札幌手稻</small></span>
          </button>
        </div>

        <div id="destinationBrowserCount" class="destination-browser-count"></div>
        <div id="destinationBrowserResults" class="destination-browser-results"></div>
      </section>
    `;
    document.body.appendChild(browser);

    browser.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-browser]')) {
        closeBrowser();
        return;
      }
      const destination = event.target.closest('[data-destination-id]');
      if (destination) {
        state.selectedResort = destination.dataset.destinationId;
        state.activeHotelKey = null;
        closeBrowser();
        renderAll();
        return;
      }
      const region = event.target.closest('[data-browser-region]');
      if (region) {
        browserState.region = region.dataset.browserRegion;
        renderBrowser();
        return;
      }
      const tag = event.target.closest('[data-browser-tag]');
      if (tag) {
        browserState.tag = tag.dataset.browserTag;
        renderBrowser();
        return;
      }
      const view = event.target.closest('[data-browser-view]');
      if (view) {
        browserState.view = view.dataset.browserView;
        renderBrowser();
      }
    });

    browser.querySelector('#destinationBrowserSearch')?.addEventListener('input', (event) => {
      browserState.query = event.target.value;
      renderBrowser();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && browser && !browser.hidden) closeBrowser();
    });
    return browser;
  }

  function filteredWatches() {
    const query = browserState.query.trim().toLowerCase();
    return (state.data?.watches || []).filter((watch) => {
      const region = regionOf(watch);
      if (browserState.region !== '全部' && region !== browserState.region) return false;
      if (browserState.tag === 'monitored' && watch.auto_monitor !== true) return false;
      if (browserState.tag !== 'all' && browserState.tag !== 'monitored' && !rankingTags(watch).includes(browserState.tag)) return false;
      if (query) {
        const haystack = `${watch.name || ''} ${watch.query || ''} ${(watch.covers || []).join(' ')} ${region}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function cardHtml(watch) {
    const tags = rankingTags(watch);
    const price = watch.lowest_price != null ? money(watch.lowest_price, watch.currency || 'TWD') : null;
    return `
      <button type="button" class="destination-card ${state.selectedResort === watch.id ? 'selected' : ''}" data-destination-id="${escapeHtml(watch.id)}">
        <span class="destination-card-topline">
          <span class="destination-region-badge">${escapeHtml(regionOf(watch))}</span>
          ${watch.auto_monitor ? '<span class="destination-monitor-badge">每日監控</span>' : ''}
        </span>
        <strong>${escapeHtml(watch.name)}</strong>
        <span class="destination-card-covers">${escapeHtml((watch.covers || []).slice(0, 3).join(' · ') || '住宿搜尋區')}</span>
        <span class="destination-card-tags">
          ${tags.slice(0, 4).map((tag) => `<i>${escapeHtml(TAG_LABELS[tag])}</i>`).join('')}
        </span>
        <span class="destination-card-status">${price ? `最近最低 ${escapeHtml(price)}` : watch.pending ? '尚未查詢' : '點擊查看'}</span>
      </button>
    `;
  }

  function renderBrowser() {
    const root = ensureBrowser();
    const watches = filteredWatches();
    const regions = ['全部', ...REGION_ORDER.filter((region) => (state.data?.watches || []).some((watch) => regionOf(watch) === region))];
    root.querySelector('#destinationRegionFilters').innerHTML = regions.map((region) => `
      <button type="button" data-browser-region="${escapeHtml(region)}" class="${browserState.region === region ? 'active' : ''}">${escapeHtml(region)}</button>
    `).join('');
    const tagOptions = [
      ['all', '全部'],
      ['monitored', '每日監控'],
      ['popularity', '人氣 Top 20'],
      ['course_area_current', '面積 Top 20'],
      ['longest_run', '最長雪道'],
      ['representative_scale', '大型／聯網'],
    ];
    root.querySelector('#destinationTagFilters').innerHTML = tagOptions.map(([value, label]) => `
      <button type="button" data-browser-tag="${value}" class="${browserState.tag === value ? 'active' : ''}">${label}</button>
    `).join('');

    root.querySelectorAll('[data-browser-view]').forEach((button) => button.classList.toggle('active', button.dataset.browserView === browserState.view));
    root.querySelector('#destinationBrowserCount').textContent = `${watches.length} 個住宿區`;

    const results = root.querySelector('#destinationBrowserResults');
    results.className = `destination-browser-results ${browserState.view === 'list' ? 'list-mode' : 'gallery-mode'}`;
    if (!watches.length) {
      results.innerHTML = '<div class="destination-browser-empty"><strong>找不到符合條件的住宿區</strong><span>換個地區、榜單標籤或搜尋字詞。</span></div>';
      return;
    }

    const groups = new Map();
    watches.forEach((watch) => {
      const region = regionOf(watch);
      if (!groups.has(region)) groups.set(region, []);
      groups.get(region).push(watch);
    });
    results.innerHTML = REGION_ORDER.filter((region) => groups.has(region)).map((region) => `
      <section class="destination-region-group">
        <div class="destination-region-heading"><h3>${region}</h3><span>${groups.get(region).length}</span></div>
        <div class="destination-region-grid">${groups.get(region).map(cardHtml).join('')}</div>
      </section>
    `).join('');
  }

  function openBrowser() {
    const root = ensureBrowser();
    root.hidden = false;
    document.body.classList.add('destination-browser-open');
    renderBrowser();
    setTimeout(() => root.querySelector('#destinationBrowserSearch')?.focus(), 20);
  }

  function closeBrowser() {
    if (!browser) return;
    browser.hidden = true;
    document.body.classList.remove('destination-browser-open');
  }

  const previousRenderSearchBar = renderSearchBar;
  renderSearchBar = function destinationBrowserRenderSearchBar() {
    previousRenderSearchBar();
    replaceDestinationControl();
  };

  async function loadTags() {
    try {
      const response = await fetch(`config/ranking-tags-by-id.json?v=${Date.now()}`);
      if (response.ok) tagOverlay = await response.json();
    } catch {
      tagOverlay = {};
    }
    if (state?.data) renderAll();
  }

  loadTags();
})();
