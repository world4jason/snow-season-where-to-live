(() => {
  const CONFIG_URLS = [
    'config/watches.json',
    'config/extra-watches.json',
  ];
  const EXCLUSIONS_URL = 'config/excluded-resorts.json';
  const DYNAMIC_FIELDS = [
    'check_in',
    'check_out',
    'adults',
    'currency',
    'max_price_per_night',
    'nights',
    'center',
    'match_count',
    'lowest_price',
    'properties',
    'error',
    'pending',
  ];

  async function loadCatalog() {
    const [groups, exclusions] = await Promise.all([
      Promise.all(CONFIG_URLS.map(async (url) => {
        const response = await fetch(`${url}?v=${Date.now()}`);
        if (!response.ok) throw new Error(`Unable to load ${url}`);
        const rows = await response.json();
        return Array.isArray(rows) ? rows : [];
      })),
      fetch(`${EXCLUSIONS_URL}?v=${Date.now()}`)
        .then((response) => response.ok ? response.json() : [])
        .catch(() => []),
    ]);

    const excludedIds = new Set((Array.isArray(exclusions) ? exclusions : []).map((row) => String(row.id)));
    const byId = new Map();
    groups.flat().forEach((metadata) => {
      if (!excludedIds.has(String(metadata.id))) byId.set(metadata.id, metadata);
    });
    return Array.from(byId.values());
  }

  async function syncCatalogMetadata() {
    let config;
    try {
      config = await loadCatalog();
    } catch {
      return;
    }
    if (!config.length) return;

    for (let attempt = 0; attempt < 60 && !state?.data; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!state?.data) return;

    const existing = new Map((state.data.watches || []).map((watch) => [watch.id, watch]));
    state.data.watches = config.map((metadata) => {
      const current = existing.get(metadata.id);
      if (!current) {
        return {
          ...metadata,
          nights: Math.max(1, Math.round((Date.parse(`${metadata.check_out}T00:00:00Z`) - Date.parse(`${metadata.check_in}T00:00:00Z`)) / 86400000)),
          center: null,
          match_count: 0,
          lowest_price: null,
          properties: [],
          error: null,
          pending: true,
        };
      }

      const merged = { ...current, ...metadata };
      DYNAMIC_FIELDS.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(current, field)) merged[field] = current[field];
      });
      return merged;
    });

    if (state.selectedResort !== 'all' && !state.data.watches.some((watch) => watch.id === state.selectedResort)) {
      state.selectedResort = 'all';
    }
    renderAll();
  }

  syncCatalogMetadata();
})();
