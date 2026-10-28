const KEY = "card-qty-v1"; // {card id: copies owned} for every tab (ids are unique)
const OLD_KEY = "zoro-owned-v1"; // earlier tick-box list, read once as 1 copy each
const CHAR_KEY = "card-tab-v1";
const COLORS = { Red: "var(--red)", Green: "var(--green)", Blue: "var(--blue)",
                 Purple: "var(--purple)", Black: "var(--black)", Yellow: "var(--yellow)" };
const state = { cards: [], view: "all", owned: new Map(), list: false, chars: [], char: null, cache: {} };
const $ = (s) => document.querySelector(s);
// Sources quote US dollars; show Canadian dollars using the rate saved by the weekly update.
const fx = { rate: null, date: "" };
const money = (v) => (v == null ? "—" : fx.rate
  ? "CA$" + (Number(v) * fx.rate).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : "US$" + Number(v).toFixed(2));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function loadOwned() {
  try {
    const saved = localStorage.getItem(KEY);
    return toQty(JSON.parse(saved ?? localStorage.getItem(OLD_KEY) ?? "{}"));
  } catch { return new Map(); }
}
// Accepts {id: qty} or the older [id, …] list (1 copy each).
function toQty(data) {
  const entries = Array.isArray(data) ? data.map((id) => [id, 1]) : Object.entries(data || {});
  return new Map(entries.map(([id, n]) => [String(id), Math.max(0, Math.floor(+n) || 0)]).filter(([, n]) => n > 0));
}
// notify=false for data that came from the cloud or a seed file, so it isn't treated as a new edit.
function saveOwned(notify = true) {
  if (state.viewOnly) return;
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(state.owned))); } catch {}
  if (notify) window.dispatchEvent(new Event("data-changed"));
}
// Used by sync.js.
window.App = {
  getOwned: () => Object.fromEntries(state.owned),
  setOwned(data, readOnly) {
    state.viewOnly = readOnly;
    state.owned = toQty(data);
    saveOwned(false);
    if (state.char && !$("#cardsView").hidden) render();
  },
};
const ownId = (c) => c.id ?? String(c.productId);
const qty = (c) => state.owned.get(ownId(c)) || 0;
// Main price, in order: TCGplayer market (this card's finish), then last eBay sale and
// eBay sold average (both via PriceCharting), then TCGplayer mid.
function mainPrice(c) {
  // Hand-entered CAD prices are turned back into USD so money() shows them exactly as typed.
  if (c.priceCad != null) return { v: fx.rate ? c.priceCad / fx.rate : c.priceCad, src: "price you entered" };
  if (c.price != null) return { v: c.price, src: "price you entered" };
  const last = [...(c.sold?.recentSales || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
  const ebayBacked = last || c.sold?.ungraded != null;
  // TCGplayer's market price only moves when a copy sells there, so on very rare cards it
  // can be years old. If even the cheapest listing is over 3x it and no eBay sale backs it up,
  // the cheapest listing is the better guide.
  if (c.tcgMarket != null && c.tcgLow > 3 * c.tcgMarket && !ebayBacked) {
    return { v: c.tcgLow, src: `TCGplayer cheapest listing (market price ${money(c.tcgMarket)} looks out of date)` };
  }
  if (c.tcgMarket != null) return { v: c.tcgMarket, src: "TCGplayer market" };
  if (last) return { v: last.price, src: `last eBay sale, ${last.date}` };
  if (c.sold?.ungraded != null) return { v: c.sold.ungraded, src: "eBay sold average" };
  if (c.tcgMid != null) return { v: c.tcgMid, src: "TCGplayer mid" };
  return { v: null, src: "no price found" };
}
const price = (c) => mainPrice(c).v;

// Keep the filter bar just under the sticky Zoro / Luffy tabs.
const charbar = document.querySelector(".charbar");
new ResizeObserver(() => document.documentElement.style.setProperty("--charbar-h", charbar.offsetHeight + "px")).observe(charbar);

async function init() {
  state.manual = await fetch("data/manual.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  state.owned = loadOwned();
  try {
    const r = await fetch("data/fx.json").then((res) => (res.ok ? res.json() : null));
    if (r?.usdToCad) Object.assign(fx, { rate: r.usdToCad, date: r.date });
  } catch {}
  state.chars = await fetch("data/characters.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null) || [{ key: "zoro", label: "Zoro" }, { key: "luffy", label: "Luffy" }];
  $("#chars").innerHTML = state.chars
    .map((c) => `<button data-char="${esc(c.key)}" role="tab">${esc(c.label)}<span class="count"></span></button>`).join("") +
    `<button data-char="business" role="tab">Binder Business</button>` +
    `<button data-char="matchups" role="tab">Matchup Tips</button>` +
    `<button type="button" id="syncBtn" class="sync-btn" title="Sync & share" aria-label="Sync and share">☁</button>`;
  $("#syncBtn").addEventListener("click", () => Sync.open());
  // Card counts on the tabs (loads each tab's list in the background).
  state.chars.forEach(async (c) => {
    try {
      const data = state.cache[c.key] ||= await fetch(`data/${c.key}.json`).then((r) => r.json());
      const span = document.querySelector(`#chars button[data-char="${c.key}"] .count`);
      if (span) span.textContent = `${data.cards.length} cards`;
    } catch {}
  });
  $("#chars").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-char]");
    if (b) location.hash = b.dataset.char;
  });
  window.addEventListener("hashchange", () => route(location.hash.slice(1)));
  // Seed from a committed owned.json the first time, if one exists.
  if (!state.owned.size) {
    try {
      const seed = await fetch("data/owned.json").then((r) => (r.ok ? r.json() : []));
      state.owned = toQty(seed);
      saveOwned(false);
    } catch {}
  }
  let start = location.hash.slice(1);
  if (!PAGES[start] && !state.chars.some((c) => c.key === start)) {
    try { start = localStorage.getItem(CHAR_KEY); } catch {}
  }
  await route(start);
  await Sync.init();
}

// Extra tabs that aren't card lists; anything else is a card tab.
const PAGES = { business: () => Business.show(), matchups: () => Matchups.show() };
async function route(key) {
  const page = PAGES[key];
  $("#businessView").hidden = key !== "business";
  $("#matchupsView").hidden = key !== "matchups";
  $("#cardsView").hidden = !!page;
  if (!page) return showChar(key);
  try { localStorage.setItem(CHAR_KEY, key); } catch {}
  document.querySelectorAll("#chars button").forEach((b) => b.classList.toggle("active", b.dataset.char === key));
  page();
}

// Cards added by hand in data/manual.json: override a fetched card with the same id, or add a new one.
function withManual(cards, manual = []) {
  const out = cards.map((c) => ({ ...c }));
  for (const m of manual) {
    const card = out.find((c) => ownId(c) === m.id);
    if (card) {
      Object.assign(card, m, { imageRemote: card.image || card.imageRemote });
    } else {
      const q = encodeURIComponent(m.name);
      out.push({
        productId: m.id, number: "", rarity: "", cost: "", color: "", type: "", power: "", finish: "",
        foil: false, don: false, variant: "Standard", setCode: "", set: "", imageRemote: "",
        tcgMarket: null, tcgLow: null, tcgMid: null, sold: null,
        tcgplayerUrl: `https://www.tcgplayer.com/search/one-piece-card-game/product?q=${q}`,
        ebayUrl: `https://www.ebay.com/sch/i.html?LH_Sold=1&LH_Complete=1&_nkw=${q}`,
        collectrUrl: `https://app.getcollectr.com/?query=${q}`,
        pricechartingUrl: `https://www.pricecharting.com/search-products?type=prices&q=${q}`,
        baseName: m.name, ...m,
      });
    }
  }
  return out;
}

async function showChar(key) {
  const char = state.chars.find((c) => c.key === key) || state.chars[0];
  state.char = char;
  try { localStorage.setItem(CHAR_KEY, char.key); } catch {}
  document.querySelectorAll("#chars button").forEach((b) => b.classList.toggle("active", b.dataset.char === char.key));
  document.title = `${char.label} Card Collection`;
  $("#cardsView h1").textContent = `${char.label} Card Collection`;
  $("#cardsView .sub").textContent = `Every English One Piece TCG ${char.label} card — use + and − to count the ones you have.`;
  $("#cards").innerHTML = `<p class="empty">Loading ${esc(char.label)} cards…</p>`;
  const data = state.cache[char.key] ||= await fetch(`data/${char.key}.json`).then((r) => r.json());
  if (state.char !== char) return; // another tab was picked while loading
  state.cards = withManual(data.cards, state.manual?.[char.key]);
  $("#updated").textContent = `Prices updated ${new Date(data.updated).toLocaleString()} · ${data.cards.length} cards · ` +
    (fx.rate ? `Prices in CAD (1 USD = ${fx.rate.toFixed(4)} CAD, ${fx.date})` : "Prices in USD (exchange rate unavailable)");
  const colors = new Set(data.cards.flatMap((c) => c.color.split(/[;\/,]/).map((s) => s.trim()).filter(Boolean)));
  $("#color").replaceChildren(new Option("All colours", ""));
  [...colors].sort().forEach((c) => $("#color").append(new Option(c, c)));
  render();
}

function filtered() {
  const q = $("#search").value.toLowerCase().trim();
  const color = $("#color").value;
  const finish = $("#finish").value;
  const kind = $("#kind").value;
  let list = state.cards.filter((c) => {
    const have = qty(c) > 0;
    if (state.view === "have" && !have) return false;
    if (state.view === "need" && have) return false;
    if (color && !c.color.includes(color)) return false;
    if (finish && c.finish !== finish) return false;
    if (kind === "don" && !c.don) return false;
    if (kind === "cards" && c.don) return false;
    if (q && !`${c.name} ${c.number} ${c.set} ${c.rarity} ${c.variant} ${c.finish ?? ""} ${c.don ? "don" : ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sort = $("#sort").value;
  if (sort === "priceDesc") list.sort((a, b) => (price(b) ?? -1) - (price(a) ?? -1));
  if (sort === "priceAsc") list.sort((a, b) => (price(a) ?? 1e9) - (price(b) ?? 1e9));
  if (sort === "cost") list.sort((a, b) => (+a.cost || 0) - (+b.cost || 0));
  return list;
}

function stats() {
  const have = state.cards.filter((c) => qty(c) > 0);
  const need = state.cards.filter((c) => qty(c) === 0);
  const copies = have.reduce((t, c) => t + qty(c), 0);
  const sum = (l, perCard) => l.reduce((t, c) => t + (price(c) || 0) * perCard(c), 0);
  $("#stats").innerHTML = [
    [state.cards.length, `${state.char.label} cards`],
    [have.length, "I have"],
    [need.length, "I need"],
    [copies, "Copies I own"],
    [money(sum(have, qty)), "Value of mine"],
    [money(sum(need, () => 1)), "Cost to finish"],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
}

function cardHtml(c) {
  const id = ownId(c);
  const n = qty(c);
  const have = n > 0;
  const colorChips = c.color.split(/[;\/,]/).map((s) => s.trim()).filter(Boolean)
    .map((col) => `<span class="chip c" style="background:${COLORS[col] || "#777"}">${esc(col)}</span>`).join("");
  const s = c.sold;
  const sales = s?.recentSales?.length
    ? `<details><summary>Recent sold (${s.recentSales.length})</summary><ul class="sales">${s.recentSales
        .map((x) => `<li><span>${esc(x.date)}</span> <b>${money(x.price)}</b> <span class="meta">${esc(x.title)}</span></li>`)
        .join("")}</ul></details>`
    : "";
  return `<article class="card ${have ? "have" : ""}">
    <img loading="lazy" src="${esc(c.image)}" alt="${esc(c.name)}" data-full="${esc(c.image)}"
         onerror="this.onerror=null;${c.imageRemote ? `this.src='${esc(c.imageRemote)}'` : "this.classList.add('noimg')"}">
    <div class="body">
      <div class="name">${esc(c.baseName)}</div>
      ${c.imageNote ? `<div class="meta note">${esc(c.imageNote)}</div>` : ""}
      <div class="meta">${[c.number, c.setCode, c.rarity, c.variant !== "Standard" && c.variant].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="chips">${c.finish ? `<span class="chip ${c.foil ? "foil" : ""}">${c.foil ? "✦ Foil" : "Non-foil"}</span>` : ""}${colorChips}
        ${c.cost ? `<span class="chip">Cost ${esc(c.cost)}</span>` : ""}
        ${c.type ? `<span class="chip">${esc(c.type)}</span>` : ""}
        ${c.power ? `<span class="chip">${esc(c.power)} power</span>` : ""}</div>
      <div class="main-price"><b>${money(price(c))}</b> <span class="meta">${esc(mainPrice(c).src)}${c.soldAnyFinish && c.tcgMarket == null && c.sold ? " · any finish" : ""}</span></div>
      <dl class="prices">
        <dt>TCGplayer</dt><dd>${money(c.tcgMarket)}${c.tcgLow != null ? ` <span class="meta">(low ${money(c.tcgLow)})</span>` : ""}</dd>
        <dt>Sold (raw${c.soldAnyFinish ? ", any finish" : ""})</dt><dd>${s ? `${money(s.ungraded)}${s.volume ? ` <span class="meta">(${esc(s.volume)})</span>` : ""}` : "—"}</dd>
        ${s?.psa10 ? `<dt>PSA 10</dt><dd>${money(s.psa10)}</dd>` : ""}
      </dl>
      ${sales}
      <div class="links">
        <a href="${esc(c.ebayUrl)}" target="_blank" rel="noopener">eBay sold</a>
        <a href="${esc(c.tcgplayerUrl)}" target="_blank" rel="noopener">TCGplayer</a>
        <a href="${esc(c.collectrUrl)}" target="_blank" rel="noopener">Collectr</a>
        <a href="${esc(s?.url || c.pricechartingUrl)}" target="_blank" rel="noopener">PriceCharting</a>
      </div>
      <div class="own" data-id="${esc(id)}">
        <span>I have</span>
        <button type="button" data-step="-1" aria-label="One less" ${have ? "" : "disabled"}>−</button>
        <input type="number" min="0" step="1" inputmode="numeric" value="${n}" aria-label="Copies owned">
        <button type="button" data-step="1" aria-label="One more">+</button>
      </div>
    </div>
  </article>`;
}

function render() {
  stats();
  const list = filtered();
  const main = $("#cards");
  main.className = state.list ? "list" : "grid";
  main.innerHTML = list.length ? list.map(cardHtml).join("") : `<p class="empty">No cards here yet.</p>`;
}

function setQty(id, n) {
  n = Math.max(0, Math.floor(+n) || 0);
  n ? state.owned.set(id, n) : state.owned.delete(id);
  saveOwned();
  render();
}
document.addEventListener("change", (e) => {
  if (e.target.matches(".own input")) setQty(e.target.closest(".own").dataset.id, e.target.value);
});
document.addEventListener("click", (e) => {
  const step = e.target.closest(".own button[data-step]");
  if (step) {
    const id = step.closest(".own").dataset.id;
    setQty(id, (state.owned.get(id) || 0) + Number(step.dataset.step));
  }
  if (e.target.matches(".card img")) {
    const d = $("#zoom");
    d.querySelector("img").src = e.target.src;
    d.showModal();
  }
});
$("#zoom").addEventListener("click", () => $("#zoom").close());
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  state.view = b.dataset.view;
  render();
}));
["#search", "#color", "#kind", "#finish", "#sort"].forEach((s) => $(s).addEventListener("input", render));
$("#listMode").addEventListener("click", (e) => {
  state.list = !state.list;
  e.target.textContent = state.list ? "Grid view" : "List view";
  render();
});
$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(Object.fromEntries(state.owned), null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "owned.json" });
  a.click();
});
$("#import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state.owned = toQty(JSON.parse(await file.text()));
    saveOwned();
    render();
  } catch { alert("That file isn't a valid owned.json"); }
});

init().catch((err) => { $("#cards").innerHTML = `<p class="empty">Could not load cards: ${esc(err.message)}</p>`; });
