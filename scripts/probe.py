import json, re, urllib.request
H = {"User-Agent": "Mozilla/5.0"}
def j(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=40) as r:
        return json.load(r)
for g in j("https://tcgcsv.com/tcgplayer/68/groups")["results"]:
    for p in j(f"https://tcgcsv.com/tcgplayer/68/{g['groupId']}/products")["results"]:
        ext = {e["name"]: e["value"][:50] for e in p.get("extendedData", [])}
        if (ext.get("Number") in ("EB02-020", "OP11-080")
                or re.search(r"watermelon|oda", p["name"], re.I)):
            print(g["groupId"], g["name"][:45], "|", p["productId"], p["name"], "|",
                  {k: ext.get(k) for k in ("Number", "Rarity", "CardType", "Color")})
