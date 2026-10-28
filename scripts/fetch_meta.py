#!/usr/bin/env python3
"""Leaders, meta share and recent decklists for the Matchup Tips tab.

Every English leader comes from tcgcsv.com (TCGplayer's catalogue) with its real effect
text. Play share and the newest tournament decklist per leader come from
onepiece.limitlesstcg.com. Leaders without a tournament list get the cards that support
them (same type, matching colours) instead. Output: site/data/meta.json.
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from html import unescape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "data", "meta.json")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")
LIMITLESS = "https://onepiece.limitlesstcg.com"
TOP_DECKS = 30  # leaders to pull a decklist for, by play share


def get(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            print(f"  ! {url}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    return None


def text(html):
    html = re.sub(r"<br\s*/?>", " ", html or "")
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", html))).strip()


def ext(p, key):
    for e in p.get("extendedData", []):
        if e.get("name") == key:
            return e.get("value", "")
    return ""


def load_cards():
    """Number -> card info, preferring the plain (non-variant) printing."""
    groups = json.loads(get("https://tcgcsv.com/tcgplayer/68/groups") or "{}").get("results", [])
    cards = {}
    for g in groups:
        if re.search(r"japanese", g["name"], re.I):
            continue
        body = get(f"https://tcgcsv.com/tcgplayer/68/{g['groupId']}/products")
        for p in (json.loads(body)["results"] if body else []):
            num = ext(p, "Number")
            if not num:
                continue
            plain = not re.search(r"\((?!\d{3}\))[^)]*\)", p["name"])  # no variant tag
            if num in cards and not plain:
                continue
            cards[num] = {
                "id": num,
                "name": re.sub(r"\s*\([^)]*\)|\s+-\s+[A-Z]+\d*-\d+$", "", p["name"]).strip(),
                "type": ext(p, "CardType"),
                "color": ext(p, "Color").replace(";", "/"),
                "cost": ext(p, "Cost"),
                "power": ext(p, "Power"),
                "counter": ext(p, "Counterplus"),
                "life": ext(p, "Life"),
                "subtypes": ext(p, "Subtypes") or ext(p, "SubTypes"),
                "effect": text(ext(p, "Description")),
                "image": (p.get("imageUrl") or "").replace("_200w", "_in_1000x1000"),
                "released": (g.get("publishedOn") or "")[:10],
                "set": g["name"],
            }
    print(f"{len(cards)} card numbers")
    return cards


def limitless_meta():
    html = get(f"{LIMITLESS}/decks")
    if not html:
        return []
    rows = []
    for m in re.finditer(
            r'one-piece/\w+/([A-Z0-9]+-\d+)_EN\.webp.*?href="/decks/(\d+)">\s*<span class="sm-only">([^<]*)</span>\s*'
            r'<span>([^<]*)</span>.*?<td>(\d+)</td>\s*<td>([\d.]+)%</td>', html, re.S):
        leader, deck_id, colors, name, points, share = m.groups()
        rows.append({"leader": leader, "deckId": deck_id, "colors": unescape(colors),
                     "deckName": unescape(name), "points": int(points), "share": float(share)})
    print(f"{len(rows)} Limitless decks")
    return rows


def latest_list(deck_id):
    """Newest decklist on a Limitless deck page (the page lists events newest first)."""
    html = get(f"{LIMITLESS}/decks/{deck_id}")
    if not html:
        return None
    # Rows follow an event heading: take the best finish at the newest event.
    rows, event = [], None
    for m in re.finditer(r'href="/tournaments/\d+">([^<]+)</a>|<td>(\w+)</td>\s*<td>(\d+)\w*</td>.*?href="/decks/list/(\d+)"',
                         html, re.S):
        if m.group(1):
            if rows:
                break
            event = m.group(1)
        elif event:
            rows.append((int(m.group(3)), m.group(2), m.group(4)))
    if not rows:
        return None
    place, fmt, list_id = min(rows)
    place = f"{place}{'th' if 10 <= place % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(place % 10, 'th')}"
    page = get(f"{LIMITLESS}/decks/list/{list_id}")
    if not page:
        return None
    cards = [{"id": cid, "count": int(n)} for n, cid in
             re.findall(r'class="decklist-card" data-count="(\d+)" data-id="([A-Z0-9]+-\d+)"', page)]
    date, _, name = unescape(event).partition(" - ")
    return {"source": "Limitless", "url": f"{LIMITLESS}/decks/list/{list_id}", "event": name or event,
            "date": date, "format": fmt, "placement": place, "cards": cards}


def support_cards(leader, cards):
    """Cards that share the leader's type and fit its colours (for leaders with no list yet)."""
    types = {t.strip() for t in leader["subtypes"].split(";") if t.strip()}
    colors = set(leader["color"].split("/"))
    picks = []
    for c in cards.values():
        if c["type"] in ("Leader", "") or c["id"] == leader["id"]:
            continue
        if not colors & set(c["color"].split("/")):
            continue
        ctypes = {t.strip() for t in c["subtypes"].split(";")}
        mentions = any(t and t in c["effect"] for t in types) or leader["name"] in c["effect"]
        if types & ctypes or mentions:
            picks.append((mentions, bool(types & ctypes), c["released"], c["id"]))
    picks.sort(reverse=True)
    return [{"id": p[3], "count": None} for p in picks[:30]]


def main():
    cards = load_cards()
    if not cards:
        sys.exit("No card data from tcgcsv.com")
    meta = limitless_meta()
    share_by_leader = {}
    for row in meta:
        share_by_leader.setdefault(row["leader"], row)  # first = most played build

    leaders = []
    for c in sorted((c for c in cards.values() if c["type"] == "Leader"), key=lambda c: c["released"], reverse=True):
        row = share_by_leader.get(c["id"])
        leaders.append({
            "id": c["id"], "name": c["name"], "color": c["color"], "life": c["life"], "power": c["power"],
            "subtypes": c["subtypes"], "effect": c["effect"], "image": c["image"], "set": c["set"],
            "released": c["released"],
            "meta": row and {"share": row["share"], "points": row["points"], "deckId": row["deckId"]},
            "deck": None,
        })

    by_id = {l["id"]: l for l in leaders}
    for row in sorted(meta, key=lambda r: -r["share"])[:TOP_DECKS]:
        leader = by_id.get(row["leader"])
        if leader and not leader["deck"]:
            leader["deck"] = latest_list(row["deckId"])
            time.sleep(0.5)
    for l in leaders:
        if not l["deck"]:
            l["support"] = support_cards(cards[l["id"]], cards)

    used = {c["id"] for l in leaders for c in (l["deck"] or {}).get("cards", []) + l.get("support", [])}
    card_text = {cid: {k: cards[cid][k] for k in ("name", "type", "color", "cost", "power", "counter", "effect")}
                 for cid in used if cid in cards}
    with_deck = sum(1 for l in leaders if l["deck"])
    newest_list = max((l["deck"]["date"] for l in leaders if l["deck"]), default="", key=lambda d: datetime.strptime(
        re.sub(r"(\d+)(st|nd|rd|th)", r"\1", d), "%d %B %Y") if re.match(r"\d", d) else datetime.min)
    print(f"{len(leaders)} leaders, {with_deck} with a tournament decklist (newest {newest_list})")
    with open(OUT, "w") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                   "newestList": newest_list, "leaders": leaders, "cards": card_text}, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
