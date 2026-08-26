# Snow Season — Where to Live

A ski-accommodation search and monitoring app built on **GitHub Pages + Cloudflare Workers/KV + SerpApi Google Hotels**.

## Live architecture

```text
GitHub Pages (UI)
  ├─ destination browser
  ├─ booking / ski-resort-info tabs
  ├─ check-in / check-out date pickers
  ├─ guest count + nightly budget
  ├─ hotel filters + hotel/map results
  ├─ SerpApi quota badge
  └─ concise ski-resort profile (trail map / ticket / official link / size / tags / access)
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

GitHub Actions is **not** used for the backend.

## Lodging catalog

The source catalog is the practical lodging-base union of several Japan ski-area discovery/ranking dimensions rather than one ambiguous "Top 20":

- single longest continuous run
- 2025–26 Weathernews popularity/attention ranking
- current Tabiris published course-area ranking
- a representative large-resort discovery set based on linked piste length and course count

Ranking membership is metadata/tagging only; it does not decide whether a lodging base is searchable.

Special handling:

- **Hakuba Valley:** split into Hakuba Village, Otari/Tsugaike, and Omachi lodging bases.
- **Shiga Kogen:** split into Central, East, West, and South lodging bases.
- **Yuzawa / Minamiuonuma:** grouped as one travel area in the destination browser while preserving separate lodging bases such as Echigo-Yuzawa, Iwappara, Kandatsu, Maiko, and Mt. Naeba.
- **Sapporo Teine:** Sapporo is used for hotel discovery while the ski area remains the map/distance context.
- **Special-season exclusions:** `config/excluded-resorts.json` removes destinations that are poor fits for a normal continuous winter lodging search. Senjojiki and Okutadami Maruyama are currently excluded.

The raw ranking union contains **48 source lodging bases**; the active normal-winter catalog exposes **46 lodging bases**. `/api/status` reports both counts and rejects manual API searches for excluded destinations.

## Ski resort info tab

The UI has two modes:

- **住宿** — live hotel availability, price, filters, Google Maps, and map markers.
- **雪場簡介** — concise ski context for the selected lodging base:
  - interactive ski-piste / lift map using OpenSnowMap
  - official trail-map link where configured
  - current/most-relevant official ticket information
  - official website link(s)
  - size / course-scale summary
  - ranking tags
  - one-line transit chain, with Google search for the detailed route

For multi-resort areas such as Hakuba, Shiga, Niseko, and Mt. Naeba, the profile uses the official regional/resort-network site rather than pretending every lift area is a separate town.

Profile metadata lives in `config/resort-profiles.json`; official trail-map links live in `config/trail-map-links.json`.

## Implemented booking behavior

- Destination Browser supports region, ranking/status filters, text search, gallery/list views, and practical travel-area grouping.
- Check-in/check-out are real date inputs.
- Guest count is selectable from 1–6 adults.
- Nightly budget changes the upstream SerpApi `max_price`; returned properties are evaluated using per-night price, not stay total.
- Currency is consistently TWD / `NT$`.
- Search and force-refresh are separate: normal search prefers the 6-hour KV cache; force refresh is limited to one selected lodging base and bypasses cache.
- Search results can be sorted by price, rating, or straight-line distance.
- Local filters work for price, rating, distance, free cancellation, breakfast included, and ski-in/ski-out when source data explicitly provides those attributes.
- Hotel cards and map price markers are synchronized.
- Every returned hotel has a Google Maps link.
- Never-searched destinations display **尚未查詢**.
- A searched destination with zero in-budget results displays **每晚預算內 0 間**, not "no rooms"; it links to a lodging-area Google Maps search and can show SerpApi `non_matching_properties` as over-budget references when available.

## Query/cost protection

The current free-plan design targets a 250-search monthly allowance:

- Daily automatic refresh: only 5 core lodging areas → at most 155 deliberate searches in a 31-day month.
- Public manual live-search budget: at most 80 cache-miss lodging-area searches/month.
- Same lodging area + dates + adults + budget is cached in Cloudflare KV for 6 hours.
- SerpApi may additionally serve an identical-query cache for one hour.
- Daily automatic results seed the same KV cache for the five core monitored areas.
- Cloudflare Worker rate limiter protects `/api/search`.
- Selecting one non-core lodging area queries only that area.
- Force refresh is capped at one lodging area per request.
- `/api/status` exposes safe quota metadata plus estimated costs: monitored refresh = 5; full active catalog = up to 46.
- `SERPAPI_KEYS_JSON` can provide a legitimate key pool/failover; keys from the same SerpApi account/team still share that account's quota.

## Backend deployment & verification

See [`cloudflare/README.md`](cloudflare/README.md).

The production Worker used by `runtime.js` is:

```text
https://snow-season-where-to-live-api.world4jason.workers.dev
```

After Worker changes:

```bash
git pull --ff-only
cd cloudflare
npx wrangler deploy
node smoke-test.mjs
```

The smoke test verifies the **46 active / 48 raw** catalog split, two exclusions, monitored refresh cost, SerpApi pool status, validation, one real search, result schema, budget enforcement, and Google Maps references.

Frontend-only changes do not require a Worker redeploy.

## Schedule

The Worker runs every day at:

```text
20 0 * * *
```

Cloudflare Cron uses UTC, so this is **08:20 Taiwan time**.

## Data notes

- Search results are date-specific Google Hotels results returned through SerpApi.
- A returned property with a nightly price is treated as having a sellable price for that query at that moment; it is not a guarantee that every booking channel has availability.
- Zero results under a price cap do not mean the destination has no accommodation inventory.
- Distance is straight-line distance from the configured/geocoded reference center, not driving/transit distance.
- Free cancellation, included breakfast, and ski-in/ski-out are shown only when the source data explicitly indicates them.
- Resort ticket prices and operating dates are seasonal; the UI prefers official links and only freezes a numeric price when a sufficiently current official figure is available.
