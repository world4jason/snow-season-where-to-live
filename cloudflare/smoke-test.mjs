const BASE = (process.env.SNOW_API_BASE || 'https://snow-season-where-to-live-api.world4jason.workers.dev').replace(/\/$/, '');
const FORCE_REAL_REFRESH = process.env.SMOKE_FORCE_REFRESH === '1';

await import('../google-maps-url.js');
const MapsUrl = globalThis.GoogleMapsHotelUrl;

const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS  ${message}`);
};

async function jsonRequest(path, init) {
  const response = await fetch(`${BASE}${path}`, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${path}: non-JSON response (HTTP ${response.status})`);
  }
  return { response, body };
}

const searchBody = (overrides = {}) => ({
  resort_ids: ['sugadaira'],
  check_in: '2027-01-15',
  check_out: '2027-01-18',
  adults: 2,
  max_price_per_night: 6000,
  ...overrides,
});

console.log(`Testing ${BASE}\n`);

{
  const parsed = MapsUrl.parse('https://www.google.com/maps/search/%E9%A3%AF%E5%BA%97/@36.9219703,138.4445113,15.02z/data=!4m8!2m7!5m5!5m3!1s2027-01-15!4m1!1i2!9i8800!6e3?entry=ttu');
  ok(parsed.check_in === '2027-01-15', 'Google Maps parser extracts hotel check-in date');
  ok(parsed.adults === 2, 'Google Maps parser extracts observed guest-count encoding');
  ok(parsed.max_price_per_night === 8800, 'Google Maps parser extracts price filter');
  ok(Math.abs(parsed.latitude - 36.9219703) < 1e-8 && Math.abs(parsed.longitude - 138.4445113) < 1e-8, 'Google Maps parser extracts viewport center');
}

{
  const parsed = MapsUrl.parse('https://www.google.com/maps/search/%E9%A3%AF%E5%BA%97/@36.9198798,138.4227535,13z/data=!4m9!2m8!5m6!5m4!1s2027-01-14!2i3!4m1!1i2!9i73750!6e3?entry=ttu');
  ok(parsed.nights === 3 && parsed.check_out === '2027-01-17', 'Google Maps parser derives checkout when URL encodes stay length');
  const synced = MapsUrl.sync(parsed.original_url, {
    check_in: '2027-01-20',
    check_out: '2027-01-24',
    adults: 3,
    max_price_per_night: 9000,
  });
  const reparsed = MapsUrl.parse(synced.url);
  ok(reparsed.check_in === '2027-01-20' && reparsed.nights === 4 && reparsed.check_out === '2027-01-24', 'Google Maps URL sync updates dates and stay length');
  ok(reparsed.adults === 3 && reparsed.max_price_per_night === 9000, 'Google Maps URL sync updates guests and price when encoded');
}

{
  const { response, body } = await jsonRequest('/health');
  ok(response.ok, '/health returns 2xx');
  ok(body?.ok === true, '/health reports ok=true');
}

{
  const { response, body } = await jsonRequest('/api/status');
  ok(response.ok, '/api/status returns 2xx');
  ok(body?.ok === true, '/api/status reports ok=true');
  ok(Number(body?.catalog_count) === 46, '/api/status exposes 46 active winter lodging bases');
  ok(Number(body?.catalog_count_raw) === 48, '/api/status preserves raw ranking-union catalog count');
  ok(Array.isArray(body?.excluded_resort_ids) && body.excluded_resort_ids.includes('senjojiki') && body.excluded_resort_ids.includes('okutadami'), '/api/status exposes the two special-season exclusions');
  ok(Number(body?.estimated_full_catalog_refresh_cost) === 46, '/api/status estimates full active-catalog refresh cost at 46 searches');
  ok(Number(body?.automatic_searches_per_run) >= 0 && Number(body?.automatic_searches_per_run) <= 5, '/api/status limits configured daily automatic searches to 0–5');
  ok(Number(body?.estimated_monitored_refresh_cost) === Number(body?.automatic_searches_per_run), '/api/status monitor cost follows configured enabled count');
  ok(Array.isArray(body?.automatic_resort_ids) && body.automatic_resort_ids.length === Number(body?.automatic_searches_per_run), '/api/status exposes configured automatic resort ids');
  ok(Number.isFinite(Number(body?.manual_searches_limit)), '/api/status exposes manual quota limit');
  ok(Number(body?.serpapi_pool?.key_count) >= 1, '/api/status exposes at least one configured SerpApi key');
  ok(Array.isArray(body?.serpapi_pool?.keys), '/api/status exposes safe key-pool health metadata');
  ok(Number(body?.monitor_google_maps_reference_count ?? 0) >= 0, '/api/status exposes Google Maps reference count');

  if (body?.serpapi) {
    console.log(`INFO  SerpApi plan=${body.serpapi.plan_name ?? 'unknown'} usage=${body.serpapi.this_month_usage ?? '?'} left=${body.serpapi.total_searches_left ?? '?'}`);
  }
  console.log(`INFO  configured monitors=${body?.automatic_searches_per_run ?? 0}, Maps refs=${body?.monitor_google_maps_reference_count ?? 0}`);
}

{
  const { response, body } = await jsonRequest('/api/monitor-summary');
  ok(response.ok, '/api/monitor-summary returns 2xx');
  ok(Number(body?.enabled_count) >= 0 && Number(body?.enabled_count) <= 5, '/api/monitor-summary exposes 0–5 enabled monitors');
  ok(Number(body?.estimated_31_day_max_searches) === Number(body?.enabled_count) * 31, '/api/monitor-summary estimates 31-day max cost');
  ok(Number(body?.google_maps_reference_count ?? 0) >= 0, '/api/monitor-summary safely exposes only Maps reference count');
}

{
  const { response } = await jsonRequest('/api/monitors');
  ok([401, 503].includes(response.status), '/api/monitors does not expose private monitor conditions without ADMIN_TOKEN');
}

{
  const { response, body } = await jsonRequest('/api/latest');
  ok(response.ok, '/api/latest returns 2xx');
  ok(Array.isArray(body?.watches), '/api/latest has watches[]');
  ok(body.watches.length <= 5, '/api/latest contains at most five configured monitoring results');
  console.log(`INFO  latest watches=${body.watches.length} checked_at=${body.checked_at ?? 'never'}`);
}

{
  const { response } = await jsonRequest('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(searchBody({ check_in: '2027-02-31', check_out: '2027-03-02' })),
  });
  ok(response.status === 400, '/api/search rejects invalid calendar dates');
}

{
  const { response, body } = await jsonRequest('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(searchBody({ resort_ids: ['senjojiki'] })),
  });
  ok(response.status === 400, '/api/search rejects excluded spring-only Senjojiki');
  ok(Array.isArray(body?.excluded_resort_ids) && body.excluded_resort_ids.includes('senjojiki'), 'excluded search response identifies Senjojiki');
}

{
  const { response } = await jsonRequest('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(searchBody({ resort_ids: ['sugadaira', 'nozawa-jan'], force_refresh: true })),
  });
  ok(response.status === 400, 'forced refresh rejects multi-area requests to protect quota');
}

{
  const { response, body } = await jsonRequest('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(searchBody()),
  });

  ok(response.ok, '/api/search cached-capable request returns 2xx');
  ok(Array.isArray(body?.watches) && body.watches.length === 1, '/api/search returns requested extra lodging destination');
  ok(body?.force_refresh === false, 'normal search reports force_refresh=false');

  const watch = body.watches[0];
  ok(watch?.id === 'sugadaira', '/api/search returns Sugadaira lodging base from union catalog');
  ok(Array.isArray(watch?.ranking_tags) && watch.ranking_tags.includes('popularity'), 'Sugadaira carries Top-20 ranking tag metadata');
  ok(Array.isArray(watch?.covers) && watch.covers.includes('Sugadaira Kogen Snow Resort'), 'Sugadaira carries resort coverage metadata');
  ok(watch?.check_in === '2027-01-15' && watch?.check_out === '2027-01-18', '/api/search preserves requested dates');
  ok(watch?.adults === 2, '/api/search preserves guest count');
  ok(watch?.max_price_per_night === 6000, '/api/search preserves nightly budget');
  ok(Array.isArray(watch?.properties), 'result has properties[]');
  ok(Number(watch?.match_count) === watch.properties.length, 'match_count matches returned property count');
  ok(typeof watch?.google_maps_search_url === 'string' && watch.google_maps_search_url.startsWith('https://www.google.com/maps/search/?api=1'), 'search result exposes lodging-area Google Maps reference');

  for (const property of watch.properties) {
    ok(Number(property.nightly_price) <= 6000, `${property.name}: price respects per-night budget`);
    ok(typeof property.google_maps_url === 'string' && property.google_maps_url.startsWith('https://www.google.com/maps/search/?api=1'), `${property.name}: Google Maps URL is valid shape`);
    if (property.latitude != null || property.longitude != null) {
      ok(Number.isFinite(Number(property.latitude)) && Number.isFinite(Number(property.longitude)), `${property.name}: coordinates are numeric`);
    }
  }

  console.log(`INFO  Sugadaira live result count=${watch.match_count}, cached=${body.cached === true}, search_status=${watch.search_status ?? 'unknown'}`);
}

if (FORCE_REAL_REFRESH) {
  const { response, body } = await jsonRequest('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(searchBody({ force_refresh: true })),
  });
  ok(response.ok, 'optional real forced refresh returns 2xx');
  ok(body?.force_refresh === true && body?.cached === false, 'forced refresh bypasses local cache');
  console.log('INFO  optional forced refresh executed; this intentionally requests fresh SerpApi data.');
} else {
  console.log('INFO  skipped real forced refresh; set SMOKE_FORCE_REFRESH=1 to test it intentionally.');
}

console.log('\nALL SMOKE TESTS PASSED');
