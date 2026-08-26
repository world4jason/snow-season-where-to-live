export function addDays(dateText, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ''))) return null;
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function nightsBetween(checkIn, checkOut) {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const nights = Math.round((b - a) / 86400000);
  return nights > 0 ? nights : null;
}

export function parseGoogleMapsHotelUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('google_maps_url is required for the Browser Run POC');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid Google Maps URL');
  }

  const host = url.hostname.toLowerCase();
  if (!(host === 'google.com' || host === 'www.google.com' || host === 'maps.google.com' || host.endsWith('.google.com'))) {
    throw new Error('Only google.com Maps URLs are supported');
  }

  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep encoded path */ }
  if (!path.includes('/maps/')) throw new Error('URL is not a Google Maps URL');

  const searchMatch = path.match(/\/maps\/search\/([^/@]+)/);
  const viewportMatch = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
  const dataIndex = path.indexOf('/data=');
  const data = dataIndex >= 0 ? path.slice(dataIndex + 6) : '';
  const checkIn = data.match(/!1s(\d{4}-\d{2}-\d{2})/)?.[1] || null;
  const nights = Number(data.match(/!1s\d{4}-\d{2}-\d{2}!2i(\d+)/)?.[1] || 0) || null;
  const adults = Number(data.match(/!4m1!1i(\d+)/)?.[1] || 0) || null;
  const price = Number(data.match(/!9i(\d+)/)?.[1] || 0) || null;

  return {
    original_url: url.href,
    search_term: searchMatch ? searchMatch[1] : null,
    latitude: viewportMatch ? Number(viewportMatch[1]) : null,
    longitude: viewportMatch ? Number(viewportMatch[2]) : null,
    zoom: viewportMatch ? Number(viewportMatch[3]) : null,
    check_in: checkIn,
    nights,
    check_out: checkIn && nights ? addDays(checkIn, nights) : null,
    adults,
    max_price_per_night: price,
    data,
  };
}

export function buildSynchronizedMapsHotelUrl(originalUrl, conditions = {}) {
  const parsed = parseGoogleMapsHotelUrl(originalUrl);
  const checkIn = String(conditions.check_in || parsed.check_in || '');
  const checkOut = String(conditions.check_out || parsed.check_out || '');
  const adults = Number(conditions.adults || parsed.adults || 0);
  const budget = Math.round(Number(conditions.max_price_per_night || parsed.max_price_per_night || 0));
  const nights = nightsBetween(checkIn, checkOut);

  if (!parsed.latitude || !parsed.longitude || !parsed.zoom) throw new Error('Google Maps URL must include @latitude,longitude,zoom');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !nights) throw new Error('Valid check-in/check-out are required');
  if (!Number.isInteger(adults) || adults < 1 || adults > 6) throw new Error('Adults must be 1–6');
  if (!Number.isFinite(budget) || budget < 1) throw new Error('Nightly budget must be positive');

  const source = new URL(parsed.original_url);
  const searchTerm = parsed.search_term || 'hotels';
  source.pathname = `/maps/search/${encodeURIComponent(searchTerm)}/@${parsed.latitude},${parsed.longitude},${parsed.zoom}z/data=!4m9!2m8!5m6!5m4!1s${checkIn}!2i${nights}!4m1!1i${adults}!9i${budget}!6e3`;
  source.searchParams.set('entry', 'ttu');
  source.searchParams.set('hl', 'zh-TW');
  source.searchParams.set('gl', 'tw');

  return source.href;
}

export function parseTwdPrice(text) {
  const source = String(text || '').replace(/\u00a0/g, ' ');
  const regex = /(?:NT\$|TWD\s*|\$)\s*([0-9]+(?:[,.][0-9]+)*)\s*(萬)?/gi;
  const values = [];
  let match;
  while ((match = regex.exec(source))) {
    const token = match[1].replace(/,/g, '');
    let value = Number(token);
    if (!Number.isFinite(value)) continue;
    if (match[2]) value *= 10000;
    value = Math.round(value);
    if (value > 0) values.push(value);
  }
  return values.length ? values[0] : null;
}

export function parseRatingAndReviews(text) {
  const source = String(text || '');
  const ratingMatch = source.match(/(?:^|\s)([1-5](?:\.[0-9])?)(?=\s*(?:★|⭐|stars?|\(|$))/i)
    || source.match(/([1-5]\.[0-9])/);
  const reviewMatch = source.match(/\(([0-9][0-9,]*)\)/);
  return {
    rating: ratingMatch ? Number(ratingMatch[1]) : null,
    reviews: reviewMatch ? Number(reviewMatch[1].replace(/,/g, '')) : null,
  };
}

export function coordinatesFromMapsUrl(href) {
  const text = String(href || '');
  const bang = text.match(/!3d(-?\d+(?:\.\d+)?)[^!]*!4d(-?\d+(?:\.\d+)?)/);
  if (bang) return { latitude: Number(bang[1]), longitude: Number(bang[2]) };
  const at = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/);
  if (at) return { latitude: Number(at[1]), longitude: Number(at[2]) };
  return { latitude: null, longitude: null };
}

export function normalizeHotelName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function namesMatch(a, b) {
  const left = normalizeHotelName(a);
  const right = normalizeHotelName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const min = Math.min(left.length, right.length);
  if (min >= 7 && (left.includes(right) || right.includes(left))) return true;
  return false;
}

export function compareProviderResults(browserProperties = [], serpProperties = [], currency = 'TWD') {
  const browserTop = browserProperties.slice(0, 10);
  const serpTop = serpProperties.slice(0, 10);
  const usedSerp = new Set();
  const matches = [];

  browserTop.forEach((browserRow) => {
    const index = serpTop.findIndex((serpRow, i) => !usedSerp.has(i) && namesMatch(browserRow.name, serpRow.name));
    if (index < 0) return;
    usedSerp.add(index);
    const serpRow = serpTop[index];
    const browserPrice = Number(browserRow.nightly_price);
    const serpPrice = Number(serpRow.nightly_price);
    const tolerance = Number.isFinite(serpPrice) ? Math.max(currency === 'TWD' ? 200 : 5, serpPrice * 0.05) : null;
    const delta = Number.isFinite(browserPrice) && Number.isFinite(serpPrice) ? Math.abs(browserPrice - serpPrice) : null;
    matches.push({
      browser_name: browserRow.name,
      serpapi_name: serpRow.name,
      browser_price: Number.isFinite(browserPrice) ? browserPrice : null,
      serpapi_price: Number.isFinite(serpPrice) ? serpPrice : null,
      price_delta: delta,
      price_tolerance: tolerance,
      price_agrees: delta != null && tolerance != null ? delta <= tolerance : null,
    });
  });

  const denominator = Math.min(10, Math.max(browserTop.length, serpTop.length));
  const overlap = denominator ? matches.length / denominator : (browserTop.length === 0 && serpTop.length === 0 ? 1 : 0);
  const priced = matches.filter((row) => row.price_agrees != null);
  const priceAgreement = priced.length ? priced.filter((row) => row.price_agrees).length / priced.length : null;
  const browserLowest = browserProperties.length ? Math.min(...browserProperties.map((row) => Number(row.nightly_price)).filter(Number.isFinite)) : null;
  const serpLowest = serpProperties.length ? Math.min(...serpProperties.map((row) => Number(row.nightly_price)).filter(Number.isFinite)) : null;

  return {
    top10_overlap: overlap,
    matched_count: matches.length,
    price_agreement: priceAgreement,
    browser_lowest_price: Number.isFinite(browserLowest) ? browserLowest : null,
    serpapi_lowest_price: Number.isFinite(serpLowest) ? serpLowest : null,
    matches,
    gate: {
      overlap_pass: overlap >= 0.70,
      price_pass: priceAgreement == null ? false : priceAgreement >= 0.80,
    },
  };
}
