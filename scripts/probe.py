import re, urllib.request
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"}
def g(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=30) as r:
            return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except Exception as e:
        return str(e), u, ""
def show(u, n=3000, pat=None):
    st, final, t = g(u)
    print("=" * 20, u, st, final, len(t))
    body = re.sub(r"\s+", " ", re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S))
    i = body.find(pat) if pat else body.find("<table")
    print(body[max(0, i):max(0, i) + n])
    return t
t = show("https://onepiece.limitlesstcg.com/decks", 3500)
links = sorted(set(re.findall(r'href="(/decks/[^"]+)"', t)))[:30]
print("DECK LINKS", links)
if links:
    d = show("https://onepiece.limitlesstcg.com" + links[0], 3000)
    print("SUBLINKS", sorted(set(re.findall(r'href="(/decks/[^"]+)"', d)))[:40])
    print("LIST LINKS", sorted(set(re.findall(r'href="(/decks/list/[^"]+)"', d)))[:10])
    m = show("https://onepiece.limitlesstcg.com" + links[0] + "/matchups", 3000)
    lst = sorted(set(re.findall(r'href="(/decks/list/[^"]+)"', d)))
    if lst:
        show("https://onepiece.limitlesstcg.com" + lst[0], 3500, pat="decklist")
show("https://onepiece.limitlesstcg.com/tournaments", 2000)
