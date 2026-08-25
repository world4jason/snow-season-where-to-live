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
  ok(Number.isFinite(Number(body?.automatic_searches_per_run)), '/api/status exposes automatic search count');
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
  console.log(`INFO  latest watches=${body.watches.length} checked_at=${body.checked_at ?? 'never'}`);
}

{
  const { response } = await jsonRequest('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resort_ids: ['teine-jan'],
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
      resort_ids: ['teine-jan'],
      check_in: '2027-01-15',
      check_out: '2027-01-18',
      adults: 2,
      max_price_per_night: 6000,
    }),
  });

  ok(response.ok, '/api/search valid request returns 2xx');
  ok(Array.isArray(body?.watches) && body.watches.length === 1, '/api/search returns requested resort');

  const watch = body.watches[0];
  ok(watch?.id === 'teine-jan', '/api/search returns Sapporo Teine');
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

  console.log(`INFO  live result count=${watch.match_count}, cached=${body.cached === true}`);
}

console.log('\nALL SMOKE TESTS PASSED');
