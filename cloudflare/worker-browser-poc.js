import monitorWorker from './worker-monitor.js';
import { searchGoogleMapsHotels } from './google-maps-browser-provider.js';
import { compareProviderResults } from './provider-utils.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function isAuthorized(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  return (request.headers.get('Authorization') || '') === `Bearer ${env.ADMIN_TOKEN}`;
}

async function requestJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function browserRequest(body) {
  return {
    resort_id: String(body?.resort_id || ''),
    google_maps_url: String(body?.google_maps_url || ''),
    check_in: String(body?.check_in || ''),
    check_out: String(body?.check_out || ''),
    adults: Number(body?.adults ?? 2),
    rooms: Number(body?.rooms ?? 1),
    currency: String(body?.currency || 'TWD').toUpperCase(),
    max_price_per_night: Number(body?.max_price_per_night ?? 6000),
    max_results: Number(body?.max_results ?? 20),
  };
}

async function browserOnlySearch(request, env) {
  if (!env.ADMIN_TOKEN) return jsonResponse({ error: 'ADMIN_TOKEN is not configured' }, 503);
  if (!isAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await requestJson(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400);

  const result = await searchGoogleMapsHotels(env, browserRequest(body));
  const status = result.provider_status === 'unsupported_input' ? 400 : 200;
  return jsonResponse(result, status);
}

function internalSearchEnv(env) {
  // Provider comparison is an explicit admin diagnostic. Do not let the public
  // browser-facing rate limiter block the internal SerpApi baseline request.
  return new Proxy(env, {
    get(target, prop) {
      if (prop === 'MANUAL_SEARCH_RATE_LIMITER') return null;
      return Reflect.get(target, prop);
    },
  });
}

async function serpApiBaseline(env, ctx, body) {
  const resortId = String(body?.resort_id || '');
  if (!resortId) {
    return { ok: false, error: 'resort_id is required for SerpApi baseline comparison', properties: [] };
  }
  const req = new Request('https://internal.local/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resort_ids: [resortId],
      check_in: String(body.check_in || ''),
      check_out: String(body.check_out || ''),
      adults: Number(body.adults ?? 2),
      max_price_per_night: Number(body.max_price_per_night ?? 6000),
      force_refresh: body?.serpapi_force_refresh === true,
    }),
  });
  const response = await monitorWorker.fetch(req, internalSearchEnv(env), ctx);
  let payload = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  const watch = payload?.watches?.[0] || null;
  return {
    ok: response.ok && Boolean(watch),
    status: response.status,
    error: response.ok ? null : (payload?.error || `HTTP ${response.status}`),
    cached: payload?.cached ?? null,
    source: payload?.source || null,
    watch,
    properties: Array.isArray(watch?.properties) ? watch.properties : [],
  };
}

async function compareProviders(request, env, ctx) {
  if (!env.ADMIN_TOKEN) return jsonResponse({ error: 'ADMIN_TOKEN is not configured' }, 503);
  if (!isAuthorized(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await requestJson(request);
  if (!body) return jsonResponse({ error: 'Invalid JSON body' }, 400);
  if (Number(body?.rooms ?? 1) !== 1) {
    return jsonResponse({ error: 'Parity v1 supports exactly rooms=1' }, 400);
  }

  const [browser, serpapi] = await Promise.all([
    searchGoogleMapsHotels(env, browserRequest(body)),
    serpApiBaseline(env, ctx, body),
  ]);

  const parity = compareProviderResults(
    Array.isArray(browser.properties) ? browser.properties : [],
    Array.isArray(serpapi.properties) ? serpapi.properties : [],
    String(body.currency || 'TWD').toUpperCase(),
  );

  const bothZero = browser.ok
    && browser.provider_status === 'valid_zero'
    && serpapi.ok
    && serpapi.properties.length === 0;
  const noFalseZero = browser.provider_status !== 'valid_zero' || (serpapi.ok && serpapi.properties.length === 0);
  const priceApplicable = parity.matched_count > 0;
  const parityPass = browser.ok
    && serpapi.ok
    && noFalseZero
    && (bothZero || parity.gate.overlap_pass)
    && (bothZero || (priceApplicable && parity.gate.price_pass));

  return jsonResponse({
    provider_mode: 'shadow',
    promotion_allowed: false,
    parity_pass: parityPass,
    no_false_zero: noFalseZero,
    request: browserRequest(body),
    browser,
    serpapi: {
      ok: serpapi.ok,
      status: serpapi.status,
      error: serpapi.error,
      cached: serpapi.cached,
      source: serpapi.source,
      match_count: serpapi.properties.length,
      lowest_price: serpapi.properties.length
        ? Math.min(...serpapi.properties.map((row) => Number(row.nightly_price)).filter(Number.isFinite))
        : null,
      properties: serpapi.properties,
    },
    parity,
  });
}

async function augmentStatus(request, env, ctx) {
  const response = await monitorWorker.fetch(request, env, ctx);
  if (!response.ok) return response;
  let payload;
  try { payload = await response.json(); } catch { return response; }
  payload.browser_provider = {
    mode: 'shadow',
    browser_binding_configured: Boolean(env.BROWSER),
    normal_search_uses_browser: false,
    compare_endpoint: '/api/providers/compare',
    browser_only_endpoint: '/api/providers/google-maps-browser/search',
    rooms_supported: [1],
  };
  return jsonResponse(payload, response.status);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (url.pathname === '/api/providers/google-maps-browser/search' && request.method === 'POST') {
      return browserOnlySearch(request, env);
    }
    if (url.pathname === '/api/providers/compare' && request.method === 'POST') {
      return compareProviders(request, env, ctx);
    }
    if (url.pathname === '/api/status' && request.method === 'GET') {
      return augmentStatus(request, env, ctx);
    }
    return monitorWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return monitorWorker.scheduled(controller, env, ctx);
  },
};
