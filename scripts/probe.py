import re, urllib.request
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"}
def g(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=30) as r:
        return r.read().decode("utf-8", "replace")
B = "https://onepiece.limitlesstcg.com"
t = g(B + "/decks")
for m in re.finditer(r'one-piece/\w+/([A-Z0-9-]+)_EN\.webp.*?href="/decks/(\d+)">\s*<span class="sm-only">([^<]*)</span>\s*<span>([^<]*)</span>.*?<td>(\d+)</td>\s*<td>([\d.]+%)</td>', t, re.S):
    print("DECK", m.groups())
print("FORMAT SELECT", re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)</option>', t)[:30])
c = g(B + "/decks/98/cards")
body = re.sub(r"\s+", " ", re.sub(r"<script.*?</script>|<style.*?</style>", "", c, flags=re.S))
i = body.find("<table"); print("CARDS PAGE", body[i:i+2500])
l = g(B + "/decks/list/6838")
body = re.sub(r"\s+", " ", re.sub(r"<script.*?</script>|<style.*?</style>", "", l, flags=re.S))
i = body.find("decklist-card"); i = i if i >= 0 else body.find("<body")
print("LIST PAGE", body[i:i+3000])
print("LIST PAGE2", re.findall(r'data-[a-z-]+="[^"]*"', l)[:40])
