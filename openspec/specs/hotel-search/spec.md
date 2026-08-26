# Hotel Search Specification

## Purpose

Define the currently deployed contract for date-specific hotel search and the normalized result shape consumed by Snow Season.

## Requirements

### Requirement: Date-specific hotel query
The system SHALL accept a lodging base, check-in date, check-out date, adult guest count, currency, and maximum nightly price and SHALL search the configured hotel-data provider with those exact conditions.

#### Scenario: Search one lodging base
- **GIVEN** a valid lodging base
- **WHEN** the client submits valid check-in/check-out dates, 1–6 adults, and a nightly budget
- **THEN** the system SHALL return results for that lodging base and those exact conditions
- **AND** `max_price_per_night` SHALL be interpreted as a per-night cap, not a stay-total cap

### Requirement: Normalized hotel results
The system SHALL normalize provider results into the frontend's property/watch schema.

#### Scenario: Property has a sellable nightly price
- **WHEN** the provider returns a hotel with a numeric nightly price
- **THEN** the normalized property SHALL include hotel name and `nightly_price`
- **AND** it SHOULD include rating, review count, coordinates, thumbnail, booking/provider link, and Google Maps link when available

### Requirement: Availability wording
The system SHALL distinguish successful zero-result searches from never-searched states and provider errors.

#### Scenario: Successful query has no in-budget properties
- **WHEN** a completed provider query returns no properties at or below the nightly budget
- **THEN** the UI SHALL state that there are `0` properties within the nightly budget
- **AND** SHALL NOT claim that the entire lodging area has no rooms

#### Scenario: Provider query fails
- **WHEN** the provider query fails
- **THEN** the response SHALL expose an error state
- **AND** SHALL NOT represent the error as an empty successful result

### Requirement: Search cache
The system SHALL cache the same lodging-base + dates + adults + nightly-budget query in Cloudflare KV for six hours unless a forced refresh is requested.

#### Scenario: Repeated identical search
- **WHEN** an identical cached query is requested within the KV TTL
- **THEN** the system SHALL return the cached normalized result without intentionally consuming a new SerpApi search

### Requirement: Forced refresh
The system SHALL allow a forced refresh for exactly one lodging base per request.

#### Scenario: Forced refresh request
- **WHEN** a single lodging base is searched with `force_refresh=true`
- **THEN** the current SerpApi provider SHALL bypass its upstream cache with `no_cache=true`

### Requirement: Current provider inputs
The current SerpApi Google Hotels provider SHALL support the query fields exposed by the deployed app.

#### Scenario: Current parity inputs
- **WHEN** a current hotel query is constructed
- **THEN** it SHALL include check-in, check-out, adult guest count, currency, and nightly-price ceiling
- **AND** the current deployed app does not define a multi-room query contract
