const KEY = "zoro-owned-v1";
const COLORS = { Red: "var(--red)", Green: "var(--green)", Blue: "var(--blue)",
                 Purple: "var(--purple)", Black: "var(--black)", Yellow: "var(--yellow)" };
const state = { cards: [], view: "all", owned: loadOwned(), list: false };
const $ = (s) => document.querySelector(s);
const money = (v) => (v == null ? "—" : "$" + Number(v).toFixed(2));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function loadOwned() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}
function saveOwned() {
  try { localStorage.setItem(KEY, JSON.stringify([...state.owned])); } catch {}
}
const price = (c) => c.tcgMarket ?? c.sold?.ungraded ?? c.tcgMid ?? null;

async function init() {
  const data = await fetch("data/zoro.json").then((r) => r.json());
  state.cards = data.cards;
  // Seed from a committed owned.json the first time, if one exists.
  if (!localStorage.getItem(KEY)) {
    try {
      const seed = await fetch("data/owned.json").then((r) => (r.ok ? r.json() : []));
      seed.forEach((id) => state.owned.add(String(id)));
      saveOwned();
    } catch {}
  }
  $("#updated").textContent = `Prices updated ${new Date(data.updated).toLocaleString()} · ${data.cards.length} cards`;
  const colors = new Set(data.cards.flatMap((c) => c.color.split(/[;\/,]/).map((s) => s.trim()).filter(Boolean)));
  [...colors].sort().forEach((c) => $("#color").append(new Option(c, c)));
  render();
}

function filtered() {
  const q = $("#search").value.toLowerCase().trim();
  const color = $("#color").value;
  let list = state.cards.filter((c) => {
    const have = state.owned.has(String(c.productId));
    if (state.view === "have" && !have) return false;
    if (state.view === "need" && have) return false;
    if (color && !c.color.includes(color)) return false;
    if (q && !`${c.name} ${c.number} ${c.set} ${c.rarity} ${c.variant}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sort = $("#sort").value;
  if (sort === "priceDesc") list.sort((a, b) => (price(b) ?? -1) - (price(a) ?? -1));
  if (sort === "priceAsc") list.sort((a, b) => (price(a) ?? 1e9) - (price(b) ?? 1e9));
  if (sort === "cost") list.sort((a, b) => (+a.cost || 0) - (+b.cost || 0));
  return list;
}

function stats() {
  const have = state.cards.filter((c) => state.owned.has(String(c.productId)));
  const need = state.cards.filter((c) => !state.owned.has(String(c.productId)));
  const sum = (l) => l.reduce((t, c) => t + (price(c) || 0), 0);
  $("#stats").innerHTML = [
    [state.cards.length, "Zoro cards"],
    [have.length, "I have"],
    [need.length, "I need"],
    [money(sum(have)), "Value of mine"],
    [money(sum(need)), "Cost to finish"],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
}

function cardHtml(c) {
  const id = String(c.productId);
  const have = state.owned.has(id);
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
         onerror="if(this.src!=='${esc(c.imageRemote)}')this.src='${esc(c.imageRemote)}'">
    <div class="body">
      <div class="name">${esc(c.baseName)}</div>
      ${c.imageNote ? `<div class="meta note">${esc(c.imageNote)}</div>` : ""}
      <div class="meta">${esc(c.number)} · ${esc(c.setCode)} · ${esc(c.rarity)}${c.variant !== "Standard" ? " · " + esc(c.variant) : ""}</div>
      <div class="chips">${colorChips}
        ${c.cost ? `<span class="chip">Cost ${esc(c.cost)}</span>` : ""}
        ${c.type ? `<span class="chip">${esc(c.type)}</span>` : ""}
        ${c.power ? `<span class="chip">${esc(c.power)} power</span>` : ""}</div>
      <dl class="prices">
        <dt>TCGplayer</dt><dd>${money(c.tcgMarket)}${c.tcgLow != null ? ` <span class="meta">(low ${money(c.tcgLow)})</span>` : ""}</dd>
        <dt>Sold (raw)</dt><dd>${s ? `${money(s.ungraded)}${s.volume ? ` <span class="meta">(${esc(s.volume)})</span>` : ""}` : "—"}</dd>
        ${s?.psa10 ? `<dt>PSA 10</dt><dd>${money(s.psa10)}</dd>` : ""}
      </dl>
      ${sales}
      <div class="links">
        <a href="${esc(c.ebayUrl)}" target="_blank" rel="noopener">eBay sold</a>
        <a href="${esc(c.tcgplayerUrl)}" target="_blank" rel="noopener">TCGplayer</a>
        <a href="${esc(c.collectrUrl)}" target="_blank" rel="noopener">Collectr</a>
        <a href="${esc(s?.url || c.pricechartingUrl)}" target="_blank" rel="noopener">PriceCharting</a>
      </div>
      <label class="own"><input type="checkbox" data-id="${id}" ${have ? "checked" : ""}> I have this</label>
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

document.addEventListener("change", (e) => {
  if (e.target.matches(".own input")) {
    const id = e.target.dataset.id;
    e.target.checked ? state.owned.add(id) : state.owned.delete(id);
    saveOwned();
    render();
  }
});
document.addEventListener("click", (e) => {
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
["#search", "#color", "#sort"].forEach((s) => $(s).addEventListener("input", render));
$("#listMode").addEventListener("click", (e) => {
  state.list = !state.list;
  e.target.textContent = state.list ? "Grid view" : "List view";
  render();
});
$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify([...state.owned], null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "owned.json" });
  a.click();
});
$("#import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state.owned = new Set(JSON.parse(await file.text()).map(String));
    saveOwned();
    render();
  } catch { alert("That file isn't a valid owned.json"); }
});

init().catch((err) => { $("#cards").innerHTML = `<p class="empty">Could not load cards: ${esc(err.message)}</p>`; });
