# Zoro Card Collection

A website listing every **English** One Piece TCG card named Zoro (Roronoa Zoro, Zoro-Juurou, DON!! cards…) with:

- card picture, name, card number, set, rarity, variant (parallel / alt art / manga…)
- cost, colour, type and power
- TCGplayer market + low price, recent **sold** price for raw English copies (PriceCharting, from eBay sales), PSA 10 price and a list of recent sales
- links to eBay sold listings, TCGplayer, Collectr and PriceCharting for each card
- an **"I have this"** tick box, with tabs for *All*, *I have* and *I need*, and totals for what your
  collection is worth and what it would cost to finish

## How it works

- `scripts/fetch_zoro.py` pulls the card list, pictures and TCGplayer prices from
  [tcgcsv.com](https://tcgcsv.com) (a daily copy of TCGplayer's catalogue) and recent sold prices
  from PriceCharting (which tracks eBay sold listings; eBay itself blocks automated requests, so each
  card links to its eBay sold search instead). Pictures are saved into `site/images/`, data into `site/data/zoro.json`.
- The GitHub Action `.github/workflows/update-and-deploy.yml` runs that script on every push and every
  Monday, commits the new data, and deploys `site/` to Cloudflare Pages.

## Your "have" list

Ticks are saved in your browser. Use **Export my list** to download `owned.json`. To make the list
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
4. *Actions* tab → **Update Zoro cards and deploy** → *Run workflow* (branch `main`).
   Your site will be at **https://zoro-cards.pages.dev** (or a similar name if that one is taken —
   the job log prints the URL).

**B. Connect the repo in Cloudflare**
Workers & Pages → *Create* → *Pages* → *Connect to Git* → pick this repo → production branch `main`,
build command *(leave empty)*, build output directory `site` → *Save and Deploy*.
