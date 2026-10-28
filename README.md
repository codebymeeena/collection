# One Piece Card Collection

A website with a tab per character — **Zoro** and **Luffy** so far — listing every **English** One Piece TCG card with that name in it (Roronoa Zoro, Zoro-Juurou, Monkey.D.Luffy, Luffytaro…) plus their DON!! cards with:

- card picture, name, card number, set, rarity, variant (parallel / alt art / manga…)
- cost, colour, type and power, and whether it is **foil or non-foil** (cards sold in both finishes are listed twice, each with its own price and counter)
- **all prices in Canadian dollars** (sources quote USD; the weekly job saves the current USD→CAD rate to `site/data/fx.json`)
- TCGplayer market + low price, recent **sold** price for raw English copies (PriceCharting, from eBay sales), PSA 10 price and a list of recent sales
- links to eBay sold listings, TCGplayer, Collectr and PriceCharting for each card
- a **quantity counter** (− / +) for how many copies you own, with tabs for *All*, *I have* and *I need*, and totals for what your
  collection is worth and what it would cost to finish

## Binder Business tab

A third tab tracks the binder painting business: log supply purchases (markers, binders, paint,
shipping, other) and binder sales, and it shows profit (all time and this month), money made,
money spent, binders sold, average per binder, spending by type and a month-by-month table.
Entries can be edited or deleted. They are saved in the browser; **Backup** / **Restore** move them
between devices and **Download CSV** opens in Excel / Google Sheets.

## Sync & share (☁ button)

`worker.js` adds a small sync API on Cloudflare D1 (database `collection-sync`, bound as `DB` in
`wrangler.jsonc`). Press ☁ → **Turn on sync** to get a private sync code; type it on another device
(☁ → Connect) to keep card counts and binder business entries in sync. ☁ → **Copy share link** gives a
view-only link for anyone else.

## Matchup Tips tab

Pick your leader and your opponent's; `/api/tips` (in `worker.js`) asks Cloudflare's free Workers AI
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, binding `AI`) for tips, giving it both leaders' real effects
and their newest tournament decklists with full card text. Answers are saved in D1, so a repeated
matchup is instant and free. `scripts/fetch_meta.py` (workflow "Update matchup data", Mondays and
Thursdays) writes `site/data/meta.json`: every English leader from tcgcsv.com, meta share and the best
finish at each leader's newest event from onepiece.limitlesstcg.com, and, for leaders with no
tournament list yet, the cards that support them.

## How it works

- `scripts/fetch_cards.py` pulls the card list, pictures and TCGplayer prices from
  [tcgcsv.com](https://tcgcsv.com) (a daily copy of TCGplayer's catalogue) and recent sold prices
  from PriceCharting (which tracks eBay sold listings; eBay itself blocks automated requests, so each
  card links to its eBay sold search instead). Pictures are saved into `site/images/`, data into `site/data/<character>.json`.
- To add another character tab, add a line to `CHARACTERS` at the top of `scripts/fetch_cards.py`.
- The GitHub Action `.github/workflows/update-and-deploy.yml` runs that script on every push and every
  Monday, commits the new data, and deploys `site/` to Cloudflare Pages.

## Your "have" list

Your quantities are saved in your browser. Use **Export my list** to download `owned.json`. To make the list
permanent for every device, replace `site/data/owned.json` in this repo with that file — it's used the
first time the site is opened in a new browser.

## Putting it on Cloudflare (free, default `*.pages.dev` address)

Pick **one** option:

**A. Let GitHub deploy it (automatic after every update)**
1. Cloudflare dashboard → *My Profile → API Tokens → Create Token* → template **"Edit Cloudflare Workers"**
   (or a custom token with *Account → Cloudflare Pages → Edit*). Copy the token.
2. Copy your **Account ID** (right side of the Workers & Pages overview page).
3. GitHub repo → *Settings → Secrets and variables → Actions → New repository secret*:
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. *Actions* tab → **Update cards and deploy** → *Run workflow* (branch `main`).
   Your site will be at **https://zoro-cards.pages.dev** (or a similar name if that one is taken —
   the job log prints the URL).

**B. Connect the repo in Cloudflare**
Workers & Pages → *Create* → *Pages* → *Connect to Git* → pick this repo → production branch `main`,
build command *(leave empty)*, build output directory `site` → *Save and Deploy*.
