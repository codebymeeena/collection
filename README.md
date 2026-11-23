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
Binder purchases record the binder's pockets (4, 9 or 12), whether it's a top loader, its brand and colour; a sale gets those from the purchase each of its binders is linked to. An order can hold several binders (each line: which binder, how many — or the customer's own), and its binder cost and profit add up all the lines. Each sale can also record the customer's name, where you messaged them (Instagram, TikTok, Facebook /
Marketplace, …) and their username, and can be linked (🔗 Binder used) to the binder purchase it came
from: the sale then shows that binder's cost and the profit on the sale, and the purchase shows how many
of its binders are used and by whom. Choose “Customer brought their own binder” when they supplied it: the sale then has no binder cost. Customer details are hidden on view-only share links.
History can be shown as one list, sales only, expenses only, **By binder** (each binder purchase with the orders that used it, what those binders brought in and their profit, plus customer-own and unlinked binders) or **By supplies** (other expenses grouped by type with totals). Entries can be edited or deleted. They are saved in the browser; **Backup** / **Restore** move them
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

## Golf Scramble tab

Add golfers with a rank (1–5, 5 = strongest), an optional ⭐ top-player flag and an optional
🔗 "same team as" partner. Pick a format:

- **Teams**: choose how many teams (2–12).
- **2v2 bays / 3v3 bays**: as many full teams of 2 / 3 as possible (leftover players make a team
  one bigger), two teams per bay; with an odd number of teams the last bay has three (e.g. 2v2v2).

Partners always stay together. Top players are spread one per team first; everyone else is dealt
strongest-first to the team furthest below its fair share; then players (or whole partner groups) are
swapped between teams, and in bay formats whole teams between bays, while that makes things more even:
all teams in Teams mode, the teams inside each bay in bay formats. Pressing **Make teams** again gives a
different, equally fair mix; **Copy** puts the result on the clipboard. Saved in the browser and synced
with ☁ Sync (`site/golf.js`).

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
