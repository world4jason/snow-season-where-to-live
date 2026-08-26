import { launch } from '@cloudflare/playwright';
import {
  buildSynchronizedMapsHotelUrl,
  coordinatesFromMapsUrl,
  parseGoogleMapsHotelUrl,
  parseRatingAndReviews,
  parseTwdPrice,
} from './provider-utils.js';

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS = 30;
const APP_DEADLINE_MS = 45000;
const NAVIGATION_TIMEOUT_MS = 20000;
const STAGNATION_LIMIT = 3;

function providerResult(status, extra = {}) {
  return {
    provider: 'google_maps_browser',
    provider_status: status,
    ok: status === 'success' || status === 'valid_zero',
    properties: [],
    match_count: 0,
    lowest_price: null,
    ...extra,
  };
}

function validateRequest(input) {
  const rooms = Number(input?.rooms ?? 1);
  if (!Number.isInteger(rooms) || rooms !== 1) {
    return providerResult('unsupported_input', {
      error: 'Browser parity v1 supports exactly rooms=1',
      requested_rooms: rooms,
    });
  }
  if (String(input?.currency || 'TWD').toUpperCase() !== 'TWD') {
    return providerResult('unsupported_input', {
      error: 'Browser POC currently validates visible hotel prices only in TWD',
    });
  }
  const adults = Number(input?.adults ?? 2);
  if (!Number.isInteger(adults) || adults < 1 || adults > 6) {
    return providerResult('unsupported_input', { error: 'Adults must be an integer from 1 to 6' });
  }
  const budget = Number(input?.max_price_per_night);
  if (!Number.isFinite(budget) || budget < 1) {
    return providerResult('unsupported_input', { error: 'max_price_per_night must be a positive number' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input?.check_in || ''))
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(input?.check_out || ''))) {
    return providerResult('unsupported_input', { error: 'check_in/check_out must be YYYY-MM-DD' });
  }
  if (!input?.google_maps_url) {
    return providerResult('unsupported_input', {
      error: 'google_maps_url is required for the first Browser Run parity POC',
    });
  }
  return null;
}

async function bodyText(page) {
  try {
    return await page.locator('body').innerText({ timeout: 4000 });
  } catch {
    return '';
  }
}

function detectBotBlock(url, text) {
  const combined = `${url}\n${text}`.toLowerCase();
  return /\/sorry\/|recaptcha|unusual traffic|automated quer|not a robot|異常なトラフィック|不尋常流量|自動化されたクエリ|機器人|機器人驗證/.test(combined);
}

async function tryConsent(page) {
  const patterns = [
    /accept all/i,
    /i agree/i,
    /全部接受/i,
    /接受全部/i,
    /同意/i,
    /すべて同意/i,
    /同意する/i,
  ];
  for (const pattern of patterns) {
    try {
      const button = page.getByRole('button', { name: pattern }).first();
      if (await button.count()) {
        await button.click({ timeout: 1200 });
        await page.waitForTimeout(500);
        return true;
      }
    } catch {
      // Try the next ordinary consent label.
    }
  }
  return false;
}

function compareQueryState(request, observed) {
  const requested = {
    check_in: String(request.check_in),
    check_out: String(request.check_out),
    adults: Number(request.adults ?? 2),
    rooms: Number(request.rooms ?? 1),
    currency: String(request.currency || 'TWD').toUpperCase(),
    max_price_per_night: Math.round(Number(request.max_price_per_night)),
  };
  const mismatches = [];
  const verifiedFields = [];

  for (const field of ['check_in', 'check_out']) {
    if (observed?.[field]) {
      verifiedFields.push(field);
      if (String(observed[field]) !== String(requested[field])) {
        mismatches.push({ field, requested: requested[field], observed: observed[field] });
      }
    }
  }
  if (Number.isFinite(Number(observed?.adults))) {
    verifiedFields.push('adults');
    if (Number(observed.adults) !== requested.adults) {
      mismatches.push({ field: 'adults', requested: requested.adults, observed: Number(observed.adults) });
    }
  }
  if (Number.isFinite(Number(observed?.max_price_per_night))) {
    verifiedFields.push('max_price_per_night');
    if (Math.round(Number(observed.max_price_per_night)) !== requested.max_price_per_night) {
      mismatches.push({
        field: 'max_price_per_night',
        requested: requested.max_price_per_night,
        observed: Math.round(Number(observed.max_price_per_night)),
      });
    }
  }

  return { requested, observed, verified_fields: verifiedFields, mismatches };
}

async function extractRawCards(page) {
  const anchors = page.locator('a[href*="/maps/place/"]');
  const count = await anchors.count();
  if (!count) return [];

  return anchors.evaluateAll((nodes) => nodes.map((anchor) => {
    const currencyPattern = /(?:NT\$|TWD\s*|\$)\s*[0-9]+(?:[,.][0-9]+)*(?:\s*萬)?/i;
    let card = anchor;
    let cursor = anchor;
    for (let depth = 0; depth < 8 && cursor; depth += 1) {
      const text = String(cursor.innerText || '').trim();
      if (currencyPattern.test(text) && text.length <= 1800) {
        card = cursor;
        break;
      }
      cursor = cursor.parentElement;
    }

    const text = String(card?.innerText || anchor.innerText || '').trim();
    const aria = String(anchor.getAttribute('aria-label') || '').trim();
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const name = aria || lines.find((line) => !currencyPattern.test(line) && !/^\d(?:\.\d)?\s*[★⭐]/.test(line)) || lines[0] || '';
    const image = card?.querySelector('img')?.src || anchor.querySelector('img')?.src || null;
    return {
      href: anchor.href || '',
      name,
      text,
      thumbnail: image,
    };
  }));
}

function normalizeRawCard(raw, currency = 'TWD') {
  const nightlyPrice = currency === 'TWD' ? parseTwdPrice(raw?.text) : null;
  if (!raw?.name || !raw?.href || !Number.isFinite(Number(nightlyPrice))) return null;
  const rating = parseRatingAndReviews(raw.text);
  const coords = coordinatesFromMapsUrl(raw.href);
  return {
    name: raw.name,
    nightly_price: Number(nightlyPrice),
    total_price: null,
    rating: rating.rating,
    reviews: rating.reviews,
    source: 'Google Maps browser',
    link: raw.href,
    google_maps_url: raw.href,
    thumbnail: raw.thumbnail || null,
    latitude: coords.latitude,
    longitude: coords.longitude,
    hotel_class: null,
    property_type: 'Hotel',
    distance_to_center_km: null,
    tags: {
      free_cancellation: false,
      breakfast_included: false,
      ski_in_out: false,
    },
  };
}

function dedupeProperties(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = row.google_maps_url || `${row.name}:${row.latitude ?? ''}:${row.longitude ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

async function collectProperties(page, request, deadlineAt) {
  const maxResults = Math.max(1, Math.min(MAX_RESULTS, Number(request.max_results || DEFAULT_MAX_RESULTS)));
  let properties = [];
  let stagnation = 0;
  let previousCount = 0;

  const feed = page.locator('div[role="feed"]').first();
  const hasFeed = (await feed.count()) > 0;

  for (let iteration = 0; iteration < 12 && Date.now() < deadlineAt; iteration += 1) {
    const raw = await extractRawCards(page);
    const normalized = raw
      .map((row) => normalizeRawCard(row, request.currency || 'TWD'))
      .filter(Boolean)
      .filter((row) => Number(row.nightly_price) <= Number(request.max_price_per_night));
    properties = dedupeProperties([...properties, ...normalized]);
    if (properties.length >= maxResults) break;

    if (properties.length <= previousCount) stagnation += 1;
    else stagnation = 0;
    previousCount = properties.length;
    if (stagnation >= STAGNATION_LIMIT) break;

    if (hasFeed) {
      try {
        await feed.evaluate((element) => {
          element.scrollBy(0, Math.max(700, Math.floor(element.clientHeight * 0.85)));
        });
      } catch {
        break;
      }
    } else {
      try {
        await page.mouse.wheel(0, 900);
      } catch {
        break;
      }
    }
    await page.waitForTimeout(650);
  }

  properties.sort((a, b) => Number(a.nightly_price) - Number(b.nightly_price));
  return { properties: properties.slice(0, maxResults), has_feed: hasFeed };
}

function explicitZeroText(text) {
  return /no results found|no matching results|找不到結果|沒有符合|沒有結果|検索結果がありません|一致する結果はありません/i.test(String(text || ''));
}

export async function searchGoogleMapsHotels(env, request) {
  const invalid = validateRequest(request);
  if (invalid) return invalid;
  if (!env?.BROWSER) return providerResult('navigation_error', { error: 'BROWSER binding is not configured' });

  let sourceUrl;
  try {
    sourceUrl = buildSynchronizedMapsHotelUrl(request.google_maps_url, request);
  } catch (error) {
    return providerResult('unsupported_input', { error: error instanceof Error ? error.message : String(error) });
  }

  const startedAt = Date.now();
  const deadlineAt = startedAt + APP_DEADLINE_MS;
  let browser = null;
  let page = null;
  try {
    browser = await launch(env.BROWSER);
    const context = await browser.newContext({
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      viewport: { width: 1440, height: 1000 },
    });
    page = await context.newPage();
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(1200);

    let text = await bodyText(page);
    if (detectBotBlock(page.url(), text)) {
      return providerResult('bot_blocked', {
        error: 'Google served a bot/CAPTCHA/unusual-traffic surface',
        source_url: sourceUrl,
        final_url: page.url(),
        browser_elapsed_ms: Date.now() - startedAt,
      });
    }

    if (!page.url().includes('/maps/')) {
      await tryConsent(page);
      await page.waitForTimeout(700);
      text = await bodyText(page);
    } else {
      await tryConsent(page);
      text = await bodyText(page);
    }

    if (detectBotBlock(page.url(), text)) {
      return providerResult('bot_blocked', {
        error: 'Google served a bot/CAPTCHA/unusual-traffic surface',
        source_url: sourceUrl,
        final_url: page.url(),
        browser_elapsed_ms: Date.now() - startedAt,
      });
    }
    if (!page.url().includes('/maps/')) {
      return providerResult('interstitial_blocked', {
        error: 'Google Maps result surface was not reached after ordinary consent handling',
        source_url: sourceUrl,
        final_url: page.url(),
        browser_elapsed_ms: Date.now() - startedAt,
      });
    }

    let observed;
    try {
      observed = parseGoogleMapsHotelUrl(page.url());
    } catch {
      observed = null;
    }
    const queryState = compareQueryState(request, observed);
    if (!observed?.check_in || !observed?.check_out) {
      return providerResult('query_state_unverified', {
        error: 'Loaded Google Maps URL does not expose verifiable check-in/check-out state',
        source_url: sourceUrl,
        final_url: page.url(),
        query_state: queryState,
        browser_elapsed_ms: Date.now() - startedAt,
      });
    }
    if (queryState.mismatches.length) {
      return providerResult('query_state_mismatch', {
        error: 'Loaded Google Maps query state differs from requested conditions',
        source_url: sourceUrl,
        final_url: page.url(),
        query_state: queryState,
        browser_elapsed_ms: Date.now() - startedAt,
      });
    }

    const { properties, has_feed: hasFeed } = await collectProperties(page, request, deadlineAt);
    text = await bodyText(page);
    if (properties.length) {
      return providerResult('success', {
        properties,
        match_count: properties.length,
        lowest_price: properties[0]?.nightly_price ?? null,
        source_url: sourceUrl,
        final_url: page.url(),
        query_state: queryState,
        browser_elapsed_ms: Date.now() - startedAt,
        extracted_count: properties.length,
        extraction_surface: hasFeed ? 'role_feed' : 'place_links',
      });
    }

    if (explicitZeroText(text)) {
      return providerResult('valid_zero', {
        source_url: sourceUrl,
        final_url: page.url(),
        query_state: queryState,
        browser_elapsed_ms: Date.now() - startedAt,
        extracted_count: 0,
        extraction_surface: hasFeed ? 'role_feed' : 'explicit_zero',
      });
    }

    return providerResult('extraction_contract_error', {
      error: 'No priced hotel listings were extracted and Google Maps did not expose an explicit zero-result state',
      source_url: sourceUrl,
      final_url: page.url(),
      query_state: queryState,
      browser_elapsed_ms: Date.now() - startedAt,
      extraction_surface: hasFeed ? 'role_feed_empty' : 'missing_result_surface',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /timeout/i.test(message) || Date.now() >= deadlineAt ? 'timeout' : 'navigation_error';
    return providerResult(status, {
      error: message,
      source_url: sourceUrl,
      final_url: page?.url?.() || null,
      browser_elapsed_ms: Date.now() - startedAt,
    });
  } finally {
    try { await browser?.close(); } catch { /* deterministic cleanup best effort */ }
  }
}
