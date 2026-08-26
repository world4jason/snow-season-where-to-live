# Spec Review: Add Google Maps Browser Hotel Provider

**Review status:** APPROVED FOR POC IMPLEMENTATION

**Production cutover status:** NOT APPROVED — requires measured parity verification.

## Review order

1. `proposal.md` — intent/scope
2. `specs/hotel-search/spec.md` — behavioral contract
3. `design.md` — technical approach and risks
4. `tasks.md` — executable implementation plan

## Findings

### 1. Exact SerpApi result identity cannot be promised across surfaces

**Severity:** High, resolved for POC.

The current provider uses SerpApi's Google Hotels/Travel engine. The proposed provider reads the Google Maps hotel result surface. Even for the same dates/occupancy/budget, ranking, result inclusion, taxation display, localization, and timing may differ between the two Google surfaces.

**Resolution:**
- The change does not promise byte-for-byte or order-for-order identity.
- It requires identical supported query semantics and the same normalized output schema.
- It establishes measurable parity gates (top-10 name overlap and matched-price agreement).
- Production remains SerpApi-backed until the gate passes.
- If the product ultimately requires 100% identical SerpApi output, the browser provider cannot replace SerpApi; it can only be supplemental.

**Status:** Resolved; no blocker for shadow/POC implementation.

### 2. Multi-room input is not part of current SerpApi Google Hotels contract

**Severity:** High, resolved.

Current SerpApi Google Hotels documentation exposes dates, adults, children/ages, currency, and filters, but does not expose a hotel room-count query parameter. Implementing `rooms>1` by multiplying adults would be incorrect.

**Resolution:**
- Parity v1 explicitly supports `rooms=1` only.
- `rooms>1` returns `unsupported_input`.
- A later change may add multi-room only after a reliable Google UI/network contract is verified.

**Status:** Resolved.

### 3. Browser Run is detectable automation and may be blocked

**Severity:** High, accepted POC risk.

Cloudflare documents that Browser Run traffic remains identifiable as automated traffic and changing the user agent does not bypass bot protection.

**Resolution:**
- Browser provider is admin/shadow-only initially.
- CAPTCHA/unusual-traffic pages are typed as `bot_blocked`.
- No CAPTCHA solving, stealth plugin, proxy evasion, or similar bypass is in scope.
- SerpApi remains fallback/reference.

**Status:** Accepted for feasibility test; would block browser-first promotion if frequent.

### 4. Missing DOM selectors must never become a zero-result state

**Severity:** Blocker if unaddressed; resolved in spec.

Google Maps DOM structures can change; open-source scrapers have broken when expected result-feed elements disappeared.

**Resolution:**
- Successful zero requires positive query-state and result-surface verification.
- Missing result surface returns `extraction_contract_error`.
- Stable accessibility roles/links are preferred over obfuscated class names.

**Status:** Resolved.

### 5. Browser Run Free-plan time is a scarce resource

**Severity:** Medium, resolved for POC.

Workers Free currently has a daily Browser Run time allowance and browser-session limits, so an extractor failure could waste the daily budget quickly.

**Resolution:**
- No Cron integration in this change.
- Admin-only POC endpoints.
- Per-query application deadline below platform timeout.
- Resource cleanup in `finally`.
- Daily monitor integration is a separate rollout change after parity passes.

**Status:** Resolved.

### 6. Price semantics need empirical comparison

**Severity:** Medium, verification required.

The visible Google Maps price and SerpApi `rate_per_night.extracted_lowest` may differ because of provider, tax, locale, rounding, or product-surface behavior.

**Resolution:**
- Compare matched hotels using tolerance `max(5%, TWD 200)`.
- Record lowest-price and matched-property deltas.
- Do not promote if price parity is poor.

**Status:** Verification item, not implementation blocker.

### 7. Google Maps internal `data=!…` serialization is not a stable public API

**Severity:** Medium, resolved.

The project already has empirically verified parsing for date/adults/price URL state, but the browser provider must not trust URL mutation alone.

**Resolution:**
- Synchronize the stored URL as input convenience.
- Verify the loaded UI state before accepting results.
- Fail closed on mismatch/unverified state.

**Status:** Resolved.

## Acceptance review

- [x] Intent matches the user goal: reduce SerpApi dependence while retaining date/guest/budget priced-hotel results.
- [x] Production search is protected during feasibility testing.
- [x] False zero-result states are prohibited.
- [x] One-room limitation is explicit rather than hidden.
- [x] Browser blocks are detectable and not bypassed.
- [x] Parity has numeric acceptance criteria.
- [x] Cloudflare resource constraints are accounted for.
- [x] Tasks follow the design and include verification before rollout.

## Approval

The spec is approved to begin POC implementation.

Approval means: implement Browser Run foundation, browser-only admin search, and provider comparison tooling.

Approval does **not** mean: switch normal search or daily monitors away from SerpApi. That requires a later parity result and rollout approval.
