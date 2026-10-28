import re, urllib.request, json
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", "Accept": "*/*"}
def g(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:
        return str(e), ""
def strip(t): return re.sub(r"\s+", " ", re.sub(r"<script.*?</script>|<style.*?</style>|<[^>]+>", " ", t, flags=re.S))
# 1. Limitless play (online tournaments) public API
st, t = g("https://play.limitlesstcg.com/api/tournaments?game=OP&limit=15")
print("PLAY API", st, t[:1500])
try:
    ts = json.loads(t)
    for tr in ts[:15]:
        print("  T", tr.get("id"), tr.get("date"), tr.get("name"), tr.get("format"), tr.get("players"))
    if ts:
        st2, s2 = g(f"https://play.limitlesstcg.com/api/tournaments/{ts[0]['id']}/standings")
        print("STANDINGS", st2, s2[:1500])
except Exception as e:
    print("parse", e)
# 2. onepiece.gg decks
for u in ["https://onepiece.gg/decks/", "https://onepiece.gg/meta/", "https://onepiece.gg/tier-list/", "https://onepiece.gg/tournaments/"]:
    st, t = g(u); s = strip(t)
    print("=" * 8, u, st, len(t), "| OP17 mentions", s.count("OP17"), "| Rocks", s.count("Rocks"))
    print("   ", s[:600])
    print("    links:", sorted(set(re.findall(r'href="(https://onepiece\.gg/[^"#?]*(?:deck|tier|meta|tournament)[^"#?]*)"', t)))[:25])
# 3. onepiecetopdecks deck-list page: find OP17 sections and deck links
st, t = g("https://onepiecetopdecks.com/deck-list/")
s = strip(t); i = s.find("OP17")
print("TOPDECKS", st, "OP17 at", i, s[max(0,i-300):i+1200])
print("  deck links:", sorted(set(re.findall(r'href="(https://onepiecetopdecks\.com/deck-list/[^"]+)"', t)))[:40])
# 4. Official Bandai EN event decklists
for u in ["https://en.onepiece-cardgame.com/events/", "https://en.onepiece-cardgame.com/feature/deck/"]:
    st, t = g(u); s = strip(t); print("BANDAI", u, st, len(t), s[:300])
