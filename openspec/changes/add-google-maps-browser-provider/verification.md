# Verification: Google Maps Browser Hotel Provider

## Current state

Implementation is complete enough for deployed Browser Run feasibility testing, but provider parity is **not yet verified** and production cutover remains disallowed.

## Static/implementation checks completed

- OpenSpec proposal/spec/design/tasks reviewed before implementation.
- Cloudflare Browser Run binding added.
- `nodejs_compat` enabled as required by current `@cloudflare/playwright`.
- `@cloudflare/playwright` v1.3-compatible dependency declared.
- Browser provider remains admin-only/shadow.
- Normal `/api/search` and daily monitor traffic remain on the pre-existing SerpApi path.
- `rooms=1` parity scope is explicit; `rooms>1` is rejected.
- Query-state mismatch/unverified states are typed failures.
- CAPTCHA/unusual-traffic surfaces are typed `bot_blocked`; no bypass is implemented.
- Missing extraction surface is a typed error rather than a successful zero result.
- Browser resources close in `finally`.
- Provider unit tests cover Google Maps URL parsing/synchronization, TWD price parsing, and parity-metric helpers.

## Deployment verification pending

The following MUST be run after deploying the Browser Run binding/dependency:

```bash
cd ~/code_ground/snow-season-where-to-live
git pull --ff-only
cd cloudflare
npm install
npx wrangler deploy
node provider-unit-test.mjs
node smoke-test.mjs
```

Expected default status after deployment:

```text
browser_provider.mode = shadow
browser_provider.browser_binding_configured = true
browser_provider.normal_search_uses_browser = false
browser_provider.rooms_supported = [1]
```

## Live Browser Run fixture pending

Run the browser-only Nozawa fixture without intentionally invoking SerpApi comparison:

```bash
SMOKE_ADMIN_TOKEN='<ADMIN_TOKEN>' node smoke-test.mjs
```

Do not paste `ADMIN_TOKEN` into chat or commit it.

Record:

- provider status
- result count
- lowest price
- query-state verified fields
- extraction surface
- browser elapsed ms
- any bot/interstitial/extraction failure

## Provider parity pending

After browser-only extraction works, run comparison deliberately:

```bash
SMOKE_ADMIN_TOKEN='<ADMIN_TOKEN>' \
SMOKE_PROVIDER_COMPARE=1 \
node smoke-test.mjs
```

This can consume a SerpApi search if the identical upstream query is cold.

Required fixtures before rollout decision:

1. Nozawa
2. Kiroro
3. Sugadaira

Promotion gate:

- top-10 normalized hotel-name overlap >= 70% on successful comparable fixtures
- >= 80% of matched priced hotels within `max(5%, TWD 200)`
- no false successful zero-result fixture
- bot/block rate acceptable for intended use

## Decision

**Current decision:** KEEP SERPAPI PRIMARY / BROWSER PROVIDER SHADOW ONLY.

This decision changes only after the live fixture data above is recorded and the OpenSpec rollout task is reviewed.
