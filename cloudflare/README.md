# Cloudflare Worker backend

This is the live backend for the GitHub Pages frontend. GitHub Actions is not used.

## Production Worker

```text
https://snow-season-where-to-live-api.world4jason.workers.dev
```

## Deploy / update

From the repository:

```bash
cd cloudflare
npx wrangler login
npx wrangler deploy
```

Secrets are stored in Cloudflare and are not committed:

```bash
npx wrangler secret put SERPAPI_KEY
npx wrangler secret put ADMIN_TOKEN
```

The KV namespace is already configured in `wrangler.jsonc`.

## Endpoints

### `GET /health`

Basic Worker health check.

### `GET /api/latest`

Returns the most recent daily cached result from KV.

### `POST /api/search`

Public live search used by the GitHub Pages search bar.

Example:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    "resort_ids": ["nozawa-jan"],
    "check_in": "2027-01-15",
    "check_out": "2027-01-18",
    "adults": 2,
    "max_price_per_night": 6000
  }' \
  https://snow-season-where-to-live-api.world4jason.workers.dev/api/search
```

`resort_ids` can also be the string `"all"`.

Validation:

- stay: 1–14 nights
- adults: 1–6
- nightly budget: TWD 500–30,000

Protection:

- same resort + dates + adults + budget is cached in KV for 6 hours
- public cache-miss SerpApi calls are capped at 80/month
- Worker Rate Limiting binding protects rapid repeated calls

### `GET /api/status`

Returns backend/SerpApi quota information without exposing the API key.

### `POST /api/refresh`

Protected full refresh for all configured ski areas:

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://snow-season-where-to-live-api.world4jason.workers.dev/api/refresh
```

Use this sparingly because it consumes one SerpApi search per configured resort.

## Schedule

`wrangler.jsonc` contains:

```text
20 0 * * *
```

Cloudflare Cron runs in UTC, so this is **08:20 Taiwan time**.

## KV keys

- `latest` — most recent daily full result.
- `geo:<watch-id>` — cached resort/search-center geocode.
- `manual:<watch-id>:<check-in>:<check-out>:<adults>:<budget>` — 6-hour live-search cache.
- `manual-serp-usage:<YYYY-MM>` — public live-search SerpApi cache-miss counter.

## Frontend connection

`/runtime.js` points the GitHub Pages frontend at this Worker. The browser never receives `SERPAPI_KEY` or `ADMIN_TOKEN`.
