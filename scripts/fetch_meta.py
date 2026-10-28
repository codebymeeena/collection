#!/usr/bin/env python3
"""Leaders, meta share and recent decklists for the Matchup Tips tab.

Every English leader comes from tcgcsv.com (TCGplayer's catalogue) with its real effect
text. The newest decks come from Limitless Play's public API (online tournaments, last
RECENT_DAYS days): play share, win rate, the best recent list, the cards most lists run, and
real leader-vs-leader results from the round pairings. Leaders with no online results fall
back to onepiece.limitlesstcg.com (in-person events, which lag behind), and leaders with no
list anywhere get the cards that support them. Output: site/data/meta.json.
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
TOP_DECKS = 30  # leaders to pull an in-person decklist for, by play share
PLAY = "https://play.limitlesstcg.com"
RECENT_DAYS = 30
MIN_PLAYERS = 8


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


def get_json(url):
    body = get(url)
    try:
        return json.loads(body) if body else None
    except ValueError:
        return None


def play_data():
    """Recent online tournaments from Limitless Play: lists per leader + matchup results."""
    cutoff = time.time() - RECENT_DAYS * 86400
    tournaments, page = [], 1
    while page <= 20:
        batch = get_json(f"{PLAY}/api/tournaments?game=OP&limit=100&page={page}") or []
        if not batch:
            break
        for t in batch:
            when = datetime.fromisoformat(t["date"].replace("Z", "+00:00")).timestamp()
            if when < cutoff:
                page = 99
                break
            # Standard constructed only ("EXTRA" and other side formats have different card pools).
            if (t.get("players") or 0) >= MIN_PLAYERS and (t.get("format") or "STANDARD").upper() == "STANDARD":
                tournaments.append(t)
        page += 1
    print(f"{len(tournaments)} online tournaments in the last {RECENT_DAYS} days")

    entries, matchups = [], {}
    for t in tournaments:
        standings = get_json(f"{PLAY}/api/tournaments/{t['id']}/standings") or []
        leader_of = {}
        for s in standings:
            d = s.get("decklist") or {}
            lead = d.get("leader") or {}
            if not lead.get("set"):
                continue
            lid = f"{lead['set']}-{lead['number']}"
            leader_of[s.get("player")] = lid
            rec = s.get("record") or {}
            cards = [{"id": f"{c['set']}-{c['number']}", "count": c.get("count", 1)}
                     for part in ("character", "event", "stage") for c in (d.get(part) or []) if c.get("set")]
            entries.append({"leader": lid, "player": s.get("player"), "placing": s.get("placing") or 999,
                            "wins": rec.get("wins", 0), "losses": rec.get("losses", 0), "ties": rec.get("ties", 0),
                            "players": t.get("players"), "date": t["date"][:10], "event": t.get("name", ""),
                            "tid": t["id"], "cards": cards})
        for m in get_json(f"{PLAY}/api/tournaments/{t['id']}/pairings") or []:
            a, b = leader_of.get(m.get("player1")), leader_of.get(m.get("player2"))
            if not a or not b or a == b:
                continue
            w = m.get("winner")
            for me, opp, me_player in ((a, b, m.get("player1")), (b, a, m.get("player2"))):
                r = matchups.setdefault(f"{me}|{opp}", [0, 0, 0])
                r[0 if w == me_player else 2 if w in (0, -1, "0", "-1", None, "") else 1] += 1
        time.sleep(0.3)
    print(f"{len(entries)} decklists, {sum(sum(v) for v in matchups.values()) // 2} games with both leaders known")
    return entries, matchups


def summarize(entries):
    """Per leader: share, win rate, best recent list and the cards most lists play."""
    total = len(entries) or 1
    by_leader = {}
    for e in entries:
        by_leader.setdefault(e["leader"], []).append(e)
    out = {}
    for lid, es in by_leader.items():
        wins = sum(e["wins"] for e in es)
        losses = sum(e["losses"] for e in es)
        # Best record among the last two weeks' lists (older ones only if there are none).
        fresh = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 14 * 86400))
        best = max(es, key=lambda e: (e["date"] >= fresh, e["wins"] - e["losses"], -e["placing"] / max(e["players"], 1), e["date"]))
        usage = {}
        for e in es:
            for c in e["cards"]:
                u = usage.setdefault(c["id"], [0, 0])
                u[0] += 1
                u[1] += c["count"]
        core = sorted(({"id": cid, "pct": round(100 * n / len(es)), "avg": round(tot / n, 1)}
                       for cid, (n, tot) in usage.items()), key=lambda c: (-c["pct"], -c["avg"]))
        out[lid] = {
            "meta": {"share": round(100 * len(es) / total, 2), "lists": len(es),
                     "winRate": round(100 * wins / (wins + losses)) if wins + losses else None,
                     "source": f"Limitless Play online events, last {RECENT_DAYS} days"},
            "deck": {"source": "Limitless Play", "event": best["event"], "date": best["date"],
                     "format": "online", "placement": f"{best['placing']} of {best['players']} ({best['wins']}-{best['losses']})",
                     "url": f"{PLAY}/tournament/{best['tid']}/player/{best['player']}/decklist",
                     "cards": best["cards"]},
            "core": [c for c in core if c["pct"] >= 25][:40],
        }
    return out


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
    entries, matchups = play_data()
    online = summarize(entries)
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
    for lid, o in online.items():  # newest data wins
        if lid in by_id:
            by_id[lid].update(o)
    for row in sorted(meta, key=lambda r: -r["share"])[:TOP_DECKS]:
        leader = by_id.get(row["leader"])
        if leader and not leader["deck"]:
            leader["deck"] = latest_list(row["deckId"])
            time.sleep(0.5)
    for l in leaders:
        if not l["deck"]:
            l["support"] = support_cards(cards[l["id"]], cards)

    used = {c["id"] for l in leaders for c in (l["deck"] or {}).get("cards", []) + l.get("support", []) + l.get("core", [])}
    card_text = {cid: {k: cards[cid][k] for k in ("name", "type", "color", "cost", "power", "counter", "effect")}
                 for cid in used if cid in cards}
    with_deck = sum(1 for l in leaders if l["deck"])
    newest_list = max((e["date"] for e in entries), default="")
    print(f"{len(leaders)} leaders, {with_deck} with a decklist, {len(online)} with online results (newest {newest_list})")
    known = set(by_id)
    with open(OUT, "w") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                   "newestList": newest_list, "recentDays": RECENT_DAYS, "leaders": leaders, "cards": card_text,
                   "matchups": {k: v for k, v in matchups.items() if set(k.split("|")) <= known}},
                  f, separators=(",", ":"))


if __name__ == "__main__":
    main()
