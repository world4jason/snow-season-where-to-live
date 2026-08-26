# Hotel Search Specification — Future State

## ADDED Requirements

### Requirement: Provider-neutral hotel search
The system SHALL execute hotel searches through a provider-neutral contract and SHALL normalize all successful providers into the same watch/property schema consumed by the frontend.

#### Scenario: Browser provider returns hotels
- **GIVEN** a valid one-room hotel search request
- **WHEN** `google_maps_browser` successfully extracts hotels
- **THEN** the response SHALL use the existing `watches[].properties[]` shape
- **AND** each property SHALL include `name` and `nightly_price`
- **AND** it SHOULD include rating, review count, coordinates, thumbnail, place/booking link, and Google Maps URL when available
- **AND** provider metadata SHALL identify `google_maps_browser`

#### Scenario: SerpApi provider returns hotels
- **WHEN** SerpApi is used as primary or fallback
- **THEN** the response SHALL preserve the same normalized schema
- **AND** provider metadata SHALL identify `serpapi`

### Requirement: Query-state parity
The browser provider SHALL verify the Google Maps hotel UI state before accepting extracted results.

#### Scenario: Requested browser query matches loaded UI
- **GIVEN** requested check-in, check-out, adults, currency, and maximum nightly price
- **WHEN** Google Maps finishes loading the hotel result surface
- **THEN** the provider SHALL verify the loaded dates
- **AND** SHALL verify the loaded adult/occupancy value when the UI exposes it
- **AND** SHALL verify the loaded price ceiling when the UI exposes it
- **AND** SHALL include verification metadata in provider diagnostics

#### Scenario: Loaded UI does not match request
- **WHEN** any verifiable date, guest, or price condition differs from the request
- **THEN** the browser provider SHALL return `query_state_mismatch`
- **AND** SHALL NOT return the visible listings as valid search results

### Requirement: One-room parity contract
The hotel-search contract SHALL define `rooms` and browser parity v1 SHALL support exactly one room.

#### Scenario: One-room search
- **WHEN** `rooms` is omitted or equals `1`
- **THEN** the request SHALL be accepted

#### Scenario: Multi-room search
- **WHEN** `rooms` is greater than `1`
- **THEN** the provider SHALL return `unsupported_input`
- **AND** SHALL NOT approximate multiple rooms by modifying adult count

### Requirement: Browser result extraction
The browser provider SHALL extract priced hotel listings from the Google Maps hotel result surface without depending solely on unstable CSS class names.

#### Scenario: Visible priced listing
- **WHEN** a visible hotel result exposes a hotel name and numeric price
- **THEN** the provider SHALL normalize the price as `nightly_price`
- **AND** SHALL preserve a Google Maps/place URL when available

#### Scenario: Listing has no numeric price
- **WHEN** a visible result does not expose a numeric price for the requested state
- **THEN** it SHALL NOT be treated as an in-budget available property

#### Scenario: Duplicate listing
- **WHEN** scrolling produces the same Maps/place URL or same normalized hotel identity more than once
- **THEN** the provider SHALL deduplicate it before returning results

### Requirement: Result completeness target
The browser provider SHALL load enough of the result feed to support parity comparison with the existing SerpApi flow.

#### Scenario: Result feed has more hotels
- **WHEN** the feed can be scrolled and additional unique listings continue to appear
- **THEN** the provider SHALL continue until at least 20 unique listings are collected, the end-of-list condition is observed, or the browser time budget is reached

### Requirement: No false zero results
The browser provider SHALL distinguish a verified empty result from extraction failure.

#### Scenario: Verified zero-result search
- **WHEN** query state is verified
- **AND** the hotel result surface is positively identified
- **AND** Google Maps visibly indicates no matching hotel result for the applied conditions
- **THEN** the provider MAY return a successful zero-result response

#### Scenario: Result container or selectors are missing
- **WHEN** the expected result surface cannot be positively identified
- **THEN** the provider SHALL return `extraction_contract_error`
- **AND** SHALL NOT return a successful zero-result response

### Requirement: Bot and interstitial detection
The browser provider SHALL detect known non-result surfaces before extraction.

#### Scenario: CAPTCHA or unusual traffic page
- **WHEN** Google serves CAPTCHA, unusual-traffic, automated-query, or equivalent challenge content
- **THEN** the provider SHALL return `bot_blocked`
- **AND** SHALL NOT attempt to bypass or solve the challenge

#### Scenario: Consent or locale interstitial
- **WHEN** a consent/interstitial prevents the hotel results from becoming available
- **THEN** the provider MAY interact only with ordinary consent controls
- **AND** SHALL return `interstitial_blocked` if the result surface cannot be reached safely

### Requirement: Provider fallback
The system SHALL support explicit rollout modes and SHALL preserve SerpApi as fallback until browser parity is approved.

#### Scenario: `serpapi_only`
- **WHEN** provider mode is `serpapi_only`
- **THEN** browser automation SHALL not run for normal search traffic

#### Scenario: `shadow`
- **WHEN** provider mode is `shadow`
- **THEN** production output SHALL remain SerpApi-derived
- **AND** browser results MAY be collected through an admin comparison path for parity analysis

#### Scenario: `browser_first`
- **WHEN** provider mode is `browser_first`
- **AND** browser search succeeds and passes query-state validation
- **THEN** browser results SHALL be returned without consuming SerpApi quota

#### Scenario: Browser-first typed failure
- **WHEN** browser mode returns a typed provider failure
- **AND** fallback is enabled
- **THEN** SerpApi SHALL be attempted
- **AND** the response SHALL record that fallback occurred

### Requirement: Parity verification gate
The system SHALL measure browser-provider parity against the current SerpApi provider before production cutover.

#### Scenario: Compare one fixture
- **WHEN** an admin runs a provider comparison for one request
- **THEN** the report SHALL include normalized top-result name overlap
- **AND** matched nightly-price deltas
- **AND** lowest-price comparison when both providers have results
- **AND** browser elapsed time
- **AND** whether the SerpApi comparison consumed a fresh search or cache hit when observable

#### Scenario: Promotion gate
- **GIVEN** Nozawa, Kiroro, and Sugadaira fixture queries
- **WHEN** browser and SerpApi results are compared
- **THEN** top-10 normalized-name overlap SHALL be at least 70% for successful comparable fixtures
- **AND** at least 80% of matched priced properties SHALL differ by no more than the greater of 5% or TWD 200
- **AND** no fixture SHALL contain a false successful zero result
- **AND** `browser_first` SHALL remain disabled by default until the gate passes

### Requirement: Browser resource safety
The browser provider SHALL operate within Cloudflare Browser Run account limits and SHALL expose browser resource use for monitoring.

#### Scenario: Browser session used for a search
- **WHEN** Browser Run is invoked
- **THEN** the provider SHALL close or disconnect resources deterministically
- **AND** SHALL record elapsed browser time
- **AND** SHALL enforce an application timeout below the platform browser timeout

## MODIFIED Requirements

### Requirement: Current provider inputs
The hotel-search contract SHALL support check-in, check-out, adult guest count, currency, nightly-price ceiling, and `rooms=1`; optional children support MAY be added later without changing provider-neutral result normalization.

#### Scenario: Parity request
- **WHEN** a parity request is constructed
- **THEN** check-in and check-out SHALL be valid calendar dates
- **AND** adult count SHALL be validated
- **AND** nightly budget SHALL remain a per-night ceiling
- **AND** rooms SHALL equal `1`
