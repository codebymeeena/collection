import re, urllib.request, json
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"}
def g(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:
        return str(e), ""
def strip(t): return re.sub(r"\s+", " ", re.sub(r"<script.*?</script>|<style.*?</style>|<[^>]+>", " ", t, flags=re.S))
for u in ["https://onepiece.limitlesstcg.com/decks?time=1months", "https://onepiece.limitlesstcg.com/tournaments?time=1months",
          "https://onepiecetopdecks.com/", "https://onepiecetopdecks.com/deck-list/", "https://www.gumgum.gg/decklists",
          "https://www.egmanevents.com/one-piece-tcg-meta", "https://onepiece.gg/", "https://play.limitlesstcg.com/tournaments/completed?game=OP"]:
    st, t = g(u); s = strip(t)
    print("=" * 10, u, st, len(t)); print("  rocks:", [s[max(0, m.start()-80):m.start()+80] for m in re.finditer(r"Rocks", s)][:3])
    print("  dates:", sorted(set(re.findall(r"(?:Oct|Sep|October|September)\w* \d{1,2},? 2026|2026-(?:09|10)-\d\d", s)))[:8])
    print("  head:", s[:400])
# tcgcsv leaders named Rocks
grp = json.loads(g("https://tcgcsv.com/tcgplayer/68/groups")[1])["results"]
for gg in grp[:12]:
    pr = json.loads(g(f"https://tcgcsv.com/tcgplayer/68/{gg['groupId']}/products")[1])["results"]
    for p in pr:
        if "rocks" in p["name"].lower():
            ext = {e["name"]: e["value"][:200] for e in p.get("extendedData", [])}
            print("ROCKS", gg["name"], p["name"], ext.get("Number"), ext.get("CardType"), ext.get("Color"), ext.get("Description"))
print("NEWEST GROUPS", [(x["name"], x.get("publishedOn", "")[:10]) for x in sorted(grp, key=lambda x: x.get("publishedOn", ""), reverse=True)[:8]])
