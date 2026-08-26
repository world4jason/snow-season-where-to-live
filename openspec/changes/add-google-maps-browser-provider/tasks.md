# Tasks: Google Maps Browser Hotel Provider

## 1. OpenSpec / guardrails

- [x] 1.1 Document current hotel-search behavior in `openspec/specs/hotel-search/spec.md`.
- [x] 1.2 Define future provider-neutral behavior, one-room parity, typed failures, fallback, and parity gates.
- [x] 1.3 Define Browser Run design and resource constraints.
- [x] 1.4 Complete spec review with no blocking findings before code changes.

## 2. Cloudflare Browser Run foundation

- [x] 2.1 Add Cloudflare browser binding `BROWSER` to Wrangler.
- [x] 2.2 Add `@cloudflare/playwright` dependency and minimal package metadata.
- [x] 2.3 Add provider module with deterministic browser/context/page cleanup.
- [x] 2.4 Add application-level timeout below the platform 60-second browser timeout.

## 3. Google Maps query state

- [x] 3.1 Reuse the existing Google Maps hotel URL parser/synchronizer where possible in Worker-compatible code.
- [x] 3.2 Validate `rooms` and reject `rooms>1` as `unsupported_input` for parity v1.
- [x] 3.3 Synchronize exact check-in/check-out/adults/max-price onto a provided Maps hotel URL.
- [x] 3.4 Read/verify loaded dates from URL and/or visible UI.
- [x] 3.5 Read/verify adult count and price ceiling when observable.
- [x] 3.6 Fail closed on query-state mismatch/unverified state.

## 4. Hotel result extraction

- [x] 4.1 Detect CAPTCHA/unusual-traffic/bot-block and return `bot_blocked` without bypass attempts.
- [x] 4.2 Handle ordinary cookie/consent interstitial when possible.
- [x] 4.3 Locate result surface using accessibility roles and Maps place links rather than class-only selectors.
- [x] 4.4 Extract hotel name, visible nightly price, rating/reviews, Maps/place URL, thumbnail, and coordinates when available.
- [x] 4.5 Parse TWD price strings including comma separators and unambiguous `萬` notation.
- [x] 4.6 Scroll/dedupe until 20 unique priced results, end of feed, bounded stagnation, or deadline.
- [x] 4.7 Return a typed extraction failure instead of false zero when result surface cannot be positively identified.
- [x] 4.8 Normalize browser results into current `properties[]` schema.

## 5. POC API and parity tooling

- [x] 5.1 Add admin-only `POST /api/providers/google-maps-browser/search`.
- [x] 5.2 Add admin-only `POST /api/providers/compare`.
- [x] 5.3 Implement hotel-name normalization and top-10 overlap metric.
- [x] 5.4 Implement matched-property nightly-price delta metrics.
- [x] 5.5 Include browser elapsed time and typed provider diagnostics in compare output.
- [x] 5.6 Keep normal `/api/search` output SerpApi-backed during POC/shadow rollout.

## 6. Verification fixtures

- [ ] 6.1 Nozawa fixture: use the user-provided Google Maps hotel URL and verify exact dates/adults/price state in deployed Browser Run.
- [ ] 6.2 Kiroro fixture: create/store a reproducible Maps hotel URL with the same query conditions as SerpApi.
- [ ] 6.3 Sugadaira fixture: create/store a reproducible Maps hotel URL with the same query conditions as SerpApi.
- [ ] 6.4 Run provider comparison for all three fixtures.
- [ ] 6.5 Verify top-10 overlap >= 70% on successful comparable fixtures.
- [ ] 6.6 Verify >= 80% of matched priced hotels meet the `max(5%, TWD 200)` price tolerance.
- [ ] 6.7 Verify no false successful zero-result state.

## 7. Rollout decision

- [ ] 7.1 Record parity results in the change review/verification artifact.
- [ ] 7.2 If gates fail, keep SerpApi primary and document failure mode/selectors for follow-up.
- [ ] 7.3 If gates pass, propose a separate rollout change for `browser_first` monitor/search traffic.
- [x] 7.4 Do not add Browser Run to daily Cron in this change before parity passes.

## 8. Documentation

- [x] 8.1 Document local/deployed Browser Run setup and the additional deploy dependency.
- [x] 8.2 Document provider status meanings and fallback behavior.
- [x] 8.3 Document Browser Run Free-plan time constraints and the fact that bot blocks are not bypassed.
