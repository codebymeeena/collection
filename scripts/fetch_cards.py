#!/usr/bin/env python3
"""Collect every English One Piece TCG card for each character in CHARACTERS.

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
DATA_DIR = os.path.join(SITE, "data")
IMG_DIR = os.path.join(SITE, "images")

CATEGORY = 68  # One Piece Card Game on TCGplayer (English)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")
# Tab key -> (tab label, pattern the card's name must contain)
CHARACTERS = {
    "zoro": ("Zoro", re.compile(r"zoro", re.I)),
    "luffy": ("Luffy", re.compile(r"luffy", re.I)),
}
# Cards that belong on a tab but don't have the character's name in their title,
# by card number (every version of that number is included).
EXTRA_NUMBERS = {
    "luffy": {"EB02-020", "OP11-080"},  # "We Are!", "Gear Two"
}
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


def is_don(p):
    return ext(p, "CardType") == "DON!!"


def clean_name(name):
    name = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", name)
    return re.sub(r"\s+-\s+[A-Z]+\d*-\d+$", "", name).strip()


def load_previous(key):
    try:
        with open(os.path.join(DATA_DIR, f"{key}.json")) as f:
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
    time.sleep(1)
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
        "recentSales": sorted(sold, key=lambda x: x["date"], reverse=True)[:10],
    }


def split_finishes(cards):
    """One entry per finish TCGplayer sells, each with its own price.

    `id` is what the site's "I have" tick stores: the non-foil (or only)
    finish keeps the bare product id so ticks made before this split survive.
    """
    out = []
    for c in cards:
        finishes = c.pop("finishes")
        known = bool(finishes)
        finishes = finishes or {"Unknown": {}}  # no TCGplayer listing yet
        only = len(finishes) == 1
        for name, pr in sorted(finishes.items()):
            foil = "foil" in name.lower()
            e = dict(c)
            e.update({
                "id": str(c["productId"]) if only or not foil else f"{c['productId']}-foil",
                "foil": foil,
                "finish": ("Foil" if foil else "Non-foil") if known else "",
                "tcgMarket": pr.get("marketPrice"),
                "tcgLow": pr.get("lowPrice"),
                "tcgMid": pr.get("midPrice"),
                # PriceCharting doesn't split sales by finish.
                "soldAnyFinish": not only,
            })
            out.append(e)
    return out


def load_groups():
    groups = get_json(f"https://tcgcsv.com/tcgplayer/{CATEGORY}/groups")
    if not groups:
        sys.exit("Could not reach tcgcsv.com")
    groups = [g for g in groups["results"]
              if not re.search(r"japanese|\bjp\b", g["name"], re.I)]
    print(f"{len(groups)} English groups")
    for g in groups:
        products = get_json(f"https://tcgcsv.com/tcgplayer/{CATEGORY}/{g['groupId']}/products")
        g["products"] = [p for p in (products or {}).get("results", []) if ext(p, "Number") or is_don(p)]
        g["prices"] = {}
        if not g["products"]:
            continue
        prices = get_json(f"https://tcgcsv.com/tcgplayer/{CATEGORY}/{g['groupId']}/prices") or {"results": []}
        for pr in prices["results"]:
            # One row per finish: "Normal" (non-foil) and/or "Foil".
            g["prices"].setdefault(pr["productId"], {})[pr.get("subTypeName") or "Normal"] = pr
    return groups


def collect(key, label, name_re, groups):
    extra = EXTRA_NUMBERS.get(key, set())
    previous = load_previous(key)
    cards = []
    for g in groups:
        # Match on the name without its "(Zoro Deck)"-style tags, so other
        # characters from a character-themed deck are left out.
        # DON!! cards name the character only in brackets: "DON!! Card (Zoro) (Gold)".
        matches = [p for p in g["products"]
                   if name_re.search(clean_name(p["name"])) or (is_don(p) and name_re.search(p["name"]))
                   or ext(p, "Number") in extra]
        if not matches:
            continue
        price_by_id = g["prices"]
        print(f"{g['name']}: {len(matches)} {label} cards", flush=True)
        for p in matches:
            finishes = price_by_id.get(p["productId"], {})
            number = ext(p, "Number") or ("DON!!" if is_don(p) else "")
            cards.append({
                "productId": p["productId"],
                "name": p["name"],
                "baseName": clean_name(p["name"]),
                "variant": variant_of(p["name"]),
                "number": number,
                "set": g["name"],
                "setCode": (g.get("abbreviation") or number.split("-")[0]).upper(),
                "don": is_don(p),
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
                "finishes": finishes,
            })

    print(f"Found {len(cards)} {label} cards")
    os.makedirs(IMG_DIR, exist_ok=True)
    for c in cards:
        official = f"https://en.onepiece-cardgame.com/images/cardlist/card/{c['number']}.png"
        if c["don"]:
            sources = [(c["imageRemote"], "jpg", None)]  # Bandai's list has no DON!! images by name
        elif c["variant"] == "Standard":
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
        if c["don"]:
            query = f"DON!! card {c['variant'].replace(',', '')}"
        c["ebayUrl"] = ("https://www.ebay.com/sch/i.html?" + urllib.parse.urlencode(
            {"_nkw": query + " one piece -japanese", "LH_Sold": "1", "LH_Complete": "1"}))
        c["collectrUrl"] = "https://app.getcollectr.com/?query=" + urllib.parse.quote(
            query if c["don"] else f"{c['baseName']} {c['number']}")
        c["pricechartingUrl"] = f"{PC}/search-products?" + urllib.parse.urlencode(
            {"type": "prices", "q": f"{label} {c['number']}"})

    # Recent sold prices (PriceCharting tracks eBay sold listings). eBay itself
    # refuses requests from GitHub's servers, so it is linked instead.
    searches = {}
    for c in cards:
        c["sold"] = None
        if SKIP_SOLD or c["don"]:  # DON!! cards have no number to match on PriceCharting
            continue
        if c["number"] not in searches:
            # "We Are!"-style extras don't contain the tab's name; search by their own name.
            who = label if label.lower() in c["baseName"].lower() else c["baseName"]
            searches[c["number"]] = pc_search(who, c["number"])
        row, c["_score"] = pc_match(c, searches[c["number"]])
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
        if (c["sold"] is None and not searches.get(c["number"])
                and previous.get(c["productId"], {}).get("sold")):
            c["sold"] = previous[c["productId"]]["sold"]
        print(f"  {c['number']} {c['variant'][:40]:40} -> "
              f"{c['sold']['title'] if c['sold'] else '-'}", flush=True)

    got = sum(1 for c in cards if c["sold"])
    sales = sum(1 for c in cards if c["sold"] and c["sold"]["recentSales"])
    print(f"Sold-price data for {got}/{len(cards)} cards ({sales} with recent sales list)")
    cards = split_finishes(cards)
    cards.sort(key=lambda c: (c["released"], c["number"], c["productId"], c["foil"]))
    with open(os.path.join(DATA_DIR, f"{key}.json"), "w") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                   "cards": cards}, f, indent=1)
    return cards


def update_exchange_rate():
    """USD -> CAD rate for the site; every source we use quotes in USD."""
    for url, pick in [
        ("https://api.frankfurter.app/latest?from=USD&to=CAD", lambda d: (d["rates"]["CAD"], d["date"])),
        ("https://open.er-api.com/v6/latest/USD", lambda d: (d["rates"]["CAD"], d["time_last_update_utc"][:16])),
    ]:
        try:
            rate, date = pick(get_json(url))
            with open(os.path.join(DATA_DIR, "fx.json"), "w") as f:
                json.dump({"usdToCad": rate, "date": date, "source": url.split("/")[2]}, f, indent=1)
            print(f"USD->CAD {rate} ({date})")
            return
        except Exception as e:  # noqa: BLE001
            print(f"  ! exchange rate from {url}: {e}", flush=True)
    print("  ! no exchange rate; keeping the previous one", flush=True)


def main():
    wanted = sys.argv[1:] or list(CHARACTERS)
    update_exchange_rate()
    groups = load_groups()
    for key in wanted:
        label, name_re = CHARACTERS[key]
        collect(key, label, name_re, groups)

    # Drop pictures no tab uses any more.
    keep = set()
    for key in CHARACTERS:
        for c in load_previous(key).values():
            keep.add(os.path.basename(c["image"]))
    for f in os.listdir(IMG_DIR):
        if f.endswith((".jpg", ".png")) and f not in keep:
            os.remove(os.path.join(IMG_DIR, f))
    with open(os.path.join(DATA_DIR, "characters.json"), "w") as f:
        json.dump([{"key": k, "label": v[0]} for k, v in CHARACTERS.items()], f, indent=1)


if __name__ == "__main__":
    main()
