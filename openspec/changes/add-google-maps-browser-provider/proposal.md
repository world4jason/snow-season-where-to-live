# Proposal: Add Google Maps Browser Hotel Provider

## Intent

Reduce dependence on SerpApi quota by adding a Cloudflare Browser Run provider that reads date-specific hotel results directly from the same Google Maps hotel UI a user can open manually, while preserving the current normalized hotel-search contract and keeping SerpApi as a safe fallback.

The requested user experience is equivalent to the existing search flow: choose a lodging base, dates, guest count, currency, and nightly budget, then receive the hotels that currently expose a price for those conditions.

## Changes

**Hotel search provider**
- From: SerpApi Google Hotels is the only automated hotel-result provider.
- To: Add `google_maps_browser` as a second provider using Cloudflare Browser Run + Playwright, with SerpApi retained as fallback and parity reference.
- Reason: SerpApi Free quota is too small for broad recurring monitoring.
- Impact: Non-breaking while rollout mode remains `serpapi_only` / `shadow`; provider metadata will be added to responses.

**Input contract**
- From: check-in, check-out, adults, currency, and nightly budget are supported; multi-room is undefined.
- To: Formalize the same fields plus `rooms`, with parity v1 supporting exactly `rooms=1`.
- Reason: The product should not imply multi-room support that neither the current SerpApi Google Hotels API nor the verified Google Maps URL contract reliably exposes.
- Impact: `rooms>1` returns an explicit unsupported-input state instead of silently producing incorrect results.

**Google Maps reference**
- From: a monitor may store a Google Maps hotel URL for manual verification.
- To: The browser provider SHALL use the stored/synchronized Maps URL when present, and SHALL verify that the loaded UI state matches the requested dates, guest count, and price ceiling before accepting extracted results.
- Reason: The saved URL is the strongest reproducible browser-state reference already available in the app.
- Impact: Browser-provider results become auditable through a user-openable source URL.

**Rollout and fallback**
- From: provider failures are SerpApi failures.
- To: Introduce provider modes `serpapi_only`, `shadow`, and `browser_first`; browser failures, bot blocks, selector breakage, and query-state mismatch SHALL fall back to SerpApi when fallback is enabled.
- Reason: Browser scraping is operationally less stable and Cloudflare Browser Run traffic is explicitly identifiable as automated traffic.
- Impact: No production cutover until parity verification passes.

## Scope

### In scope

- Cloudflare Browser Run binding and Playwright dependency.
- One-room hotel search parity for dates, adults, currency, and nightly price ceiling.
- Extract visible hotel name, nightly price, rating/reviews when available, Maps URL/place URL, thumbnail when available, and coordinates when derivable.
- Normalize browser results into the existing property/watch response schema.
- Detect and classify CAPTCHA/bot block, consent/interstitial, query-state mismatch, timeout, missing result surface, and selector-contract failure.
- Admin-only comparison endpoint/test path against SerpApi.
- Shadow rollout and measurable parity report.

### Out of scope for this change

- Multi-room (`rooms>1`) booking semantics.
- Exact room-type inventory such as `Deluxe Twin` / `Suite` quantities.
- Booking completion.
- CAPTCHA solving or bot-protection bypass.
- Proxy rotation/evasion infrastructure.
- Replacing SerpApi before parity gates pass.
- Bulk historical storage of Google Maps data.

## Success criteria

1. Browser provider can execute at least the Nozawa, Kiroro, and Sugadaira fixture queries with exact date/adult/budget state verification, or return a typed browser/provider error without false zero results.
2. Browser result schema is accepted by the existing frontend without a browser-provider-specific rendering path.
3. For successful comparable fixtures, top-10 normalized hotel-name overlap with SerpApi is at least 70%.
4. For matched properties with prices, at least 80% have nightly-price difference within the greater of 5% or TWD 200.
5. A valid zero-result browser search is accepted only after query state and the Google Maps result surface are positively verified.
6. `browser_first` is not enabled by default until these gates pass.
7. One provider comparison run can report browser time, SerpApi cost, result overlap, and price agreement.
