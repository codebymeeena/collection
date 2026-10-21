import json, re, urllib.request
H = {"User-Agent": "Mozilla/5.0"}
def j(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=40) as r:
        return json.load(r)
groups = j("https://tcgcsv.com/tcgplayer/68/groups")["results"]
n = 0
for g in groups:
    if re.search(r"japanese", g["name"], re.I):
        continue
    for p in j(f"https://tcgcsv.com/tcgplayer/68/{g['groupId']}/products")["results"]:
        if "don" in p["name"].lower() and re.search(r"luffy|zoro", p["name"], re.I):
            n += 1
            ext = {e["name"]: e["value"][:40] for e in p.get("extendedData", [])}
            print(g["groupId"], g["name"][:40], "|", p["productId"], p["name"], "|", ext, "|", p.get("imageUrl"))
print("total", n)
