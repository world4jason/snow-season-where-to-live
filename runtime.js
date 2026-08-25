// Set this after the Cloudflare Worker is deployed, e.g.
// window.SNOW_API_BASE = 'https://snow-season-where-to-live-api.<your-subdomain>.workers.dev';
window.SNOW_API_BASE = '';

(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    const apiBase = String(window.SNOW_API_BASE || '').replace(/\/$/, '');
    if (apiBase && typeof url === 'string' && /(^|\/)data\/latest\.json(?:\?|$)/.test(url)) {
      return originalFetch(`${apiBase}/api/latest`, init);
    }
    return originalFetch(input, init);
  };
})();
