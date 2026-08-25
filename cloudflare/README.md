# Cloudflare Worker backend

This replaces the GitHub Actions scheduler. GitHub Pages remains the frontend.

## One-time deployment

Prerequisites: Node.js 18+ and a Cloudflare account.

```bash
cd cloudflare
npx wrangler login
npx wrangler kv namespace create CACHE
```

Copy the returned namespace ID into `wrangler.jsonc` and replace:

```text
REPLACE_WITH_KV_NAMESPACE_ID
```

Add secrets (they are not committed to GitHub):

```bash
npx wrangler secret put SERPAPI_KEY
npx wrangler secret put ADMIN_TOKEN
```

Use any long random value for `ADMIN_TOKEN`.

Deploy:

```bash
npx wrangler deploy
```

Wrangler will print a URL similar to:

```text
https://snow-season-where-to-live-api.<your-workers-subdomain>.workers.dev
```

## First refresh

Run once after deployment:

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://snow-season-where-to-live-api.<your-workers-subdomain>.workers.dev/api/refresh
```

Then verify:

```bash
curl https://snow-season-where-to-live-api.<your-workers-subdomain>.workers.dev/api/latest
```

## Connect GitHub Pages

Edit `/runtime.js` and set:

```js
window.SNOW_API_BASE = 'https://snow-season-where-to-live-api.<your-workers-subdomain>.workers.dev';
```

The existing frontend will then read `/api/latest` from the Worker instead of `data/latest.json`.

## Schedule

`wrangler.jsonc` contains:

```text
20 0 * * *
```

That runs once daily at 00:20 UTC (08:20 Taiwan time).

## Storage

KV binding `CACHE` stores:

- `latest`: current hotel-search payload used by the website.
- `geo:<watch-id>`: cached OpenStreetMap/Nominatim geocoding results, so resort centers are not geocoded every day.

## Endpoints

- `GET /health` — health check.
- `GET /api/latest` — public, read-only latest results.
- `POST /api/refresh` — protected by `ADMIN_TOKEN`, manually refreshes all watches.

The SerpApi key is available only to the Worker as a Cloudflare secret and is never sent to the browser.
