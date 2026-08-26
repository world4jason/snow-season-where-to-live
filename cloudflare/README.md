# Cloudflare Worker backend

This is the live backend for the GitHub Pages frontend. GitHub Actions is not used for hotel checks.

## Production Worker

```text
https://snow-season-where-to-live-api.world4jason.workers.dev
```

## Deploy / update

The Browser Run POC adds an npm dependency, so after pulling a version that changes `package.json` run `npm install` before deploy:

```bash
git pull --ff-only
cd cloudflare
npm install
npx wrangler deploy
node provider-unit-test.mjs
node smoke-test.mjs
```

`wrangler.jsonc` now includes a Cloudflare Browser Run binding named `BROWSER` and uses `worker-browser-poc.js` as the entrypoint. Normal `/api/search` remains SerpApi-backed during this POC.

## Secrets

Single SerpApi key:

```bash
npx wrangler secret put SERPAPI_KEY
```

Optional legitimate multi-key pool:

```bash
npx wrangler secret put SERPAPI_KEYS_JSON
```

Admin secret:

```bash
npx wrangler secret put ADMIN_TOKEN
```

The KV namespace, Browser Run binding, and public live-search rate limiter are configured in `wrangler.jsonc`.

## Google Maps Browser Run provider POC

This change follows the OpenSpec plan in:

```text
openspec/changes/add-google-maps-browser-provider/
```

The POC uses `@cloudflare/playwright` to open an exact Google Maps hotel-search URL, verify the encoded/loaded dates, adult count and nightly-price ceiling, extract priced hotel listings, and normalize them to the existing `properties[]` schema.

### Rollout state

Current mode is **shadow**:

- normal `/api/search` → SerpApi, unchanged
- daily monitor → existing monitor flow, unchanged
- Browser Run → admin-only test endpoint
- Browser vs SerpApi parity → admin-only comparison endpoint

Browser Run will not become the primary provider until the OpenSpec parity gate passes.

### Browser-only POC endpoint

`POST /api/providers/google-maps-browser/search`

Requires `ADMIN_TOKEN`.

Example:

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{
    "resort_id": "nozawa-jan",
    "google_maps_url": "<Google Maps hotel-search URL>",
    "check_in": "2027-01-15",
    "check_out": "2027-01-18",
    "adults": 2,
    "rooms": 1,
    "currency": "TWD",
    "max_price_per_night": 8800,
    "max_results": 20
  }' \
  https://snow-season-where-to-live-api.world4jason.workers.dev/api/providers/google-maps-browser/search
```

Typed browser statuses include:

- `success`
- `valid_zero`
- `unsupported_input`
- `query_state_mismatch`
- `query_state_unverified`
- `bot_blocked`
- `interstitial_blocked`
- `timeout`
- `extraction_contract_error`
- `navigation_error`

A missing result DOM is **not** treated as a successful zero-result search.

### Provider comparison endpoint

`POST /api/providers/compare`

Requires `ADMIN_TOKEN`. It runs the Browser Run provider and the current SerpApi provider for the same one-room query and reports:

- result counts
- top-10 normalized hotel-name overlap
- matched hotel pairs
- price deltas
- lowest prices
- parity gate result
- Browser Run elapsed time/diagnostics

This endpoint may consume a SerpApi search when the identical SerpApi query is not already cached.

### Rooms scope

Parity v1 supports exactly:

```text
rooms = 1
```

`rooms>1` is rejected as unsupported. Current SerpApi Google Hotels documentation does not expose a hotel room-count query parameter, so the POC does not fake multi-room behavior by changing guest count.

### Browser Run resource safety

The POC is admin-only and is not wired into Cron. It has an application deadline below Cloudflare's browser timeout and closes browser resources in `finally`. It detects CAPTCHA/unusual-traffic surfaces but does not implement CAPTCHA solving, stealth plugins, or proxy-evasion behavior.

## Optional live Browser Run smoke test

Default smoke testing does **not** spend Browser Run time because the browser endpoints require admin auth and are skipped.

To run the Browser Run POC intentionally:

```bash
SMOKE_ADMIN_TOKEN='<ADMIN_TOKEN>' node smoke-test.mjs
```

This uses the Nozawa Google Maps fixture and does not intentionally call SerpApi through the comparison endpoint.

To additionally compare Browser Run against SerpApi:

```bash
SMOKE_ADMIN_TOKEN='<ADMIN_TOKEN>' \
SMOKE_PROVIDER_COMPARE=1 \
node smoke-test.mjs
```

That comparison may consume one SerpApi search when its upstream cache is cold.

You can override the Maps fixture:

```bash
SMOKE_BROWSER_URL='<google maps hotel URL>' \
SMOKE_ADMIN_TOKEN='<ADMIN_TOKEN>' \
node smoke-test.mjs
```

## Search vs forced refresh

- **搜尋** — uses the app's 6-hour KV cache first. If it reaches SerpApi, SerpApi's own default one-hour cache remains allowed.
- **強制刷新** — only allowed for one lodging base at a time. It bypasses the app cache and sends `no_cache=true` to SerpApi.

A searched zero-result response means **zero properties within the nightly budget**, not "the destination has no rooms".

## Production verification

Default verification:

```bash
node provider-unit-test.mjs
node smoke-test.mjs
```

The default smoke test verifies existing production behavior plus:

- Browser provider reports shadow mode
- Browser Run is not used for normal search
- parity v1 exposes `rooms=1`
- browser-only and comparison endpoints require `ADMIN_TOKEN`

It deliberately skips a real forced SerpApi refresh by default. To test that path intentionally:

```bash
SMOKE_FORCE_REFRESH=1 node smoke-test.mjs
```

## Main endpoints

### `GET /health`

Basic Worker health check.

### `GET /api/latest`

Returns the most recent configured monitor result from KV.

### `POST /api/search`

Public search/refresh endpoint used by the GitHub Pages search bar. During the Browser Run POC this remains SerpApi-backed.

### `GET /api/status`

Returns backend/quota information without exposing API key values and now includes `browser_provider` shadow-mode metadata.

### `GET /api/monitor-summary`

Returns safe configured-monitor summary data.

### `GET|PUT /api/monitors`

Admin-only monitor configuration stored in KV.

### `POST /api/refresh`

Admin-only configured-monitor refresh.

## Schedule

```text
20 0 * * *
```

Cloudflare Cron uses UTC, so this is **08:20 Taiwan time**.

## KV keys

- `latest` — most recent configured-monitor result.
- `monitor-config:v1` — monitor configuration.
- `geo:v2:<watch-id>:<center-query>` — cached reference-center geocode.
- `manual:<watch-id>:<check-in>:<check-out>:<adults>:<budget>` — 6-hour live-search cache.
- `manual-serp-usage:<YYYY-MM>` — conservative public live-search/forced-refresh counter.
- `serpapi-pool-status:v1` — short-lived safe account/quota status cache.
- `serpapi-key-cursor:v1` — round-robin cursor; contains no API key.

## Frontend connection

`/runtime.js` points the GitHub Pages frontend at this Worker. The browser never receives `SERPAPI_KEY`, `SERPAPI_KEYS_JSON`, or `ADMIN_TOKEN`.
