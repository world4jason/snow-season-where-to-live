const WATCHES_URL = 'https://raw.githubusercontent.com/world4jason/snow-season-where-to-live/main/config/watches.json';
const MANUAL_CACHE_TTL = 21600;
const MANUAL_MONTHLY_SERP_CALL_LIMIT = 80;
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

function nightsBetween(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86400000));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371.0088;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    descriptions: prop.description,
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
  if (nightly == null && total != null) nightly = Math.round(Number(total) / nights);

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

async function loadWatches() {
  const response = await fetch(WATCHES_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Unable to load watches: HTTP ${response.status}`);
  return response.json();
}

async function geocode(env, watch, shouldDelay = false) {
  const key = `geo:${watch.id}`;
  const cached = await env.CACHE.get(key, 'json');
  if (cached?.latitude != null && cached?.longitude != null) return cached;

  if (shouldDelay) await sleep(1100);
  const params = new URLSearchParams({ q: watch.query, format: 'jsonv2', limit: '1' });
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
    display_name: first.display_name || watch.query,
    source: 'OpenStreetMap Nominatim',
  };
  await env.CACHE.put(key, JSON.stringify(center));
  return center;
}

async function searchHotels(env, watch) {
  const params = new URLSearchParams({
    engine: 'google_hotels',
    q: watch.query,
    check_in_date: watch.check_in,
    check_out_date: watch.check_out,
    adults: String(watch.adults || 2),
    currency: watch.currency || 'TWD',
    max_price: String(watch.max_price_per_night),
    sort_by: '3',
    api_key: env.SERPAPI_KEY,
  });
  const response = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!response.ok) throw new Error(`SerpApi HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(payload.error);
  return payload;
}

async function buildWatchResult(env, watch, shouldDelayGeocode = false) {
  const nights = nightsBetween(watch.check_in, watch.check_out);
  let center = null;
  let properties = [];
  let error = null;

  try {
    const cachedCenter = await env.CACHE.get(`geo:${watch.id}`, 'json');
    center = cachedCenter || await geocode(env, watch, shouldDelayGeocode);
    const raw = await searchHotels(env, watch);
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
  if (!env.SERPAPI_KEY) throw new Error('SERPAPI_KEY is not configured');
  const watches = await loadWatches();
  const output = { checked_at: new Date().toISOString(), source: 'cloudflare-worker', watches: [] };

  let geocodeMisses = 0;
  for (const watch of watches) {
    const hasCachedCenter = Boolean(await env.CACHE.get(`geo:${watch.id}`));
    const current = await buildWatchResult(env, watch, !hasCachedCenter && geocodeMisses > 0);
    if (!hasCachedCenter) geocodeMisses += 1;
    output.watches.push(current);
  }

  await env.CACHE.put('latest', JSON.stringify(output));
  return output;
}

function validDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
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
  if (!env.SERPAPI_KEY) return jsonResponse({ error: 'SERPAPI_KEY is not configured' }, 503);

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

  if (!validDateOnly(checkIn) || !validDateOnly(checkOut)) {
    return jsonResponse({ error: 'Dates must use YYYY-MM-DD' }, 400);
  }
  const nights = nightsBetween(checkIn, checkOut);
  if (checkOut <= checkIn || nights < 1 || nights > 14) {
    return jsonResponse({ error: 'Stay must be between 1 and 14 nights' }, 400);
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > 6) {
    return jsonResponse({ error: 'Adults must be an integer between 1 and 6' }, 400);
  }
  if (!Number.isFinite(maxPrice) || maxPrice < 500 || maxPrice > 30000) {
    return jsonResponse({ error: 'Nightly budget must be between TWD 500 and 30000' }, 400);
  }

  const watches = await loadWatches();
  let requestedIds;
  if (body?.resort_ids === 'all') {
    requestedIds = watches.map((watch) => watch.id);
  } else if (Array.isArray(body?.resort_ids)) {
    requestedIds = [...new Set(body.resort_ids.map(String))];
  } else {
    requestedIds = [];
  }
  if (!requestedIds.length || requestedIds.length > watches.length) {
    return jsonResponse({ error: 'Select at least one valid resort' }, 400);
  }

  const watchById = new Map(watches.map((watch) => [watch.id, watch]));
  const selected = requestedIds.map((id) => watchById.get(id)).filter(Boolean);
  if (selected.length !== requestedIds.length) return jsonResponse({ error: 'Unknown resort id' }, 400);

  const cachedResults = [];
  const misses = [];
  for (const baseWatch of selected) {
    const key = `manual:${baseWatch.id}:${checkIn}:${checkOut}:${adults}:${Math.round(maxPrice)}`;
    const cached = await env.CACHE.get(key, 'json');
    if (cached) cachedResults.push(cached);
    else misses.push({ baseWatch, key });
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
  for (const { baseWatch, key } of misses) {
    const watch = {
      ...baseWatch,
      check_in: checkIn,
      check_out: checkOut,
      adults,
      max_price_per_night: Math.round(maxPrice),
    };
    const hasCachedCenter = Boolean(await env.CACHE.get(`geo:${watch.id}`));
    const current = await buildWatchResult(env, watch, !hasCachedCenter && geocodeMisses > 0);
    if (!hasCachedCenter) geocodeMisses += 1;
    freshResults.push(current);
    await env.CACHE.put(key, JSON.stringify(current), { expirationTtl: MANUAL_CACHE_TTL });
  }

  const resultById = new Map([...cachedResults, ...freshResults].map((watch) => [watch.id, watch]));
  const ordered = requestedIds.map((id) => resultById.get(id)).filter(Boolean);
  return jsonResponse({
    checked_at: new Date().toISOString(),
    source: 'manual-search',
    cached: misses.length === 0,
    watches: ordered,
    manual_usage: usage,
  });
}

async function status(env) {
  const manual = await monthlyManualUsage(env);
  let serpapi = null;
  let serpapiError = null;
  if (env.SERPAPI_KEY) {
    try {
      const params = new URLSearchParams({ api_key: env.SERPAPI_KEY });
      const response = await fetch(`https://serpapi.com/account.json?${params}`);
      if (!response.ok) throw new Error(`SerpApi Account HTTP ${response.status}`);
      const account = await response.json();
      serpapi = {
        account_status: account.account_status ?? null,
        plan_name: account.plan_name ?? null,
        searches_per_month: account.searches_per_month ?? null,
        this_month_usage: account.this_month_usage ?? null,
        total_searches_left: account.total_searches_left ?? account.plan_searches_left ?? null,
        rate_limit_per_hour: account.account_rate_limit_per_hour ?? null,
      };
    } catch (err) {
      serpapiError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: true,
    schedule_utc: '20 0 * * *',
    automatic_searches_per_run: (await loadWatches()).length,
    manual_searches_used: manual.used,
    manual_searches_limit: MANUAL_MONTHLY_SERP_CALL_LIMIT,
    serpapi,
    serpapi_error: serpapiError,
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
