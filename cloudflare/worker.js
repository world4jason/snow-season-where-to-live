const WATCHES_URL = 'https://raw.githubusercontent.com/world4jason/snow-season-where-to-live/main/config/watches.json';
const EXTRA_WATCHES_URL = 'https://raw.githubusercontent.com/world4jason/snow-season-where-to-live/main/config/extra-watches.json';
const MANUAL_CACHE_TTL = 21600;
const MANUAL_MONTHLY_SERP_CALL_LIMIT = 80;
const SERP_POOL_STATUS_TTL = 300;
const SERP_POOL_STATUS_KEY = 'serpapi-pool-status:v1';
const SERP_CURSOR_KEY = 'serpapi-key-cursor:v1';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value, null, 2), {
  status,
  headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const radius = 6371.0088;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function flattenText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join(' ');
  if (typeof value === 'object') return Object.values(value).map(flattenText).join(' ');
  return '';
}

function explicitTags(prop) {
  const text = flattenText({
    amenities: prop.amenities,
    description: prop.description,
    nearby: prop.nearby_places,
    prices: prop.prices,
    deal: prop.deal,
  }).toLowerCase();

  return {
    free_cancellation: prop.free_cancellation === true || /free cancellation|refundable|免費取消/.test(text),
    breakfast_included: prop.breakfast_included === true || /breakfast included|free breakfast|含早餐/.test(text),
    ski_in_out: prop.ski_in_out === true || /ski[- ]?in\s*[/&-]?\s*ski[- ]?out|ski-to-door|ski to door/.test(text),
  };
}

function googleMapsUrl(prop, watch) {
  const query = `${prop.name || 'Hotel'}, ${watch.name || watch.query}, Japan`;
  const params = new URLSearchParams({
    api: '1',
    query,
    utm_source: 'snow-season-where-to-live',
    utm_campaign: 'place_details_search',
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function normalizeProperty(prop, watch, center, nights) {
  let nightly = prop?.rate_per_night?.extracted_lowest ?? prop?.extracted_price ?? null;
  const total = prop?.total_rate?.extracted_lowest ?? null;
  if (nightly == null && total != null && nights > 0) nightly = Math.round(Number(total) / nights);

  const prices = Array.isArray(prop.prices) ? prop.prices : [];
  let source = prop.source || prices[0]?.source || 'Google Hotels';
  let link = prop.link ?? null;
  for (const candidate of prices) {
    if (candidate?.link) {
      link = candidate.link;
      source = candidate.source || source;
      break;
    }
  }

  const images = Array.isArray(prop.images) ? prop.images : [];
  const thumbnail = prop.thumbnail
    || images.find((image) => image?.thumbnail)?.thumbnail
    || images.find((image) => image?.original_image)?.original_image
    || null;

  const lat = Number(prop?.gps_coordinates?.latitude);
  const lon = Number(prop?.gps_coordinates?.longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  const distance = center && hasCoords
    ? Number(haversineKm(center.latitude, center.longitude, lat, lon).toFixed(2))
    : null;

  return {
    name: prop.name || 'Unknown hotel',
    nightly_price: nightly == null ? null : Number(nightly),
    total_price: total == null ? null : Number(total),
    rating: prop.overall_rating ?? null,
    reviews: prop.reviews ?? null,
    source,
    link,
    google_maps_url: googleMapsUrl(prop, watch),
    thumbnail,
    latitude: hasCoords ? lat : null,
    longitude: hasCoords ? lon : null,
    hotel_class: prop.hotel_class ?? null,
    property_type: prop.type ?? prop.property_type ?? null,
    distance_to_center_km: distance,
    tags: explicitTags(prop),
  };
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

async function loadWatches() {
  const [base, extra] = await Promise.all([
    loadJsonArray(WATCHES_URL, 'watches.json'),
    loadJsonArray(EXTRA_WATCHES_URL, 'extra-watches.json'),
  ]);
  const byId = new Map();
  [...base, ...extra].forEach((watch) => byId.set(watch.id, watch));
  return Array.from(byId.values());
}

function monitoredWatches(watches) {
  return watches.filter((watch) => watch.auto_monitor === true);
}

function serpApiKeyEntries(env) {
  const rows = [];

  if (env.SERPAPI_KEYS_JSON) {
    try {
      const parsed = JSON.parse(env.SERPAPI_KEYS_JSON);
      if (Array.isArray(parsed)) {
        parsed.forEach((item, index) => {
          if (typeof item === 'string' && item.trim()) {
            rows.push({ label: `key-${index + 1}`, key: item.trim() });
          } else if (item && typeof item === 'object' && String(item.key || '').trim()) {
            rows.push({
              label: String(item.name || item.label || `key-${index + 1}`).trim(),
              key: String(item.key).trim(),
            });
          }
        });
      }
    } catch {
      // Fall back to SERPAPI_KEY below if the pool secret is malformed.
    }
  }

  if (String(env.SERPAPI_KEY || '').trim()) {
    rows.push({ label: 'primary', key: String(env.SERPAPI_KEY).trim() });
  }

  const seen = new Set();
  return rows.filter((row) => {
    if (!row.key || seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

function hasSerpApiKeys(env) {
  return serpApiKeyEntries(env).length > 0;
}

async function fetchSerpAccount(entry) {
  const params = new URLSearchParams({ api_key: entry.key });
  const response = await fetch(`https://serpapi.com/account.json?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const account = await response.json();
  return {
    label: entry.label,
    account_id: account.account_id ?? null,
    account_status: account.account_status ?? null,
    plan_name: account.plan_name ?? null,
    searches_per_month: account.searches_per_month ?? null,
    this_month_usage: account.this_month_usage ?? null,
    total_searches_left: account.total_searches_left ?? account.plan_searches_left ?? null,
    rate_limit_per_hour: account.account_rate_limit_per_hour ?? null,
    error: null,
  };
}

async function serpPoolHealth(env, force = false) {
  const entries = serpApiKeyEntries(env);
  if (!entries.length) return [];
  const signature = entries.map((entry) => entry.label).join('|');

  if (!force) {
    const cached = await env.CACHE.get(SERP_POOL_STATUS_KEY, 'json');
    if (
      cached?.signature === signature
      && Number(cached?.checked_at || 0) > Date.now() - SERP_POOL_STATUS_TTL * 1000
      && Array.isArray(cached?.statuses)
    ) {
      return entries.map((entry, index) => ({
        ...entry,
        ...(cached.statuses[index] || { label: entry.label, error: 'No cached status' }),
      }));
    }
  }

  const statuses = await Promise.all(entries.map(async (entry) => {
    try {
      return await fetchSerpAccount(entry);
    } catch (err) {
      return {
        label: entry.label,
        account_id: null,
        account_status: null,
        plan_name: null,
        searches_per_month: null,
        this_month_usage: null,
        total_searches_left: null,
        rate_limit_per_hour: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }));

  await env.CACHE.put(SERP_POOL_STATUS_KEY, JSON.stringify({
    signature,
    checked_at: Date.now(),
    statuses: statuses.map(({ label, ...status }) => ({ label, ...status })),
  }), { expirationTtl: SERP_POOL_STATUS_TTL * 2 });

  return entries.map((entry, index) => ({ ...entry, ...statuses[index] }));
}

async function orderedSerpApiKeys(env) {
  const health = await serpPoolHealth(env);
  if (!health.length) return [];

  const knownAvailable = health.filter((entry) => {
    if (entry.error) return false;
    const status = String(entry.account_status || '').toLowerCase();
    if (status && status !== 'active') return false;
    if (entry.total_searches_left != null && Number(entry.total_searches_left) <= 0) return false;
    return true;
  });
  const unknown = health.filter((entry) => entry.error);
  const available = knownAvailable.length ? knownAvailable : unknown;
  if (!available.length) return [];

  const cursor = Number(await env.CACHE.get(SERP_CURSOR_KEY) || 0);
  const start = Number.isFinite(cursor) ? Math.abs(cursor) % available.length : 0;
  return [...available.slice(start), ...available.slice(0, start)];
}

async function advanceSerpCursor(env) {
  const entries = serpApiKeyEntries(env);
  if (entries.length <= 1) return;
  const current = Number(await env.CACHE.get(SERP_CURSOR_KEY) || 0);
  await env.CACHE.put(SERP_CURSOR_KEY, String((current + 1) % entries.length));
}

function shouldTryAnotherSerpKey(status, payload) {
  if ([401, 403, 429].includes(status)) return true;
  const text = String(payload?.error || payload?.message || '').toLowerCase();
  return /api.?key|quota|search(?:es)?.*(?:left|limit)|rate.?limit|account.*(?:inactive|suspended)|monthly.*limit/.test(text);
}

function geocodeKey(watch) {
  const centerQuery = String(watch.center_query || watch.query || '').trim();
  return `geo:v2:${watch.id}:${encodeURIComponent(centerQuery)}`;
}

async function geocode(env, watch, shouldDelay = false) {
  const key = geocodeKey(watch);
  const cached = await env.CACHE.get(key, 'json');
  if (cached?.latitude != null && cached?.longitude != null) return cached;

  if (shouldDelay) await sleep(1100);
  const query = watch.center_query || watch.query;
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en',
      'User-Agent': 'snow-season-where-to-live/1.0 (github.com/world4jason/snow-season-where-to-live)',
    },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  const first = rows?.[0];
  if (!first) return null;

  const center = {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    display_name: first.display_name || query,
    source: 'OpenStreetMap Nominatim',
  };
  await env.CACHE.put(key, JSON.stringify(center));
  return center;
}

async function searchHotels(env, watch, { forceRefresh = false } = {}) {
  const keyPool = await orderedSerpApiKeys(env);
  if (!keyPool.length) throw new Error('No SerpApi key with available quota is configured');

  let lastError = null;
  for (let index = 0; index < keyPool.length; index += 1) {
    const entry = keyPool[index];
    const params = new URLSearchParams({
      engine: 'google_hotels',
      q: watch.query,
      check_in_date: watch.check_in,
      check_out_date: watch.check_out,
      adults: String(watch.adults || 2),
      currency: watch.currency || 'TWD',
      max_price: String(watch.max_price_per_night),
      sort_by: '3',
      api_key: entry.key,
    });
    if (forceRefresh) params.set('no_cache', 'true');

    let response;
    try {
      response = await fetch(`https://serpapi.com/search.json?${params}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (index === keyPool.length - 1) break;
      continue;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = { error: `Non-JSON response (HTTP ${response.status})` };
    }

    if (response.ok && !payload?.error) {
      await advanceSerpCursor(env);
      return payload;
    }

    lastError = new Error(payload?.error || `SerpApi HTTP ${response.status}`);
    const retryable = shouldTryAnotherSerpKey(response.status, payload);
    if (!retryable || index === keyPool.length - 1) break;
    await env.CACHE.delete(SERP_POOL_STATUS_KEY);
  }

  throw lastError || new Error('All configured SerpApi keys failed');
}

function manualCacheKey(watch) {
  return `manual:${watch.id}:${watch.check_in}:${watch.check_out}:${watch.adults || 2}:${Math.round(Number(watch.max_price_per_night))}`;
}

async function buildWatchResult(env, watch, shouldDelayGeocode = false, { forceRefresh = false } = {}) {
  const nights = nightsBetween(watch.check_in, watch.check_out);
  let center = null;
  let properties = [];
  let error = null;

  try {
    const centerKey = geocodeKey(watch);
    const cachedCenter = await env.CACHE.get(centerKey, 'json');
    center = cachedCenter || await geocode(env, watch, shouldDelayGeocode);
    const raw = await searchHotels(env, watch, { forceRefresh });
    properties = (raw.properties || [])
      .map((prop) => normalizeProperty(prop, watch, center, nights))
      .filter((prop) => prop.nightly_price != null && prop.nightly_price <= Number(watch.max_price_per_night))
      .sort((a, b) => a.nightly_price - b.nightly_price)
      .slice(0, 20);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return {
    ...watch,
    nights,
    center,
    match_count: properties.length,
    lowest_price: properties[0]?.nightly_price ?? null,
    properties,
    error,
  };
}

async function refresh(env) {
  if (!hasSerpApiKeys(env)) throw new Error('No SerpApi key is configured');
  const catalog = await loadWatches();
  const watches = monitoredWatches(catalog);
  const output = {
    checked_at: new Date().toISOString(),
    source: 'cloudflare-worker',
    catalog_count: catalog.length,
    watches: [],
  };

  let geocodeMisses = 0;
  for (const watch of watches) {
    const hasCachedCenter = Boolean(await env.CACHE.get(geocodeKey(watch)));
    const current = await buildWatchResult(env, watch, !hasCachedCenter && geocodeMisses > 0);
    if (!hasCachedCenter) geocodeMisses += 1;
    output.watches.push(current);

    if (!current.error) {
      await env.CACHE.put(manualCacheKey(current), JSON.stringify(current), { expirationTtl: MANUAL_CACHE_TTL });
    }
  }

  await env.CACHE.put('latest', JSON.stringify(output));
  return output;
}

async function monthlyManualUsage(env) {
  const month = new Date().toISOString().slice(0, 7);
  const key = `manual-serp-usage:${month}`;
  return { month, key, used: Number(await env.CACHE.get(key) || 0) };
}

async function consumeManualQuota(env, cost) {
  const usage = await monthlyManualUsage(env);
  if (usage.used + cost > MANUAL_MONTHLY_SERP_CALL_LIMIT) {
    return { allowed: false, used: usage.used, limit: MANUAL_MONTHLY_SERP_CALL_LIMIT };
  }
  const next = usage.used + cost;
  await env.CACHE.put(usage.key, String(next), { expirationTtl: 3456000 });
  return { allowed: true, used: next, limit: MANUAL_MONTHLY_SERP_CALL_LIMIT };
}

async function manualSearch(request, env) {
  if (!hasSerpApiKeys(env)) return jsonResponse({ error: 'No SerpApi key is configured' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const checkIn = String(body?.check_in || '');
  const checkOut = String(body?.check_out || '');
  const adults = Number(body?.adults ?? 2);
  const maxPrice = Number(body?.max_price_per_night ?? 6000);
  const forceRefresh = body?.force_refresh === true;
  const start = parseDateOnly(checkIn);
  const end = parseDateOnly(checkOut);

  if (!start || !end) return jsonResponse({ error: 'Dates must be valid YYYY-MM-DD calendar dates' }, 400);
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1 || nights > 14) return jsonResponse({ error: 'Stay must be between 1 and 14 nights' }, 400);
  if (!Number.isInteger(adults) || adults < 1 || adults > 6) {
    return jsonResponse({ error: 'Adults must be an integer between 1 and 6' }, 400);
  }
  if (!Number.isFinite(maxPrice) || maxPrice < 500 || maxPrice > 30000) {
    return jsonResponse({ error: 'Nightly budget must be between TWD 500 and 30000' }, 400);
  }

  const watches = await loadWatches();
  let requestedIds;
  if (body?.resort_ids === 'all') {
    requestedIds = monitoredWatches(watches).map((watch) => watch.id);
  } else if (Array.isArray(body?.resort_ids)) {
    requestedIds = [...new Set(body.resort_ids.map(String))];
  } else {
    requestedIds = [];
  }
  if (!requestedIds.length || requestedIds.length > watches.length) {
    return jsonResponse({ error: 'Select at least one valid resort' }, 400);
  }
  if (forceRefresh && requestedIds.length !== 1) {
    return jsonResponse({ error: 'Forced refresh is limited to one lodging area per request' }, 400);
  }

  const watchById = new Map(watches.map((watch) => [watch.id, watch]));
  const selected = requestedIds.map((id) => watchById.get(id)).filter(Boolean);
  if (selected.length !== requestedIds.length) return jsonResponse({ error: 'Unknown resort id' }, 400);

  const cachedResults = [];
  const misses = [];
  for (const baseWatch of selected) {
    const watch = {
      ...baseWatch,
      check_in: checkIn,
      check_out: checkOut,
      adults,
      max_price_per_night: Math.round(maxPrice),
    };
    const key = manualCacheKey(watch);
    const cached = forceRefresh ? null : await env.CACHE.get(key, 'json');
    if (cached) cachedResults.push(cached);
    else misses.push({ watch, key });
  }

  let usage = null;
  if (misses.length) {
    usage = await consumeManualQuota(env, misses.length);
    if (!usage.allowed) {
      return jsonResponse({
        error: '本月手動即時查詢額度已用完，請等每日自動更新或下個月再試。',
        manual_usage: usage,
      }, 429);
    }
  }

  const freshResults = [];
  let geocodeMisses = 0;
  for (const { watch, key } of misses) {
    const hasCachedCenter = Boolean(await env.CACHE.get(geocodeKey(watch)));
    const current = await buildWatchResult(
      env,
      watch,
      !hasCachedCenter && geocodeMisses > 0,
      { forceRefresh },
    );
    if (!hasCachedCenter) geocodeMisses += 1;
    freshResults.push(current);
    if (!current.error) {
      await env.CACHE.put(key, JSON.stringify(current), { expirationTtl: MANUAL_CACHE_TTL });
    }
  }

  const resultById = new Map([...cachedResults, ...freshResults].map((watch) => [watch.id, watch]));
  const ordered = requestedIds.map((id) => resultById.get(id)).filter(Boolean);
  return jsonResponse({
    checked_at: new Date().toISOString(),
    source: forceRefresh ? 'forced-refresh' : 'manual-search',
    cached: !forceRefresh && misses.length === 0,
    force_refresh: forceRefresh,
    watches: ordered,
    manual_usage: usage,
  });
}

async function status(env) {
  const manual = await monthlyManualUsage(env);
  const catalog = await loadWatches();
  const automatic = monitoredWatches(catalog);
  const pool = await serpPoolHealth(env);
  const accountGroups = new Set(pool.map((entry) => entry.account_id).filter(Boolean));
  const publicPool = pool.map((entry) => ({
    label: entry.label,
    account_status: entry.account_status ?? null,
    plan_name: entry.plan_name ?? null,
    searches_per_month: entry.searches_per_month ?? null,
    this_month_usage: entry.this_month_usage ?? null,
    total_searches_left: entry.total_searches_left ?? null,
    rate_limit_per_hour: entry.rate_limit_per_hour ?? null,
    error: entry.error ?? null,
  }));

  return {
    ok: true,
    schedule_utc: '20 0 * * *',
    catalog_count: catalog.length,
    automatic_searches_per_run: automatic.length,
    automatic_resort_ids: automatic.map((watch) => watch.id),
    manual_searches_used: manual.used,
    manual_searches_limit: MANUAL_MONTHLY_SERP_CALL_LIMIT,
    serpapi: publicPool[0] || null,
    serpapi_pool: {
      key_count: publicPool.length,
      account_group_count: accountGroups.size || null,
      shared_quota_detected: publicPool.length > 1 && accountGroups.size > 0 && accountGroups.size < publicPool.length,
      keys: publicPool,
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname === '/' || url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'snow-season-where-to-live-api' });
    }

    if (url.pathname === '/api/status' && request.method === 'GET') {
      try {
        return jsonResponse(await status(env));
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (url.pathname === '/api/latest' && request.method === 'GET') {
      const latest = await env.CACHE.get('latest', 'json');
      if (!latest) return jsonResponse({ checked_at: null, watches: [], message: 'No refresh has run yet.' }, 200);
      return jsonResponse(latest);
    }

    if (url.pathname === '/api/search' && request.method === 'POST') {
      if (env.MANUAL_SEARCH_RATE_LIMITER) {
        const { success } = await env.MANUAL_SEARCH_RATE_LIMITER.limit({ key: 'public-live-search' });
        if (!success) return jsonResponse({ error: '查詢太頻繁，請稍後再試。' }, 429);
      }
      return manualSearch(request, env);
    }

    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      if (!env.ADMIN_TOKEN) return jsonResponse({ error: 'ADMIN_TOKEN is not configured' }, 503);
      const auth = request.headers.get('Authorization') || '';
      if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return jsonResponse({ error: 'Unauthorized' }, 401);
      try {
        return jsonResponse(await refresh(env));
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refresh(env));
  },
};
