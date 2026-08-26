import enhancedWorker from './worker-enhanced.js';

const WATCHES_URL = 'https://raw.githubusercontent.com/world4jason/snow-season-where-to-live/main/config/watches.json';
const EXTRA_WATCHES_URL = 'https://raw.githubusercontent.com/world4jason/snow-season-where-to-live/main/config/extra-watches.json';
const EXCLUSIONS_URL = 'https://raw.githubusercontent.com/world4jason/snow-season-where-to-live/main/config/excluded-resorts.json';
const MONITOR_CONFIG_KEY = 'monitor-config:v1';
const MAX_MONITOR_ROWS = 12;
const MAX_ENABLED_MONITORS = 5;
const SCHEDULE_UTC = '20 0 * * *';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function isAuthorized(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  return (request.headers.get('Authorization') || '') === `Bearer ${env.ADMIN_TOKEN}`;
}

function parseDateOnly(value) {
  const text = String(value || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
}

function nightsBetween(start, end) {
  const a = parseDateOnly(start);
  const b = parseDateOnly(end);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

async function loadJsonArray(url, label) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!response.ok) throw new Error(`Unable to load ${label}: HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`${label} must contain an array`);
  return rows;
}

async function loadActiveCatalog() {
  const [base, extra, excludedRows] = await Promise.all([
    loadJsonArray(WATCHES_URL, 'watches.json'),
    loadJsonArray(EXTRA_WATCHES_URL, 'extra-watches.json'),
    loadJsonArray(EXCLUSIONS_URL, 'excluded-resorts.json').catch(() => []),
  ]);
  const excluded = new Set(excludedRows.map((row) => String(row?.id || '')).filter(Boolean));
  const byId = new Map();
  [...base, ...extra].forEach((watch) => {
    if (!excluded.has(String(watch.id))) byId.set(String(watch.id), watch);
  });
  return Array.from(byId.values());
}

function defaultMonitors(catalog) {
  return catalog
    .filter((watch) => watch.auto_monitor === true)
    .slice(0, MAX_ENABLED_MONITORS)
    .map((watch) => ({
      resort_id: String(watch.id),
      enabled: true,
      check_in: String(watch.check_in || ''),
      check_out: String(watch.check_out || ''),
      adults: Number(watch.adults || 2),
      max_price_per_night: Number(watch.max_price_per_night || 6000),
    }));
}

async function readMonitorConfig(env, catalog) {
  const stored = await env.CACHE.get(MONITOR_CONFIG_KEY, 'json');
  if (stored && Array.isArray(stored.monitors)) {
    return {
      version: Number(stored.version || 1),
      updated_at: stored.updated_at || null,
      source: 'kv',
      monitors: stored.monitors,
    };
  }
  return {
    version: 1,
    updated_at: null,
    source: 'defaults',
    monitors: defaultMonitors(catalog),
  };
}

function validateMonitors(rows, catalog) {
  if (!Array.isArray(rows)) throw new Error('monitors must be an array');
  if (rows.length > MAX_MONITOR_ROWS) throw new Error(`At most ${MAX_MONITOR_ROWS} monitor rows are allowed`);

  const catalogById = new Map(catalog.map((watch) => [String(watch.id), watch]));
  const seen = new Set();
  const normalized = rows.map((row, index) => {
    const resortId = String(row?.resort_id || '').trim();
    if (!catalogById.has(resortId)) throw new Error(`Row ${index + 1}: unknown lodging area`);
    if (seen.has(resortId)) throw new Error(`Row ${index + 1}: duplicate lodging area`);
    seen.add(resortId);

    const checkIn = String(row?.check_in || '');
    const checkOut = String(row?.check_out || '');
    if (!parseDateOnly(checkIn) || !parseDateOnly(checkOut)) {
      throw new Error(`Row ${index + 1}: dates must be valid YYYY-MM-DD dates`);
    }
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1 || nights > 14) throw new Error(`Row ${index + 1}: stay must be 1–14 nights`);

    const adults = Number(row?.adults ?? 2);
    if (!Number.isInteger(adults) || adults < 1 || adults > 6) {
      throw new Error(`Row ${index + 1}: adults must be 1–6`);
    }

    const budget = Number(row?.max_price_per_night ?? 6000);
    if (!Number.isFinite(budget) || budget < 500 || budget > 30000) {
      throw new Error(`Row ${index + 1}: nightly budget must be TWD 500–30,000`);
    }

    return {
      resort_id: resortId,
      enabled: row?.enabled !== false,
      check_in: checkIn,
      check_out: checkOut,
      adults,
      max_price_per_night: Math.round(budget),
    };
  });

  const enabledCount = normalized.filter((row) => row.enabled).length;
  if (enabledCount > MAX_ENABLED_MONITORS) {
    throw new Error(`At most ${MAX_ENABLED_MONITORS} monitors can be enabled on the current free-quota policy`);
  }
  return normalized;
}

function publicMonitorSummary(config) {
  const enabled = config.monitors.filter((row) => row.enabled !== false);
  return {
    schedule_utc: SCHEDULE_UTC,
    schedule_taiwan: '08:20',
    source: config.source,
    updated_at: config.updated_at,
    enabled_count: enabled.length,
    enabled_resort_ids: enabled.map((row) => row.resort_id),
    max_enabled: MAX_ENABLED_MONITORS,
    estimated_daily_max_searches: enabled.length,
    estimated_31_day_max_searches: enabled.length * 31,
  };
}

function monitorCacheKey(row) {
  return `manual:${row.resort_id}:${row.check_in}:${row.check_out}:${row.adults || 2}:${Math.round(Number(row.max_price_per_night))}`;
}

function internalEnv(env) {
  const cache = {
    get(key, ...rest) {
      if (String(key).startsWith('manual-serp-usage:')) return Promise.resolve('0');
      return env.CACHE.get(key, ...rest);
    },
    put(key, ...rest) {
      if (String(key).startsWith('manual-serp-usage:')) return Promise.resolve();
      return env.CACHE.put(key, ...rest);
    },
    delete(key, ...rest) {
      return env.CACHE.delete(key, ...rest);
    },
    list(...args) {
      return env.CACHE.list(...args);
    },
  };
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'MANUAL_SEARCH_RATE_LIMITER') return null;
      if (prop === 'CACHE') return cache;
      return Reflect.get(target, prop);
    },
  });
}

async function runConfiguredMonitors(env, ctx, { bypassLocalCache = false } = {}) {
  const catalog = await loadActiveCatalog();
  const catalogById = new Map(catalog.map((watch) => [String(watch.id), watch]));
  const config = await readMonitorConfig(env, catalog);
  const monitors = validateMonitors(config.monitors, catalog).filter((row) => row.enabled !== false);
  const runtimeEnv = internalEnv(env);
  const results = [];

  for (const monitor of monitors) {
    if (bypassLocalCache) await env.CACHE.delete(monitorCacheKey(monitor));
    const request = new Request('https://internal.local/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resort_ids: [monitor.resort_id],
        check_in: monitor.check_in,
        check_out: monitor.check_out,
        adults: monitor.adults,
        max_price_per_night: monitor.max_price_per_night,
        force_refresh: false,
      }),
    });

    try {
      const response = await enhancedWorker.fetch(request, runtimeEnv, ctx);
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload?.watches) || !payload.watches[0]) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      results.push({ ...payload.watches[0], monitor_enabled: true });
    } catch (err) {
      const base = catalogById.get(monitor.resort_id) || { id: monitor.resort_id, name: monitor.resort_id };
      results.push({
        ...base,
        check_in: monitor.check_in,
        check_out: monitor.check_out,
        adults: monitor.adults,
        max_price_per_night: monitor.max_price_per_night,
        properties: [],
        match_count: 0,
        lowest_price: null,
        monitor_enabled: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const output = {
    checked_at: new Date().toISOString(),
    source: 'configured-monitor',
    catalog_count: catalog.length,
    monitor_source: config.source,
    monitor_count: monitors.length,
    watches: results,
  };
  await env.CACHE.put('latest', JSON.stringify(output));
  return output;
}

async function handleMonitorSummary(env) {
  const catalog = await loadActiveCatalog();
  const config = await readMonitorConfig(env, catalog);
  const monitors = validateMonitors(config.monitors, catalog);
  return jsonResponse(publicMonitorSummary({ ...config, monitors }));
}

async function handleGetMonitors(request, env) {
  if (!env.ADMIN_TOKEN) return jsonResponse({ error: 'ADMIN_TOKEN is not configured' }, 503);
  if (!isAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const catalog = await loadActiveCatalog();
  const config = await readMonitorConfig(env, catalog);
  const monitors = validateMonitors(config.monitors, catalog);
  return jsonResponse({
    ...publicMonitorSummary({ ...config, monitors }),
    monitors,
  });
}

async function handlePutMonitors(request, env) {
  if (!env.ADMIN_TOKEN) return jsonResponse({ error: 'ADMIN_TOKEN is not configured' }, 503);
  if (!isAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const catalog = await loadActiveCatalog();
    const monitors = validateMonitors(body?.monitors, catalog);
    const stored = {
      version: 1,
      updated_at: new Date().toISOString(),
      monitors,
    };
    await env.CACHE.put(MONITOR_CONFIG_KEY, JSON.stringify(stored));
    return jsonResponse({
      ...publicMonitorSummary({ ...stored, source: 'kv' }),
      monitors,
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
}

async function enhancedStatus(request, env, ctx) {
  const response = await enhancedWorker.fetch(request, env, ctx);
  if (!response.ok) return response;
  let payload;
  try {
    payload = await response.json();
  } catch {
    return response;
  }

  const catalog = await loadActiveCatalog();
  const config = await readMonitorConfig(env, catalog);
  const monitors = validateMonitors(config.monitors, catalog);
  const summary = publicMonitorSummary({ ...config, monitors });
  payload.automatic_searches_per_run = summary.enabled_count;
  payload.automatic_resort_ids = summary.enabled_resort_ids;
  payload.estimated_monitored_refresh_cost = summary.enabled_count;
  payload.estimated_monthly_automatic_max = summary.estimated_31_day_max_searches;
  payload.monitor_config_source = summary.source;
  payload.monitor_updated_at = summary.updated_at;
  payload.monitor_max_enabled = summary.max_enabled;

  return jsonResponse(payload, response.status);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname === '/api/monitor-summary' && request.method === 'GET') {
      try {
        return await handleMonitorSummary(env);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === '/api/monitors' && request.method === 'GET') {
      try {
        return await handleGetMonitors(request, env);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === '/api/monitors' && ['POST', 'PUT'].includes(request.method)) {
      try {
        return await handlePutMonitors(request, env);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === '/api/status' && request.method === 'GET') {
      try {
        return await enhancedStatus(request, env, ctx);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      if (!env.ADMIN_TOKEN) return jsonResponse({ error: 'ADMIN_TOKEN is not configured' }, 503);
      if (!isAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
      try {
        return jsonResponse(await runConfiguredMonitors(env, ctx, { bypassLocalCache: true }));
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    return enhancedWorker.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runConfiguredMonitors(env, ctx));
  },
};
