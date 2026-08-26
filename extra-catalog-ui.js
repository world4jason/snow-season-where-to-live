(() => {
  const EXTRA_URL = `config/extra-watches.json?v=${Date.now()}`;

  async function loadExtras() {
    let extras = [];
    try {
      const response = await fetch(EXTRA_URL);
      if (!response.ok) return;
      extras = await response.json();
    } catch {
      return;
    }
    if (!Array.isArray(extras) || !extras.length) return;

    let attempts = 0;
    while (state.data == null && attempts < 50) {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!state.data) state.data = { checked_at: null, watches: [] };

    const existing = new Map((state.data.watches || []).map((watch) => [watch.id, watch]));
    for (const watch of extras) {
      const current = existing.get(watch.id);
      if (current) {
        existing.set(watch.id, {
          ...watch,
          ...current,
          name: watch.name,
          query: watch.query,
          center_query: watch.center_query,
          covers: watch.covers,
          lodging_note: watch.lodging_note,
          ranking_tags: watch.ranking_tags,
          auto_monitor: watch.auto_monitor,
        });
      } else {
        existing.set(watch.id, {
          ...watch,
          nights: Math.max(1, Math.round((Date.parse(`${watch.check_out}T00:00:00Z`) - Date.parse(`${watch.check_in}T00:00:00Z`)) / 86400000)),
          center: null,
          match_count: 0,
          lowest_price: null,
          properties: [],
          error: null,
          pending: true,
        });
      }
    }

    state.data.watches = Array.from(existing.values());
    renderAll();
  }

  loadExtras();
})();
