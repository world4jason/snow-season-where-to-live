import baseWorker from './worker.js';

const CACHE_TTL = 21600;

function mapsUrlForProperty(prop, watch) {
  const query = `${prop?.name || 'Hotel'}, ${watch?.name || watch?.query || 'Japan'}, Japan`;
  const params = new URLSearchParams({ api: '1', query });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function mapsUrlForArea(watch) {
  const query = `hotels near ${watch?.center_query || watch?.query || watch?.name || 'Japan ski resort'}`;
  const params = new URLSearchParams({ api: '1', query });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function manualCacheKey(watch) {
  return `manual:${watch.id}:${watch.check_in}:${watch.check_out}:${watch.adults || 2}:${Math.round(Number(watch.max_price_per_night))}`;
}

function firstSerpApiKey(env) {
  const direct = String(env.SERPAPI_KEY || '').trim();
  if (direct) return direct;
  try {
    const pool = JSON.parse(String(env.SERPAPI_KEYS_JSON || '[]'));
    if (!Array.isArray(pool)) return null;
    for (const item of pool) {
      if (typeof item === 'string' && item.trim()) return item.trim();
      if (item && typeof item === 'object' && String(item.key || '').trim()) return String(item.key).trim();
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeReference(prop, watch) {
  const nightly = prop?.rate_per_night?.extracted_lowest ?? prop?.extracted_price ?? null;
  const total = prop?.total_rate?.extracted_lowest ?? null;
  const images = Array.isArray(prop?.images) ? prop.images : [];
  const lat = Number(prop?.gps_coordinates?.latitude);
  const lon = Number(prop?.gps_coordinates?.longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  return {
    name: prop?.name || 'Unknown hotel',
    nightly_price: nightly == null ? null : Number(nightly),
    total_price: total == null ? null : Number(total),
    rating: prop?.overall_rating ?? null,
    reviews: prop?.reviews ?? null,
    link: prop?.link ?? null,
    google_maps_url: mapsUrlForProperty(prop, watch),
    thumbnail: prop?.thumbnail
      || images.find((image) => image?.thumbnail)?.thumbnail
      || images.find((image) => image?.original_image)?.original_image
      || null,
    latitude: hasCoords ? lat : null,
    longitude: hasCoords ? lon : null,
  };
}

async function fetchSameGoogleHotelsQuery(env, watch) {
  const apiKey = firstSerpApiKey(env);
  if (!apiKey) return null;
  const params = new URLSearchParams({
    engine: 'google_hotels',
    q: watch.query,
    check_in_date: watch.check_in,
    check_out_date: watch.check_out,
    adults: String(watch.adults || 2),
    currency: watch.currency || 'TWD',
    max_price: String(watch.max_price_per_night),
    sort_by: '3',
    api_key: apiKey,
  });
  const response = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!response.ok) return null;
  const payload = await response.json();
  return payload?.error ? null : payload;
}

async function augmentWatch(env, watch, canFetchDiagnostics) {
  const budget = Number(watch.max_price_per_night || 0);
  const areaMapsUrl = mapsUrlForArea(watch);
  const existing = Array.isArray(watch.properties) ? watch.properties : [];

  if (watch.error) {
    return { ...watch, search_status: 'error', google_maps_search_url: areaMapsUrl };
  }
  if (existing.length) {
    return { ...watch, search_status: 'matches', google_maps_search_url: areaMapsUrl };
  }

  let refs = Array.isArray(watch.over_budget_properties) ? watch.over_budget_properties : [];
  if (!refs.length && canFetchDiagnostics) {
    try {
      const raw = await fetchSameGoogleHotelsQuery(env, watch);
      refs = (raw?.non_matching_properties || [])
        .map((prop) => normalizeReference(prop, watch))
        .filter((prop) => prop.nightly_price != null && Number(prop.nightly_price) > budget)
        .sort((a, b) => Number(a.nightly_price) - Number(b.nightly_price))
        .slice(0, 10);
    } catch {
      refs = [];
    }
  }

  const enhanced = {
    ...watch,
    search_status: refs.length ? 'over_budget' : 'no_in_budget_results',
    over_budget_count: refs.length,
    lowest_over_budget_price: refs[0]?.nightly_price ?? null,
    over_budget_properties: refs,
    google_maps_search_url: areaMapsUrl,
  };

  // Overwrite the same six-hour cache entry so future cache hits retain the diagnostic fields.
  if (refs.length && env.CACHE) {
    await env.CACHE.put(manualCacheKey(enhanced), JSON.stringify(enhanced), { expirationTtl: CACHE_TTL });
  }
  return enhanced;
}

async function enhancedSearch(request, env, ctx) {
  let requestBody = null;
  try {
    requestBody = await request.clone().json();
  } catch {
    // Base worker will return its normal validation response.
  }

  const response = await baseWorker.fetch(request, env, ctx);
  if (!response.ok) return response;

  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  if (!Array.isArray(payload?.watches)) return response;

  // Only re-read the same SerpApi query after a fresh base search. SerpApi caches identical
  // Google Hotels queries for one hour, so this diagnostic read is expected to be a free cache hit.
  // For a legacy six-hour KV hit, do not spend a search just to diagnose it; Maps fallback still works.
  const canFetchDiagnostics = payload.cached === false || requestBody?.force_refresh === true;
  payload.watches = await Promise.all(payload.watches.map((watch) => augmentWatch(env, watch, canFetchDiagnostics)));

  return new Response(JSON.stringify(payload, null, 2), {
    status: response.status,
    headers: response.headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/search' && request.method === 'POST') {
      return enhancedSearch(request, env, ctx);
    }
    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
