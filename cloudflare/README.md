# Cloudflare Worker backend

This is the live backend for the GitHub Pages frontend. GitHub Actions is not used.

## Production Worker

```text
https://snow-season-where-to-live-api.world4jason.workers.dev
```

## Deploy / update

From the repository:

```bash
git pull --ff-only
cd cloudflare
npx wrangler deploy
```

## SerpApi secrets

The existing single-key setup continues to work:

```bash
npx wrangler secret put SERPAPI_KEY
```

Optional multi-key pool:

```bash
npx wrangler secret put SERPAPI_KEYS_JSON
```

Value example:

```json
[
  {"name":"primary","key":"..."},
  {"name":"backup","key":"..."}
]
```

The Worker uses the free SerpApi Account API to check pool health/quota, then round-robins available keys and fails over when a key is unavailable/exhausted. Key values are never returned to the browser.

Important: SerpApi Team Management supports multiple API keys under one shared account, but searches, plan, and billing are shared at the account level. Multiple keys from the same account therefore do **not** multiply the monthly quota; they are useful for isolation, tracking, and failover. Do not use separate free accounts as a quota-evasion mechanism.

Admin secret:

```bash
npx wrangler secret put ADMIN_TOKEN
```

The KV namespace and public live-search rate limiter are configured in `wrangler.jsonc`.

## Search vs forced refresh

The web UI now has two distinct actions:

- **搜尋** — uses the app's 6-hour KV cache first. If it reaches SerpApi, SerpApi's own default 1-hour cache remains allowed; cached SerpApi searches are free.
- **強制刷新** — only allowed for one lodging base at a time. It bypasses the app cache and sends `no_cache=true` to SerpApi, intentionally requesting fresh Google Hotels data. A successful fresh request can consume one SerpApi search credit.

This separation makes the cost semantics explicit instead of making every click look like a refresh.

## Production verification

After every Worker deployment run:

```bash
node smoke-test.mjs
```

The default smoke test verifies health, key-pool status, the 48-base catalog, the 5-base automatic-monitoring limit, cached latest data, strict invalid-date rejection, forced-refresh quota protection, one normal Sugadaira search, result schema, budget enforcement, coordinates, and Google Maps URLs.

It deliberately skips a real forced refresh by default. To test that path intentionally:

```bash
SMOKE_FORCE_REFRESH=1 node smoke-test.mjs
```

## Endpoints

### `GET /health`

Basic Worker health check.

### `GET /api/latest`

Returns the most recent daily cached result from KV. It contains only the five `auto_monitor` lodging bases.

### `POST /api/search`

Public search/refresh endpoint used by the GitHub Pages search bar.

Normal cache-friendly search:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    "resort_ids": ["sugadaira"],
    "check_in": "2027-01-15",
    "check_out": "2027-01-18",
    "adults": 2,
    "max_price_per_night": 6000,
    "force_refresh": false
  }' \
  https://snow-season-where-to-live-api.world4jason.workers.dev/api/search
```

Forced refresh:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    "resort_ids": ["sugadaira"],
    "check_in": "2027-01-15",
    "check_out": "2027-01-18",
    "adults": 2,
    "max_price_per_night": 6000,
    "force_refresh": true
  }' \
  https://snow-season-where-to-live-api.world4jason.workers.dev/api/search
```

For quota safety, forced refresh accepts exactly one lodging base per request. `resort_ids: "all"` continues to mean the five `auto_monitor` bases for normal search, not every catalog entry.

Validation:

- stay: 1–14 valid calendar nights
- adults: 1–6
- nightly budget: TWD 500–30,000

Protection:

- same lodging base + dates + adults + budget is cached in KV for 6 hours
- daily refresh seeds the same cache for default query conditions
- public cache-miss/forced SerpApi calls are conservatively capped at 80/month by the app
- Worker Rate Limiting binding protects rapid repeated calls
- forced refresh is limited to one lodging base at a time

### `GET /api/status`

Returns backend quota information without exposing API keys. It includes:

- catalog size
- automatic-monitoring count
- manual search budget
- safe per-key SerpApi health/remaining-quota metadata
- whether multiple configured keys appear to share one SerpApi account quota

The SerpApi Account API itself is free and does not consume search quota.

### `POST /api/refresh`

Protected scheduled-style refresh for the five configured `auto_monitor` lodging bases:

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://snow-season-where-to-live-api.world4jason.workers.dev/api/refresh
```

It does **not** query all catalog lodging bases.

## Schedule

`wrangler.jsonc` contains:

```text
20 0 * * *
```

Cloudflare Cron runs in UTC, so this is **08:20 Taiwan time**.

## KV keys

- `latest` — most recent daily five-base automatic-monitoring result.
- `geo:v2:<watch-id>:<center-query>` — cached resort/search-center geocode.
- `manual:<watch-id>:<check-in>:<check-out>:<adults>:<budget>` — 6-hour live-search cache.
- `manual-serp-usage:<YYYY-MM>` — conservative public live-search/forced-refresh counter.
- `serpapi-pool-status:v1` — short-lived safe account/quota status cache.
- `serpapi-key-cursor:v1` — round-robin cursor; contains no API key.

## Catalog sources

- `config/watches.json` — primary lodging bases, including Hakuba/Shiga special handling and five daily monitors.
- `config/extra-watches.json` — additional lodging bases from the union of ranking/discovery lists.
- `config/rankings.json` — normalized ranking definitions, sources, and caveats.
- `config/ranking-tags-by-id.json` — ranking-label overlays for core lodging bases.

## Frontend connection

`/runtime.js` points the GitHub Pages frontend at this Worker. The browser never receives `SERPAPI_KEY`, `SERPAPI_KEYS_JSON`, or `ADMIN_TOKEN`.
