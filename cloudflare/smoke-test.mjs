const BASE = (process.env.SNOW_API_BASE || 'https://snow-season-where-to-live-api.world4jason.workers.dev').replace(/\/$/, '');
const FORCE_REAL_REFRESH = process.env.SMOKE_FORCE_REFRESH === '1';

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
  const { response, body } = await jsonRequest('/health');
  ok(response.ok, '/health returns 2xx');
  ok(body?.ok === true, '/health reports ok=true');
}

let monitorSummary;
{
  const { response, body } = await jsonRequest('/api/monitor-summary');
  ok(response.ok, '/api/monitor-summary returns 2xx');
  ok(Number(body?.enabled_count) >= 0 && Number(body?.enabled_count) <= 5, '/api/monitor-summary enforces 0–5 enabled monitors');
  ok(Number(body?.max_enabled) === 5, '/api/monitor-summary exposes five-monitor free-quota policy');
  ok(Array.isArray(body?.enabled_resort_ids) && body.enabled_resort_ids.length === Number(body.enabled_count), '/api/monitor-summary exposes enabled lodging-area ids');
  ok(Number(body?.estimated_31_day_max_searches) === Number(body.enabled_count) * 31, '/api/monitor-summary estimates monthly automatic usage');
  monitorSummary = body;
  console.log(`INFO  monitors=${body.enabled_count}/5 source=${body.source} estimated31=${body.estimated_31_day_max_searches}`);
}

{
  const { response } = await jsonRequest('/api/monitors');
  ok(response.status === 401 || response.status === 503, '/api/monitors requires ADMIN_TOKEN authentication');
}

{
  const { response, body } = await jsonRequest('/api/status');
  ok(response.ok, '/api/status returns 2xx');
  ok(body?.ok === true, '/api/status reports ok=true');
  ok(Number(body?.catalog_count) === 46, '/api/status exposes 46 active winter lodging bases');
  ok(Number(body?.catalog_count_raw) === 48, '/api/status preserves raw ranking-union catalog count');
  ok(Array.isArray(body?.excluded_resort_ids) && body.excluded_resort_ids.includes('senjojiki') && body.excluded_resort_ids.includes('okutadami'), '/api/status exposes the two special-season exclusions');
  ok(Number(body?.estimated_full_catalog_refresh_cost) === 46, '/api/status estimates full active-catalog refresh cost at 46 searches');
  ok(Number(body?.automatic_searches_per_run) === Number(monitorSummary.enabled_count), '/api/status automatic count follows configurable monitor settings');
  ok(Number(body?.estimated_monitored_refresh_cost) === Number(monitorSummary.enabled_count), '/api/status monitored refresh cost follows monitor settings');
  ok(Number(body?.estimated_monthly_automatic_max) === Number(monitorSummary.enabled_count) * 31, '/api/status exposes 31-day automatic max');
  ok(Array.isArray(body?.automatic_resort_ids) && body.automatic_resort_ids.length === Number(monitorSummary.enabled_count), '/api/status exposes configured automatic lodging areas');
  ok(Number.isFinite(Number(body?.manual_searches_limit)), '/api/status exposes manual quota limit');
  ok(Number(body?.serpapi_pool?.key_count) >= 1, '/api/status exposes at least one configured SerpApi key');
  ok(Array.isArray(body?.serpapi_pool?.keys), '/api/status exposes safe key-pool health metadata');

  if (body?.serpapi) {
    console.log(`INFO  SerpApi plan=${body.serpapi.plan_name ?? 'unknown'} usage=${body.serpapi.this_month_usage ?? '?'} left=${body.serpapi.total_searches_left ?? '?'}`);
  }
}

{
  const { response, body } = await jsonRequest('/api/latest');
  ok(response.ok, '/api/latest returns 2xx');
  ok(Array.isArray(body?.watches), '/api/latest has watches[]');
  ok(body.watches.length <= 5, '/api/latest never contains more than five configured monitor results');
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
  ok(Array.isArray(body?.watches) && body.watches.length === 1, '/api/search returns requested lodging destination');
  ok(body?.force_refresh === false, 'normal search reports force_refresh=false');

  const watch = body.watches[0];
  ok(watch?.id === 'sugadaira', '/api/search returns Sugadaira lodging base');
  ok(Array.isArray(watch?.ranking_tags) && watch.ranking_tags.includes('popularity'), 'Sugadaira carries ranking tag metadata');
  ok(watch?.check_in === '2027-01-15' && watch?.check_out === '2027-01-18', '/api/search preserves requested dates');
  ok(watch?.adults === 2, '/api/search preserves guest count');
  ok(watch?.max_price_per_night === 6000, '/api/search preserves nightly budget');
  ok(Array.isArray(watch?.properties), 'result has properties[]');
  ok(Number(watch?.match_count) === watch.properties.length, 'match_count matches returned property count');
  ok(typeof watch?.google_maps_search_url === 'string' && watch.google_maps_search_url.startsWith('https://www.google.com/maps/search/?api=1'), 'search result exposes lodging-area Google Maps reference');

  for (const property of watch.properties) {
    ok(Number(property.nightly_price) <= 6000, `${property.name}: price respects per-night budget`);
    ok(typeof property.google_maps_url === 'string' && property.google_maps_url.startsWith('https://www.google.com/maps/search/?api=1'), `${property.name}: Google Maps URL is valid shape`);
  }
  console.log(`INFO  Sugadaira results=${watch.match_count}, cached=${body.cached === true}, status=${watch.search_status ?? 'unknown'}`);
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
