# Snow Season — Where to Live

A ski-accommodation search and monitoring app built on **GitHub Pages + Cloudflare Workers/KV + SerpApi Google Hotels**.

## Live architecture

```text
GitHub Pages (UI)
  ├─ resort tabs
  ├─ check-in / check-out date pickers
  ├─ guest count
  ├─ nightly budget
  ├─ price / rating / distance / amenity filters
  ├─ hotel list
  └─ Leaflet + OpenStreetMap map
          ↓
Cloudflare Worker
  ├─ GET  /api/latest
  ├─ POST /api/search
  ├─ GET  /api/status
  ├─ POST /api/refresh (ADMIN_TOKEN)
  ├─ daily Cron Trigger
  └─ Cloudflare KV cache
          ↓
SerpApi Google Hotels
```

GitHub Actions is **not** used.

## Current ski areas

- 安比高原 — Appi Kogen
- 越後湯澤 — Echigo Yuzawa
- 斑尾高原 — Madarao Kogen
- 札幌手稻 — Sapporo Teine
- 野澤溫泉 — Nozawa Onsen

Edit `config/watches.json` to add/remove defaults.

## Implemented UI behavior

- Resort tabs actually change the displayed hotels and map markers.
- Check-in/check-out are real date inputs.
- Guest count is selectable from 1–6 adults.
- Nightly budget changes the upstream SerpApi search, not only the local filter.
- Search results can be sorted by price, rating, or straight-line distance from the resort/search center.
- Local filters work for price, rating, distance, free cancellation, breakfast included, and ski-in/ski-out when source data explicitly provides those attributes.
- Hotel cards and map price markers are synchronized.
- Every returned hotel has a Google Maps link.
- Hotel images use SerpApi `thumbnail` and fall back to `images[].thumbnail` / `original_image`.
- Mobile layout switches between hotel list and map.

## Query/cost protection

The SerpApi Free plan currently provides 250 searches/month. This project uses:

- Daily automatic refresh: 5 resort searches/day → at most 155 searches in a 31-day month.
- Public manual live-search budget: at most 80 cache-miss resort searches/month.
- Same resort + dates + adults + budget is cached for 6 hours.
- Cloudflare Worker rate limiter protects `/api/search` from rapid repeated calls.

This keeps expected automatic + public manual use below the free-plan search limit. Admin-triggered `/api/refresh` calls are intentionally not included in that public quota, so use them sparingly.

## Backend deployment

See [`cloudflare/README.md`](cloudflare/README.md).

The production Worker currently used by `runtime.js` is:

```text
https://snow-season-where-to-live-api.world4jason.workers.dev
```

## Schedule

The Worker runs every day at:

```text
20 0 * * *
```

Cloudflare Cron uses UTC, so this is **08:20 Taiwan time**.

## Data notes

- Search results are date-specific Google Hotels results returned through SerpApi.
- A returned property with a nightly price is treated as having a sellable price for that query at that moment; it is not a guarantee that every booking channel has availability.
- Distance is straight-line distance from the geocoded resort/search center, not driving/transit distance.
- Free cancellation, included breakfast, and ski-in/ski-out are shown only when the source data explicitly indicates them.
