const BASE = (process.env.SNOW_API_BASE || 'https://snow-season-where-to-live-api.world4jason.workers.dev').replace(/\/$/, '');

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

console.log(`Testing ${BASE}\n`);

{
  const { response, body } = await jsonRequest('/health');
  ok(response.ok, '/health returns 2xx');
  ok(body?.ok === true, '/health reports ok=true');
}

{
  const { response, body } = await jsonRequest('/api/status');
  ok(response.ok, '/api/status returns 2xx');
  ok(body?.ok === true, '/api/status reports ok=true');
  ok(Number(body?.catalog_count) === 43, '/api/status exposes 43 practical lodging bases');
  ok(Number(body?.automatic_searches_per_run) === 5, '/api/status limits daily automatic searches to 5');
  ok(Array.isArray(body?.automatic_resort_ids) && body.automatic_resort_ids.length === 5, '/api/status exposes five automatic resort ids');
  ok(Number.isFinite(Number(body?.manual_searches_limit)), '/api/status exposes manual quota limit');
  if (body?.serpapi) {
    console.log(`INFO  SerpApi plan=${body.serpapi.plan_name ?? 'unknown'} usage=${body.serpapi.this_month_usage ?? '?'} left=${body.serpapi.total_searches_left ?? '?'}`);
  } else if (body?.serpapi_error) {
    console.warn(`WARN  SerpApi account status unavailable: ${body.serpapi_error}`);
  }
}

{
  const { response, body } = await jsonRequest('/api/latest');
  ok(response.ok, '/api/latest returns 2xx');
  ok(Array.isArray(body?.watches), '/api/latest has watches[]');
  ok(body.watches.length <= 5, '/api/latest contains only automatic monitoring results');
  console.log(`INFO  latest watches=${body.watches.length} checked_at=${body.checked_at ?? 'never'}`);
}

{
  const { response } = await jsonRequest('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resort_ids: ['sugadaira'],
      check_in: '2027-02-31',
      check_out: '2027-03-02',
      adults: 2,
      max_price_per_night: 6000,
    }),
  });
  ok(response.status === 400, '/api/search rejects invalid calendar dates');
}

{
  const { response, body } = await jsonRequest('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resort_ids: ['sugadaira'],
      check_in: '2027-01-15',
      check_out: '2027-01-18',
      adults: 2,
      max_price_per_night: 6000,
    }),
  });

  ok(response.ok, '/api/search extra-catalog request returns 2xx');
  ok(Array.isArray(body?.watches) && body.watches.length === 1, '/api/search returns requested extra lodging destination');

  const watch = body.watches[0];
  ok(watch?.id === 'sugadaira', '/api/search returns Sugadaira lodging base from extra catalog');
  ok(Array.isArray(watch?.ranking_tags) && watch.ranking_tags.includes('popularity'), 'Sugadaira carries ranking metadata');
  ok(Array.isArray(watch?.covers) && watch.covers.includes('Sugadaira Kogen Snow Resort'), 'Sugadaira carries resort coverage metadata');
  ok(watch?.check_in === '2027-01-15' && watch?.check_out === '2027-01-18', '/api/search preserves requested dates');
  ok(watch?.adults === 2, '/api/search preserves guest count');
  ok(watch?.max_price_per_night === 6000, '/api/search preserves nightly budget');
  ok(Array.isArray(watch?.properties), 'result has properties[]');
  ok(Number(watch?.match_count) === watch.properties.length, 'match_count matches returned property count');

  for (const property of watch.properties) {
    ok(Number(property.nightly_price) <= 6000, `${property.name}: price respects budget`);
    ok(typeof property.google_maps_url === 'string' && property.google_maps_url.startsWith('https://www.google.com/maps/search/?api=1'), `${property.name}: Google Maps URL is valid shape`);
    if (property.latitude != null || property.longitude != null) {
      ok(Number.isFinite(Number(property.latitude)) && Number.isFinite(Number(property.longitude)), `${property.name}: coordinates are numeric`);
    }
  }

  console.log(`INFO  Sugadaira live result count=${watch.match_count}, cached=${body.cached === true}`);
}

console.log('\nALL SMOKE TESTS PASSED');
