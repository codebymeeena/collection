#!/usr/bin/env python3
"""Collect every English One Piece TCG card named Zoro.

Card data, images and TCGplayer prices come from tcgcsv.com (a daily mirror of
TCGplayer's catalog). Recent sold prices come from PriceCharting, which
tracks eBay sold listings. Output goes to site/data and
site/images so the static site can be served as-is.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
DATA_FILE = os.path.join(SITE, "data", "zoro.json")
IMG_DIR = os.path.join(SITE, "images")

CATEGORY = 68  # One Piece Card Game on TCGplayer (English)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")
NAME_RE = re.compile(r"zoro", re.I)
SKIP_SOLD = os.environ.get("SKIP_SOLD") == "1"


def get(url, binary=False, tries=3, timeout=40):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return body if binary else body.decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            print(f"  ! {url}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    return None


def get_json(url):
    body = get(url)
    return json.loads(body) if body else None


def ext(product, key):
    for item in product.get("extendedData", []):
        if item.get("name") == key:
            return unescape(item.get("value", "")).strip()
    return ""


def variant_of(name):
    tags = re.findall(r"[\(\[]([^)\]]*)[\)\]]", name)
    return ", ".join(t for t in tags if not re.fullmatch(r"\d{3}", t)) or "Standard"


def clean_name(name):
    name = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", name)
    return re.sub(r"\s+-\s+[A-Z]+\d*-\d+$", "", name).strip()


def load_previous():
    try:
        with open(DATA_FILE) as f:
            return {c["productId"]: c for c in json.load(f)["cards"]}
    except Exception:  # noqa: BLE001
        return {}


PC = "https://www.pricecharting.com"
SYNONYMS = {"parallel": "alternate", "alt": "alternate", "aa": "alternate",
            "prerelease": "pre", "release": "", "art": "", "card": "", "ver": "",
            "version": "", "set": "", "english": "", "the": "", "of": "", "and": ""}


def tokens(text):
    out = set()
    for w in re.findall(r"[a-z0-9]+", text.lower().replace("pre-release", "prerelease")):
        w = SYNONYMS.get(w, w)
        if w and not re.fullmatch(r"\d{3}", w):
            out.add(w)
    return out


def pc_search(name, number):
    """PriceCharting rows (title, url, console, ungraded) for one card number."""
    url = f"{PC}/search-products?" + urllib.parse.urlencode(
        {"type": "prices", "q": f"{name} {number}"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            final, html = r.geturl(), r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"  ! PriceCharting search {number}: {e}", flush=True)
        return []
    rows = []
    if "/game/" in final:  # only one match: PriceCharting jumped to it
        title = re.search(r'<h1[^>]*id="product_name"[^>]*>\s*([^<]+)', html)
        console = re.search(r'<a href="/console/([^"]+)"', html)
        rows.append({"title": unescape(title.group(1)).strip() if title else number,
                     "url": final.split("?")[0], "console": console.group(1) if console else "",
                     "html": html})
    else:
        for tr in re.findall(r'<tr id="product-\d+".*?</tr>', html, re.S):
            a = re.search(r'<td class="title">\s*<a href="([^"]+)"[^>]*>\s*([^<]+)</a>', tr)
            console = re.search(r'href="/console/([^"]+)"', tr)
            if a:
                rows.append({"title": unescape(a.group(2)).strip(), "url": a.group(1),
                             "console": console.group(1) if console else ""})
    return [r for r in rows if "japanese" not in r["console"] and "chinese" not in r["console"]
            and number.lower() in r["title"].lower().replace(" ", "")
            + r["url"].lower()]


# Words that make two versions different cards, so they must agree.
KEY_WORDS = {"winner", "participant", "tournament", "judge", "finalist", "champion",
             "top", "alternate", "manga", "sp", "serial", "treasure", "pre", "1st",
             "anniversary", "playmat", "box", "illustration", "gold", "silver",
             "1st", "2nd", "3rd", "place", "regionals", "promo", "jolly", "full"}


def pc_match(card, rows):
    """Pick the PriceCharting product that is the same version of the card."""
    want = tokens(card["variant"]) if card["variant"] != "Standard" else set()
    setw = tokens(card["set"])
    best, best_score = None, 0.0
    for r in rows:
        tags = re.findall(r"\[([^\]]+)\]", r["title"])
        have = tokens(" ".join(tags))
        if not want and not have:
            score = 1.0
        elif want and have:
            score = len(want & have) / len(want | have)
        else:
            score = 0.0
        score -= 0.5 * len((want ^ have) & KEY_WORDS)
        score += 0.15 * len(setw & tokens(r["console"].replace("-", " "))) / max(len(setw), 1)
        if score > best_score:
            best, best_score = r, score
    return (best, best_score) if best_score >= 0.4 else (None, 0.0)


def price_after(html, anchor):
    i = html.find(anchor)
    if i < 0:
        return None
    m = re.search(r'\$([\d,]+\.\d{2})', html[i:i + 400])
    return float(m.group(1).replace(",", "")) if m else None


def pc_details(row):
    html = row.get("html") or get(row["url"], tries=2, timeout=30) or ""
    sold = []
    i = html.find('class="completed-auctions-used')
    if i >= 0:
        block = html[i:html.find("</table>", i)]
        for tr in re.findall(r"<tr.*?</tr>", block, re.S):
            d = re.search(r"(20\d\d-\d\d-\d\d)", tr)
            p = re.search(r'js-price">\s*\$([\d,]+\.\d{2})', tr)
            t = re.search(r'<a[^>]*>\s*([^<]{8,})</a>', tr)
            if d and p:
                sold.append({"date": d.group(1), "price": float(p.group(1).replace(",", "")),
                             "title": unescape(t.group(1)).strip()[:120] if t else ""})
    vol = re.search(r'data-show-tab="completed-auctions-used">.*?<a href="#">([^<]+)</a>', html, re.S)
    return {
        "title": row["title"], "url": row["url"],
        "ungraded": price_after(html, 'id="used_price"'),
        "psa10": price_after(html, 'id="manual_only_price"'),
        "volume": vol.group(1).strip() if vol else "",
        "recentSales": sold[:10],
    }


def main():
    previous = load_previous()
    groups = get_json(f"https://tcgcsv.com/tcgplayer/{CATEGORY}/groups")
    if not groups:
        sys.exit("Could not reach tcgcsv.com")
    groups = [g for g in groups["results"]
              if not re.search(r"japanese|\bjp\b", g["name"], re.I)]
    print(f"{len(groups)} English groups")

    cards = []
    for g in groups:
        gid = g["groupId"]
        products = get_json(f"https://tcgcsv.com/tcgplayer/{CATEGORY}/{gid}/products")
        if not products:
            continue
        # Match on the name without its "(Zoro Deck)"-style tags, so other
        # characters from Zoro-themed decks are left out.
        zoros = [p for p in products["results"]
                 if NAME_RE.search(clean_name(p["name"])) and ext(p, "Number")]
        if not zoros:
            continue
        prices = get_json(f"https://tcgcsv.com/tcgplayer/{CATEGORY}/{gid}/prices") or {"results": []}
        price_by_id = {}
        for pr in prices["results"]:
            cur = price_by_id.get(pr["productId"])
            if not cur or (pr.get("marketPrice") or 0) > (cur.get("marketPrice") or 0):
                price_by_id[pr["productId"]] = pr
        print(f"{g['name']}: {len(zoros)} Zoro cards", flush=True)
        for p in zoros:
            pr = price_by_id.get(p["productId"], {})
            number = ext(p, "Number")
            cards.append({
                "productId": p["productId"],
                "name": p["name"],
                "baseName": clean_name(p["name"]),
                "variant": variant_of(p["name"]),
                "number": number,
                "set": g["name"],
                "setCode": (g.get("abbreviation") or number.split("-")[0]).upper(),
                "rarity": ext(p, "Rarity"),
                "cost": ext(p, "Cost"),
                "color": ext(p, "Color"),
                "type": ext(p, "CardType"),
                "power": ext(p, "Power"),
                "counter": ext(p, "Counterplus"),
                "attribute": ext(p, "Attribute"),
                "subtypes": ext(p, "Subtypes") or ext(p, "SubTypes"),
                "effect": re.sub(r"<[^>]+>", " ", ext(p, "Description")).strip(),
                "released": (g.get("publishedOn") or "")[:10],
                "imageRemote": (p.get("imageUrl") or "").replace("_200w", "_in_1000x1000"),
                "tcgplayerUrl": p.get("url") or f"https://www.tcgplayer.com/product/{p['productId']}",
                "tcgMarket": pr.get("marketPrice"),
                "tcgLow": pr.get("lowPrice"),
                "tcgMid": pr.get("midPrice"),
                "printing": pr.get("subTypeName"),
            })

    print(f"Found {len(cards)} Zoro cards")
    os.makedirs(IMG_DIR, exist_ok=True)
    for c in cards:
        official = f"https://en.onepiece-cardgame.com/images/cardlist/card/{c['number']}.png"
        if c["variant"] == "Standard":
            # Bandai's own image has no "SAMPLE" stamp and is this exact print.
            sources = [(official, "png", None), (c["imageRemote"], "jpg", None)]
        else:
            # Alt arts etc.: TCGplayer's photo is this exact version; Bandai's
            # fallback shows the standard art of the same card number.
            sources = [(c["imageRemote"], "jpg", None),
                       (official, "png", "Official standard art (no photo of this version yet)")]
        path = None
        for url, ext_, note in sources:
            candidate = os.path.join(IMG_DIR, f"{c['productId']}.{ext_}")
            if os.path.exists(candidate):
                path = candidate
            elif url:
                img = get(url, binary=True, tries=2)
                if img and len(img) > 1000:
                    with open(candidate, "wb") as f:
                        f.write(img)
                    path = candidate
            if path:
                if note:
                    c["imageNote"] = note
                break
        c["image"] = f"images/{os.path.basename(path)}" if path else c["imageRemote"]

        query = f"{c['number']} {c['baseName']} {'' if c['variant'] == 'Standard' else c['variant']}".strip()
        c["ebayUrl"] = ("https://www.ebay.com/sch/i.html?" + urllib.parse.urlencode(
            {"_nkw": query + " one piece -japanese", "LH_Sold": "1", "LH_Complete": "1"}))
        c["collectrUrl"] = "https://app.getcollectr.com/?query=" + urllib.parse.quote(f"{c['baseName']} {c['number']}")
        c["pricechartingUrl"] = f"{PC}/search-products?" + urllib.parse.urlencode(
            {"type": "prices", "q": f"{c['baseName']} {c['number']}"})

    # Recent sold prices (PriceCharting tracks eBay sold listings). eBay itself
    # refuses requests from GitHub's servers, so it is linked instead.
    searches = {}
    for c in cards:
        c["sold"] = None
        if SKIP_SOLD:
            continue
        key = (c["baseName"], c["number"])
        if key not in searches:
            searches[key] = pc_search(*key)
            time.sleep(1)
        row, c["_score"] = pc_match(c, searches[key])
        c["_row"] = row

    # Two versions must not share one PriceCharting product: keep the closest.
    best_for = {}
    for c in cards:
        if c.get("_row"):
            u = c["_row"]["url"]
            if u not in best_for or c["_score"] > best_for[u]["_score"]:
                best_for[u] = c
    for c in cards:
        row = c.pop("_row", None)
        c.pop("_score", None)
        if row and best_for[row["url"]] is not c:
            row = None
        if row:
            try:
                c["sold"] = pc_details(row)
            except Exception as e:  # noqa: BLE001
                print(f"  ! PriceCharting {row['url']}: {e}", flush=True)
            time.sleep(1)
        # Keep last week's numbers only if PriceCharting didn't answer this time.
        if (c["sold"] is None and not searches.get((c["baseName"], c["number"]))
                and previous.get(c["productId"], {}).get("sold")):
            c["sold"] = previous[c["productId"]]["sold"]
        print(f"  {c['number']} {c['variant'][:40]:40} -> "
              f"{c['sold']['title'] if c['sold'] else '-'}", flush=True)

    got = sum(1 for c in cards if c["sold"])
    sales = sum(1 for c in cards if c["sold"] and c["sold"]["recentSales"])
    print(f"Sold-price data for {got}/{len(cards)} cards ({sales} with recent sales list)")
    keep = {os.path.basename(c["image"]) for c in cards}
    for f in os.listdir(IMG_DIR):
        if f.endswith((".jpg", ".png")) and f not in keep:
            os.remove(os.path.join(IMG_DIR, f))
    cards.sort(key=lambda c: (c["released"], c["number"], c["productId"]))
    with open(DATA_FILE, "w") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                   "cards": cards}, f, indent=1)


if __name__ == "__main__":
    main()
