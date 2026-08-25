import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "watches.json"
LATEST_PATH = ROOT / "data" / "latest.json"
HISTORY_PATH = ROOT / "data" / "history.json"


def load_json(path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")


def nights_between(check_in, check_out):
    start = datetime.strptime(check_in, "%Y-%m-%d")
    end = datetime.strptime(check_out, "%Y-%m-%d")
    return max(1, (end - start).days)


def serpapi_search(api_key, watch):
    params = {
        "engine": "google_hotels",
        "q": watch["query"],
        "check_in_date": watch["check_in"],
        "check_out_date": watch["check_out"],
        "adults": watch.get("adults", 2),
        "currency": watch.get("currency", "TWD"),
        "max_price": watch["max_price_per_night"],
        "sort_by": 3,
        "api_key": api_key,
    }
    url = "https://serpapi.com/search.json?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "snow-season-where-to-live/1.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def normalize_property(prop, nights):
    nightly = (prop.get("rate_per_night") or {}).get("extracted_lowest")
    total = (prop.get("total_rate") or {}).get("extracted_lowest")
    if nightly is None and total is not None:
        nightly = round(total / nights)

    prices = prop.get("prices") or []
    source = prices[0].get("source") if prices else None
    link = None
    for candidate in prices:
        if candidate.get("link"):
            link = candidate["link"]
            source = candidate.get("source") or source
            break
    if not link:
        link = prop.get("link")

    gps = prop.get("gps_coordinates") or {}
    return {
        "name": prop.get("name") or "Unknown hotel",
        "nightly_price": nightly,
        "total_price": total,
        "rating": prop.get("overall_rating"),
        "reviews": prop.get("reviews"),
        "source": source,
        "link": link,
        "thumbnail": prop.get("thumbnail"),
        "latitude": gps.get("latitude"),
        "longitude": gps.get("longitude"),
        "hotel_class": prop.get("hotel_class"),
    }


def maybe_notify(webhook_url, events):
    if not webhook_url or not events:
        return
    lines = ["❄️ Ski Stay Watcher"]
    for event in events:
        lines.append(f"• {event['watch']}: {event['message']}")
    payload = json.dumps({"content": "\n".join(lines)}).encode("utf-8")
    req = urllib.request.Request(webhook_url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20):
        pass


def main():
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        print("SERPAPI_KEY is required", file=sys.stderr)
        sys.exit(2)

    watches = load_json(CONFIG_PATH, [])
    previous = load_json(LATEST_PATH, {"watches": []})
    previous_by_id = {item.get("id"): item for item in previous.get("watches", [])}
    checked_at = datetime.now(timezone.utc).isoformat()
    output = {"checked_at": checked_at, "watches": []}
    history = load_json(HISTORY_PATH, [])
    events = []

    for watch in watches:
        nights = nights_between(watch["check_in"], watch["check_out"])
        try:
            raw = serpapi_search(api_key, watch)
            properties = [normalize_property(p, nights) for p in raw.get("properties", [])]
            properties = [p for p in properties if p.get("nightly_price") is not None]
            properties = [p for p in properties if p["nightly_price"] <= watch["max_price_per_night"]]
            properties.sort(key=lambda p: p["nightly_price"])
            error = None
        except Exception as exc:
            properties = []
            error = str(exc)

        current = {
            **watch,
            "nights": nights,
            "match_count": len(properties),
            "lowest_price": properties[0]["nightly_price"] if properties else None,
            "properties": properties[:20],
            "error": error,
        }
        output["watches"].append(current)

        prev = previous_by_id.get(watch["id"], {})
        prev_count = prev.get("match_count", 0) or 0
        prev_low = prev.get("lowest_price")
        if not error:
            if prev_count == 0 and current["match_count"] > 0:
                events.append({"watch": watch["name"], "message": f"找到 {current['match_count']} 間，最低 {watch.get('currency', 'TWD')} {current['lowest_price']:,.0f}/晚"})
            elif current["lowest_price"] is not None and prev_low is not None and current["lowest_price"] < prev_low:
                events.append({"watch": watch["name"], "message": f"最低價降到 {watch.get('currency', 'TWD')} {current['lowest_price']:,.0f}/晚（原 {prev_low:,.0f}）"})

        history.append({
            "checked_at": checked_at,
            "id": watch["id"],
            "name": watch["name"],
            "match_count": current["match_count"],
            "lowest_price": current["lowest_price"],
            "currency": watch.get("currency", "TWD"),
            "error": error,
        })

    history = history[-1000:]
    save_json(LATEST_PATH, output)
    save_json(HISTORY_PATH, history)
    maybe_notify(os.environ.get("DISCORD_WEBHOOK_URL"), events)
    print(json.dumps({"checked_at": checked_at, "events": events, "watch_count": len(watches)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
