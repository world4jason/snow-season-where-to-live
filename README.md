# Snow Season — Where to Live

A zero-server ski accommodation watcher built on **GitHub Pages + GitHub Actions + SerpApi Google Hotels**.

## What it does

- Monitor one or more ski areas for specific stay dates.
- Filter by nightly budget.
- Store the latest matching hotels and lightweight price history in the repository.
- Show a static dashboard on GitHub Pages.
- Run on a schedule through GitHub Actions, so no VPS/database is required.
- Keep `SERPAPI_KEY` in GitHub Actions Secrets; the key never reaches the browser.

## Setup

1. Create a free SerpApi account and get an API key.
2. In this repository, open **Settings → Secrets and variables → Actions**.
3. Add a repository secret named `SERPAPI_KEY`.
4. Edit `config/watches.json` with the ski areas, dates, party size, currency and budget you want to monitor.
5. Run **Actions → Check ski stays → Run workflow** once, or wait for the scheduled run.
6. Enable **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

Optional: add `DISCORD_WEBHOOK_URL` as a repository secret. The checker will post only when a watch changes from no match to match, or when a new lower price enters budget.

## Data flow

```text
GitHub Actions
  └─ scripts/search_hotels.py
       ├─ reads config/watches.json
       ├─ queries SerpApi Google Hotels
       ├─ writes data/latest.json
       └─ appends data/history.json

GitHub Pages
  └─ index.html + app.js
       └─ reads data/latest.json
```

## Notes

- SerpApi results reflect what Google Hotels exposes for the query at check time; "no match" is not a guarantee that no room exists anywhere on the internet.
- The default schedule is once daily to preserve free-tier requests. Change the cron only if your SerpApi quota can support it.
- The sample watches are placeholders and should be edited before the first real run.
