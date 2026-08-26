# Snow Season — OpenSpec Project Context

## Product intent

Snow Season is a ski-accommodation search and monitoring app. Users select a practical lodging base near Japanese ski areas, provide stay dates, guest count, and a nightly TWD budget, then inspect date-specific hotel results. The system also supports scheduled monitoring and concise ski-resort reference information.

## Current architecture

- GitHub Pages: static frontend.
- Cloudflare Worker: API, scheduled monitoring, provider orchestration.
- Cloudflare KV: cache and monitor configuration.
- SerpApi Google Hotels: current primary source for date-specific hotel prices.
- Google Maps URLs: human-verifiable references stored alongside monitor conditions.

## Engineering conventions

- Preserve the existing normalized hotel/watch schema consumed by the frontend unless a spec explicitly changes it.
- Do not silently convert an API failure into `0 rooms` / `0 hotels`.
- `max_price_per_night` always means a per-night cap in the request currency.
- A returned hotel is treated as having a sellable price for the exact query at extraction time; it is not a booking guarantee.
- Provider-specific behavior must remain behind a normalized provider boundary.
- Expensive or quota-consuming fallbacks must be explicit and observable.
- Browser scraping must detect bot blocks, CAPTCHA, query-state mismatch, and selector breakage as errors rather than false zero-result states.
- New provider work ships behind a rollout mode until parity verification passes.

## OpenSpec workflow

Changes follow: proposal → future-state spec → design → tasks → review → implementation → verification → archive.

Implementation MUST NOT begin for a change with blocking review findings.
