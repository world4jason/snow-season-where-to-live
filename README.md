# Snow Season — Where to Live

A ski-accommodation search and monitoring app built on **GitHub Pages + Cloudflare Workers/KV + SerpApi Google Hotels**.

## Live architecture

```text
GitHub Pages (UI)
  ├─ lodging-area selector / tabs
  ├─ check-in / check-out date pickers
  ├─ guest count
  ├─ nightly budget (TWD)
  ├─ price / rating / distance / amenity filters
  ├─ hotel list + Google Maps links
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

GitHub Actions is **not** used for the backend.

## Lodging catalog

The catalog is the practical lodging-base union of several Japan ski-area discovery/ranking dimensions rather than one ambiguous "Top 20":

- single longest continuous run
- 2025–26 Weathernews popularity/attention ranking
- current Tabiris published course-area ranking
- a representative large-resort/network discovery set based on linked piste length and course count

The last item is intentionally treated as a discovery set rather than a strict numeric ranking because it mixes different units and network definitions. Ranking metadata and source notes live in `config/rankings.json`.

Special handling:

- **Hakuba Valley:** split into Hakuba Village, Otari/Tsugaike, and Omachi lodging bases, covering the official Hakuba Valley resort network without pretending all resorts share one useful lodging center.
- **Shiga Kogen:** split into Central, East, West, and South lodging bases so Yakebitai/Okushiga and Kumanoyu/Yokoteyama are not judged by an Ichinose-only distance center.
- **Niseko United:** one broad lodging destination with Hirafu as the distance reference; its resort coverage is carried as metadata.
- **Sapporo Teine:** retained as a custom destination, with Sapporo city used for hotel discovery and the ski resort used as the distance center.
- **Yuzawa:** broad Echigo-Yuzawa remains available, while Iwappara and Kandatsu also have precise lodging bases for distance-sensitive searches.
- **Remote/urban-access areas:** Kurodake uses Sounkyo, Tengendai uses Shirabu Onsen, Senjojiki uses Komagane, and similar areas use practical lodging towns rather than the lift coordinates as the hotel-search phrase.

The resulting catalog contains **48 practical lodging bases** across `config/watches.json` and `config/extra-watches.json`.

## Implemented UI behavior

- Lodging-area tabs and the destination selector actually change displayed hotels and map markers.
- Check-in/check-out are real date inputs.
- Guest count is selectable from 1–6 adults.
- Nightly budget changes the upstream SerpApi search, not only the local filter.
- Currency is consistently TWD / `NT$` throughout the search UI and results.
- Search results can be sorted by price, rating, or straight-line distance from the configured lodging/ski center.
- Local filters work for price, rating, distance, free cancellation, breakfast included, and ski-in/ski-out when source data explicitly provides those attributes.
- Hotel cards and map price markers are synchronized.
- Every returned hotel has a Google Maps link.
- Hotel images use SerpApi `thumbnail` and fall back to `images[].thumbnail` / `original_image`.
- Large multi-resort regions show lodging-strategy guidance instead of pretending there is one universally correct center point.
- Never-searched destinations display **尚未查詢** rather than incorrectly claiming there are no rooms.
- Mobile layout switches between hotel list and map.

## Query/cost protection

The SerpApi Free plan currently provides 250 searches/month. This project uses:

- Daily automatic refresh: only 5 core lodging areas → at most 155 searches in a 31-day month.
- Public manual live-search budget: at most 80 cache-miss lodging-area searches/month.
- Same lodging area + dates + adults + budget is cached for 6 hours.
- Daily automatic results seed the same 6-hour cache for the five core monitored areas.
- Cloudflare Worker rate limiter protects `/api/search` from rapid repeated calls.
- Selecting one non-core lodging area queries only that area; the app does not spend dozens of searches just because the catalog is large.

This keeps expected automatic + public manual use below the free-plan search limit. Admin-triggered `/api/refresh` calls are intentionally not included in that public quota, so use them sparingly.

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

The smoke test verifies the production API, **48-base catalog**, the 5-area automatic-monitoring limit, strict date validation, a real search from the expanded ranking catalog, result schema, budget enforcement, coordinates, and Google Maps URLs.

## Schedule

The Worker runs every day at:

```text
20 0 * * *
```

Cloudflare Cron uses UTC, so this is **08:20 Taiwan time**.

## Data notes

- Search results are date-specific Google Hotels results returned through SerpApi.
- A returned property with a nightly price is treated as having a sellable price for that query at that moment; it is not a guarantee that every booking channel has availability.
- Distance is straight-line distance from the configured/geocoded ski or lodging reference center, not driving/transit distance.
- Free cancellation, included breakfast, and ski-in/ski-out are shown only when source data explicitly indicates them.
- Ski-area ranking figures can differ by source, season, operating footprint, and whether a linked network or an individual resort is measured; ranking metadata therefore preserves the metric/source instead of collapsing everything into one score.
