((root) => {
  function addDays(dateText, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ''))) return null;
    const date = new Date(`${dateText}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function parse(value) {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('請貼上 Google Maps URL。');

    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('這不是有效 URL。');
    }

    const host = url.hostname.toLowerCase();
    const isGoogleMapsHost = host === 'google.com'
      || host === 'www.google.com'
      || host === 'maps.google.com'
      || host.endsWith('.google.com');
    if (!isGoogleMapsHost || !url.pathname.includes('/maps/')) {
      throw new Error('目前只支援 google.com/maps URL。');
    }

    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch { /* keep raw path */ }

    const searchMatch = path.match(/\/maps\/search\/([^/@]+)/);
    const viewportMatch = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
    const dataIndex = path.indexOf('/data=');
    const data = dataIndex >= 0 ? path.slice(dataIndex + 6) : '';

    const date = data.match(/!1s(\d{4}-\d{2}-\d{2})/)?.[1] || null;
    const nights = Number(data.match(/!1s\d{4}-\d{2}-\d{2}!2i(\d+)/)?.[1] || 0) || null;
    const adults = Number(data.match(/!4m1!1i(\d+)/)?.[1] || 0) || null;
    const price = Number(data.match(/!9i(\d+)/)?.[1] || 0) || null;
    const latitude = viewportMatch ? Number(viewportMatch[1]) : null;
    const longitude = viewportMatch ? Number(viewportMatch[2]) : null;
    const zoom = viewportMatch ? Number(viewportMatch[3]) : null;

    return {
      original_url: url.href,
      search_term: searchMatch ? searchMatch[1] : null,
      latitude,
      longitude,
      zoom,
      check_in: date,
      nights,
      check_out: date && nights ? addDays(date, nights) : null,
      adults,
      max_price_per_night: price,
      data,
      exact_checkout_encoded: Boolean(nights),
      exact_adults_encoded: Boolean(adults),
      exact_price_encoded: Boolean(price),
    };
  }

  function sync(originalUrl, conditions = {}) {
    const parsed = parse(originalUrl);
    let url = new URL(parsed.original_url);
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch { /* keep raw path */ }

    const checkIn = String(conditions.check_in || parsed.check_in || '');
    const checkOut = String(conditions.check_out || parsed.check_out || '');
    const adults = Number(conditions.adults || parsed.adults || 0);
    const budget = Math.round(Number(conditions.max_price_per_night || parsed.max_price_per_night || 0));

    let nights = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(checkIn) && /^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
      const a = Date.parse(`${checkIn}T00:00:00Z`);
      const b = Date.parse(`${checkOut}T00:00:00Z`);
      const value = Math.round((b - a) / 86400000);
      if (Number.isFinite(value) && value > 0) nights = value;
    }

    if (checkIn && /!1s\d{4}-\d{2}-\d{2}/.test(path)) {
      path = path.replace(/!1s\d{4}-\d{2}-\d{2}/, `!1s${checkIn}`);
    }
    if (nights && /!1s\d{4}-\d{2}-\d{2}!2i\d+/.test(path)) {
      path = path.replace(/(!1s\d{4}-\d{2}-\d{2})!2i\d+/, `$1!2i${nights}`);
    }
    if (adults && /!4m1!1i\d+/.test(path)) {
      path = path.replace(/!4m1!1i\d+/, `!4m1!1i${adults}`);
    }
    if (budget && /!9i\d+/.test(path)) {
      path = path.replace(/!9i\d+/, `!9i${budget}`);
    }

    url.pathname = path;
    return {
      url: url.href,
      checkout_synced: !nights || /!1s\d{4}-\d{2}-\d{2}!2i\d+/.test(path),
      adults_synced: !adults || /!4m1!1i\d+/.test(path),
      price_synced: !budget || /!9i\d+/.test(path),
    };
  }

  function mapsSearchFallback(query) {
    const params = new URLSearchParams({ api: '1', query: query || 'hotels' });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  root.GoogleMapsHotelUrl = { parse, sync, addDays, mapsSearchFallback };
})(typeof window !== 'undefined' ? window : globalThis);
