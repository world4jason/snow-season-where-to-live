const WATCHES_URL = 'https://raw.githubusercontent.com/world4jason/snow-season-where-to-live/main/config/watches.json';
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

function normalizeProperty(prop, watch, center, nights) {
  let nightly = prop?.rate_per_night?.extracted_lowest ?? null;
  const total = prop?.total_rate?.extracted_lowest ?? null;
  if (nightly == null && total != null) nightly = Math.round(Number(total) / nights);

  const prices = Array.isArray(prop.prices) ? prop.prices : [];
  let source = prices[0]?.source ?? null;
  let link = prop.link ?? null;
  for (const candidate of prices) {
    if (candidate?.link) {
      link = candidate.link;
      source = candidate.source || source;
      break;
    }
  }

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
    thumbnail: prop.thumbnail ?? null,
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

async function refresh(env) {
  if (!env.SERPAPI_KEY) throw new Error('SERPAPI_KEY is not configured');
  const watches = await loadWatches();
  const output = { checked_at: new Date().toISOString(), source: 'cloudflare-worker', watches: [] };

  let geocodeMisses = 0;
  for (const watch of watches) {
    const nights = nightsBetween(watch.check_in, watch.check_out);
    let center = null;
    let properties = [];
    let error = null;

    try {
      const cached = await env.CACHE.get(`geo:${watch.id}`, 'json');
      if (cached) {
        center = cached;
      } else {
        center = await geocode(env, watch, geocodeMisses > 0);
        geocodeMisses += 1;
      }

      const raw = await searchHotels(env, watch);
      properties = (raw.properties || [])
        .map((prop) => normalizeProperty(prop, watch, center, nights))
        .filter((prop) => prop.nightly_price != null && prop.nightly_price <= Number(watch.max_price_per_night))
        .sort((a, b) => a.nightly_price - b.nightly_price)
        .slice(0, 20);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    output.watches.push({
      ...watch,
      nights,
      center,
      match_count: properties.length,
      lowest_price: properties[0]?.nightly_price ?? null,
      properties,
      error,
    });
  }

  await env.CACHE.put('latest', JSON.stringify(output));
  return output;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname === '/' || url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'snow-season-where-to-live-api' });
    }

    if (url.pathname === '/api/latest' && request.method === 'GET') {
      const latest = await env.CACHE.get('latest', 'json');
      if (!latest) return jsonResponse({ checked_at: null, watches: [], message: 'No refresh has run yet.' }, 200);
      return jsonResponse(latest);
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
