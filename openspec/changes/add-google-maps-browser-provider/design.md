# Design: Google Maps Browser Hotel Provider

## Summary

Add a provider boundary above the existing hotel-search normalization. The first implementation is deliberately non-disruptive: production `/api/search` remains SerpApi-backed while an admin-only Browser Run path executes equivalent Google Maps hotel searches and produces the same normalized property schema. A comparison path measures parity before any browser-first cutover.

## External constraints

### Cloudflare Browser Run

- Use `@cloudflare/playwright` through a Worker browser binding.
- Workers Free currently provides 10 browser minutes/day, 3 concurrent Browser Sessions, one new Browser Session every 20 seconds, and a 60-second browser timeout.
- The implementation SHALL set an application timeout lower than the platform timeout.
- Browser Run requests are identifiable as automated traffic; custom user-agent changes are not treated as an anti-bot mechanism.

### SerpApi parity baseline

The currently documented SerpApi Google Hotels query contract supports check-in, check-out, adults, children/ages, currency, and price filters. It does not document a hotel `rooms` count parameter. Therefore parity v1 fixes `rooms=1` rather than inventing multi-room semantics.

### Google Maps URL state

Google Maps' internal `data=!…` serialization is not treated as a stable public Google API. The existing parser/synchronizer may use verified fields as a reproducible input reference, but browser query-state verification is mandatory before extracted listings are accepted.

## Architecture

```text
Client / Monitor / Admin parity test
              |
              v
      HotelSearchRequest
              |
        Provider Router
        /            \
       v              v
GoogleMapsBrowser   SerpApi
Provider            Provider
       \              /
        v            v
        Normalized Watch
              |
              v
        existing frontend
```

### Rollout modes

`serpapi_only`
: Existing production behavior. Browser provider is not used for normal output.

`shadow`
: SerpApi remains production output. Admin comparison endpoints can run browser extraction and compare it to SerpApi.

`browser_first`
: Browser provider is primary. Typed browser failures fall back to SerpApi when enabled. This mode is unavailable as the default until parity gates pass.

Initial deployment SHALL use `shadow` semantics.

## Request model

```js
{
  resort_id,
  google_maps_url?,
  check_in,             // YYYY-MM-DD
  check_out,            // YYYY-MM-DD
  adults,               // 1..6
  rooms: 1,             // v1 only
  currency: "TWD",
  max_price_per_night,  // numeric per-night cap
  max_results: 20
}
```

If `google_maps_url` is present, the browser provider synchronizes supported state fields onto a copy of that URL. If it is absent, the provider may construct a Maps hotel-search URL from a verified lodging-base center; generated URLs are still subject to loaded-state verification.

## Browser navigation

1. Launch Browser Run with the `BROWSER` binding.
2. Open a new context/page with locale appropriate for parsing but do not depend on localized CSS classes.
3. Navigate to the synchronized Google Maps hotel URL using `waitUntil: "domcontentloaded"`.
4. Handle ordinary cookie/consent UI if it blocks the result surface.
5. Detect CAPTCHA / unusual traffic / bot challenge / generic Google error surfaces.
6. Verify query state from visible controls and/or current URL:
   - check-in
   - check-out or inferred stay length
   - adults when observable
   - nightly price ceiling when observable
7. Identify the hotel result list through accessibility roles, links to `/maps/place/`, and visible numeric price patterns rather than one obfuscated class selector.
8. Scroll the result feed incrementally until:
   - 20 unique priced hotels are collected, or
   - an end-of-list condition is observed, or
   - no new unique results appear after bounded retries, or
   - browser deadline is reached.
9. Normalize and dedupe properties.
10. Close browser resources in `finally`.

## Extraction strategy

### Stable-first selectors

Preferred evidence, in order:

1. `div[role="feed"]` / accessible result-feed structures when present.
2. Anchors whose href contains `/maps/place/`.
3. Descendant text and aria labels for hotel name/rating/reviews/price.
4. DOM classes only as a last fallback and only with explicit selector-contract diagnostics.

The implementation SHALL NOT equate a missing `role=feed` with zero results; open-source Maps scrapers have experienced production breakage when that structure changed.

### Price parsing

- Parse the visible property price rendered for the exact loaded hotel-search state.
- Accept TWD representations such as `$3,949`, `NT$3,949`, `NT$ 3,949`, and abbreviated ten-thousand forms only when conversion is unambiguous.
- `nightly_price` is the visible per-night price for the current Maps hotel result surface.
- Results lacking a numeric price are not considered available/in-budget properties for the automated watcher.

### Identity / deduplication

Preferred key:
1. canonical Maps place URL / data ID if available;
2. normalized hotel name + coordinates;
3. normalized hotel name as last fallback.

## Query-state verification

The provider returns a `query_state` object:

```js
{
  requested: { check_in, check_out, adults, rooms, currency, max_price_per_night },
  observed: { check_in?, check_out?, adults?, max_price_per_night? },
  verified_fields: [],
  mismatches: []
}
```

Acceptance rule:
- Dates MUST be verified.
- Any observed adults/price value MUST match the request.
- If an expected verifiable control is present but cannot be parsed, fail closed with `query_state_unverified`.

## Typed provider statuses

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

Only `success` and `valid_zero` are successful browser outcomes.

## Normalized response additions

Existing property fields remain unchanged. Add provider metadata at watch/search level:

```js
{
  provider: "google_maps_browser" | "serpapi",
  provider_status,
  provider_fallback_from?,
  source_url?,
  query_state?,
  browser_elapsed_ms?,
  extracted_count?
}
```

The frontend need not branch on provider for normal hotel cards.

## Admin-only POC endpoints

### `POST /api/providers/google-maps-browser/search`

Protected by `ADMIN_TOKEN`. Runs only the browser provider and returns its normalized result/diagnostics. Does not call SerpApi.

### `POST /api/providers/compare`

Protected by `ADMIN_TOKEN`. Runs browser provider and current SerpApi for the same one-room query, then returns:

- browser result count
- SerpApi result count
- normalized top-10 hotel-name overlap
- matched property pairs
- price deltas
- lowest-price comparison
- browser elapsed time
- pass/fail against parity gates

This endpoint is deliberately diagnostic and may consume a SerpApi search when the upstream cache is cold.

## Parity algorithm

Normalize names using Unicode normalization, lowercase, punctuation/whitespace folding, and common hotel-token normalization without translating brand names.

For the first 10 results from each provider:

```text
overlap = matched unique identities / min(10, max(browser_count, serpapi_count))
```

Price agreement for matched hotels:

```text
abs(browser_price - serpapi_price) <= max(200 TWD, serpapi_price * 0.05)
```

Promotion requires:
- overlap >= 0.70 for successful comparable fixtures;
- >= 0.80 of matched priced hotels within price tolerance;
- no false successful zero-result fixture.

## Cloudflare configuration

Wrangler adds:

```json
"browser": { "binding": "BROWSER" }
```

Add `@cloudflare/playwright` as a Cloudflare Worker dependency. Current compatibility date already satisfies the documented Playwright minimum; no anti-bot flags or proxy-evasion behavior are introduced.

## Cost / runtime controls

- Browser POC is admin-only initially.
- Default extraction target: 20 unique priced results.
- Application browser deadline target: 45 seconds maximum per query, with an earlier normal target under 15 seconds.
- Browser resources always close in `finally`.
- Cron integration is deferred until manual/shadow parity passes; this prevents consuming the daily Browser Run allowance on a broken extractor.

## Security and compliance

- Do not implement CAPTCHA solving, stealth plugins, residential proxy rotation, or other bot-protection bypass mechanisms in this change.
- Store only the normalized fields already needed by the user's personal lodging watcher.
- Preserve the existing user-openable Google Maps reference so results remain manually auditable.
