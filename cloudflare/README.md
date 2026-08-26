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

Secrets are stored in Cloudflare and are not committed:

```bash
npx wrangler secret put SERPAPI_KEY
npx wrangler secret put ADMIN_TOKEN
```

The KV namespace and public live-search rate limiter are configured in `wrangler.jsonc`.

## Production verification

After every Worker deployment run:

```bash
node smoke-test.mjs
```

The smoke test verifies health, SerpApi/account status, the 48-base catalog, the 5-base automatic-monitoring limit, cached latest data, strict invalid-date rejection, one real Sugadaira search from the expanded catalog, result schema, budget enforcement, coordinates, and Google Maps URLs. The real-search part uses at most one SerpApi search when its 6-hour cache is cold.

## Endpoints

### `GET /health`

Basic Worker health check.

### `GET /api/latest`

Returns the most recent daily cached result from KV. It contains only the five `auto_monitor` lodging bases.

### `POST /api/search`

Public live search used by the GitHub Pages search bar.

Example:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    "resort_ids": ["sugadaira"],
    "check_in": "2027-01-15",
    "check_out": "2027-01-18",
    "adults": 2,
    "max_price_per_night": 6000
  }' \
  https://snow-season-where-to-live-api.world4jason.workers.dev/api/search
```

`resort_ids` can also be the string `"all"`; for quota safety, `"all"` means the five `auto_monitor` bases, not every catalog entry.

Validation:

- stay: 1–14 valid calendar nights
- adults: 1–6
- nightly budget: TWD 500–30,000

Protection:

- same lodging base + dates + adults + budget is cached in KV for 6 hours
- the daily refresh seeds the same cache for default query conditions
- public cache-miss SerpApi calls are capped at 80/month
- Worker Rate Limiting binding protects rapid repeated calls

### `GET /api/status`

Returns backend/SerpApi quota information without exposing the API key. It also reports catalog size and automatic-monitoring count. The SerpApi Account API call itself is free and does not consume search quota.

### `POST /api/refresh`

Protected refresh for the five configured `auto_monitor` lodging bases:

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://snow-season-where-to-live-api.world4jason.workers.dev/api/refresh
```

It does **not** query all 48 lodging bases, which keeps the free SerpApi budget under control.

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
- `manual-serp-usage:<YYYY-MM>` — public live-search SerpApi cache-miss counter.

## Catalog sources

- `config/watches.json` — primary lodging bases, including Hakuba/Shiga special handling and five daily monitors.
- `config/extra-watches.json` — additional lodging bases discovered from longest-run, popularity, scale, and current course-area ranking sets.
- `config/rankings.json` — normalized ranking definitions, sources, and caveats.

## Frontend connection

`/runtime.js` points the GitHub Pages frontend at this Worker. The browser never receives `SERPAPI_KEY` or `ADMIN_TOKEN`.
