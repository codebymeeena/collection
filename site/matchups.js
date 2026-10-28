// Matchup Tips: pick your leader and your opponent's, get AI tips built from the newest
// decklists and the real card text (data/meta.json, written twice a week by scripts/fetch_meta.py).
const Matchups = (() => {
  const PICK_KEY = "matchup-picks-v1";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const COLORS = { Red: "var(--red)", Green: "var(--green)", Blue: "var(--blue)", Purple: "var(--purple)", Black: "var(--black)", Yellow: "var(--yellow)" };
  let meta = null;
  let mounted = false;
  let picks = (() => { try { return JSON.parse(localStorage.getItem(PICK_KEY)) || {}; } catch { return {}; } })();

  const leader = (id) => meta.leaders.find((l) => l.id === id);
  const chips = (color) => color.split("/").map((c) => `<span class="chip c" style="background:${COLORS[c] || "#777"}">${esc(c)}</span>`).join("");

  // Meta decks first (by share), then everything else newest first.
  function sorted() {
    return [...meta.leaders].sort((a, b) => (b.meta?.share ?? -1) - (a.meta?.share ?? -1) || b.released.localeCompare(a.released));
  }

  // Every typed word must match the name, number or colours ("robin purple" works).
  function options(selected, filter = "") {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = sorted().filter((l) => words.every((w) => `${l.name} ${l.id} ${l.color}`.toLowerCase().includes(w)));
    if (!hits.length) return `<option value="">No leader matches “${esc(filter)}”</option>`;
    return hits.map((l) => `<option value="${l.id}" ${l.id === selected ? "selected" : ""}>${esc(l.name)} · ${esc(l.color)} · ${l.id}${l.meta ? ` · ${l.meta.share}% of meta` : ""}${l.meta?.winRate != null ? ` · ${l.meta.winRate}% wins` : ""}</option>`)
      .join("");
  }

  function card(side) {
    const l = leader(picks[side]);
    if (!l) return `<p class="meta">Pick a leader.</p>`;
    const d = l.deck;
    return `
      <img src="${esc(l.image)}" alt="${esc(l.name)}" loading="lazy">
      <div>
        <b>${esc(l.name)}</b> <span class="meta">${l.id}</span>
        <div class="chips">${chips(l.color)}${l.life ? `<span class="chip">${esc(l.life)} life</span>` : ""}${l.power ? `<span class="chip">${esc(l.power)} power</span>` : ""}</div>
        <p class="mu-effect">${esc(l.effect)}</p>
        <p class="meta">${d ? `Deck: placed ${esc(d.placement)} at ${esc(d.event)} (${esc(d.date)}) — <a href="${esc(d.url)}" target="_blank" rel="noopener">list</a>`
          : "No tournament list yet — tips use the cards that support this leader."}${l.meta?.lists
          ? ` · ${l.meta.lists} recent lists (${l.meta.share}% of decks)${l.meta.winRate != null ? `, ${l.meta.winRate}% game wins` : ""}`
          : l.meta ? ` · ${l.meta.share}% of in-person top decks` : ""}</p>
      </div>`;
  }

  function deckList(l) {
    const list = l.deck ? l.deck.cards.filter((c) => c.id !== l.id) : (l.support || []);
    const core = l.core?.length ? `<p class="meta">Most-played across recent lists: ${l.core.slice(0, 12)
      .map((c) => `${esc(meta.cards[c.id]?.name || c.id)} ${c.pct}%`).join(", ")}</p>` : "";
    return `<details><summary>${esc(l.name)}'s ${l.deck ? "decklist" : "supporting cards"} (${list.length})</summary><ul class="mu-list">${list
      .map((c) => { const t = meta.cards[c.id] || {}; return `<li title="${esc(t.effect || "")}">${c.count ? `<b>${c.count}×</b> ` : ""}${esc(t.name || c.id)} <span class="meta">${c.id}${t.cost ? ` · cost ${t.cost}` : ""}</span></li>`; })
      .join("")}</ul>${core}</details>`;
  }

  // Tiny markdown: ## headings, - bullets, **bold**, paragraphs.
  function md(text) {
    const out = [];
    let list = false;
    for (const raw of text.split("\n")) {
      const line = esc(raw.trim()).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
      const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)/);
      if (!bullet && list) { out.push("</ul>"); list = false; }
      if (!line) continue;
      if (/^#{1,4}\s/.test(line)) out.push(`<h3>${line.replace(/^#+\s*/, "")}</h3>`);
      else if (bullet) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${bullet[1]}</li>`); }
      else out.push(`<p>${line}</p>`);
    }
    if (list) out.push("</ul>");
    return out.join("");
  }

  function save() { try { localStorage.setItem(PICK_KEY, JSON.stringify(picks)); } catch {} }

  function render() {
    for (const side of ["me", "vs"]) {
      $(`#mu-${side}-sel`).innerHTML = options(picks[side], $(`#mu-${side}-q`).value);
      $(`#mu-${side}-card`).innerHTML = card(side);
    }
    $("#mu-go").disabled = !(leader(picks.me) && leader(picks.vs));
    const rec = meta.matchups?.[`${picks.me}|${picks.vs}`];
    $("#mu-record").innerHTML = rec && rec[0] + rec[1]
      ? `Recent online results, ${esc(leader(picks.me).name)} vs ${esc(leader(picks.vs).name)}: <b>${rec[0]}W – ${rec[1]}L${rec[2] ? ` – ${rec[2]}D` : ""}</b>
         (${Math.round((100 * rec[0]) / (rec[0] + rec[1]))}% wins${rec[0] + rec[1] < 10 ? ", small sample" : ""})`
      : leader(picks.me) && leader(picks.vs) ? "No recorded games between these two leaders in the last month." : "";
  }

  async function go() {
    const a = leader(picks.me), b = leader(picks.vs);
    $("#mu-out").innerHTML = `<div class="panel"><p class="mu-loading">Thinking about ${esc(a.name)} vs ${esc(b.name)}… (about 10–30 seconds)</p></div>`;
    $("#mu-go").disabled = true;
    try {
      const r = await fetch(`/api/tips?me=${a.id}&vs=${b.id}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `error ${r.status}`);
      $("#mu-out").innerHTML = `<div class="panel mu-tips">
          <h2>${esc(a.name)} <span class="meta">vs</span> ${esc(b.name)}</h2>
          ${md(body.text)}
          <p class="meta mu-note">Written by AI from the decklists and card text below${body.cached ? " (saved answer)" : ""}. Double-check card rulings before relying on them.</p>
        </div>
        <div class="panel mu-decks">${deckList(b)}${deckList(a)}</div>`;
    } catch (e) {
      $("#mu-out").innerHTML = `<div class="panel"><p class="sync-err">${esc(e.message)}</p></div>`;
    }
    $("#mu-go").disabled = false;
  }

  function mount() {
    $("#matchupsView").innerHTML = `
      <header>
        <h1>Matchup Tips</h1>
        <p class="sub">Pick your leader and your opponent's to get tips on how to win, built from the newest tournament decklists and the real card text.</p>
        <p class="meta" id="mu-asof"></p>
      </header>
      <main class="biz">
        <div class="mu-pick">
          ${["me", "vs"].map((side) => `
            <div class="panel">
              <h2>${side === "me" ? "🫵 I'm playing" : "⚔️ Against"}</h2>
              <input id="mu-${side}-q" type="search" placeholder="Search leader, colour or number…">
              <select id="mu-${side}-sel" size="1"></select>
              <div class="mu-card" id="mu-${side}-card"></div>
            </div>`).join("")}
        </div>
        <p class="mu-record" id="mu-record"></p>
        <button class="primary mu-go" id="mu-go">Get tips</button>
        <div id="mu-out"></div>
      </main>`;
    for (const side of ["me", "vs"]) {
      $(`#mu-${side}-q`).addEventListener("input", () => {
        $(`#mu-${side}-sel`).innerHTML = options(picks[side], $(`#mu-${side}-q`).value);
        const first = $(`#mu-${side}-sel`).value;
        if (first && first !== picks[side]) { picks[side] = first; save(); $(`#mu-${side}-card`).innerHTML = card(side); }
      });
      $(`#mu-${side}-sel`).addEventListener("change", (e) => { picks[side] = e.target.value; save(); render(); });
    }
    $("#mu-go").addEventListener("click", go);
  }

  return {
    async show() {
      document.title = "Matchup Tips";
      if (!mounted) { mount(); mounted = true; }
      if (!meta) {
        try {
          meta = await fetch("data/meta.json", { cache: "no-cache" }).then((r) => r.json());
        } catch {
          $("#mu-out").innerHTML = `<div class="panel"><p class="sync-err">Couldn't load the leader list.</p></div>`;
          return;
        }
        picks.me ||= sorted()[0]?.id;
        picks.vs ||= sorted()[1]?.id;
        $("#mu-asof").textContent = `${meta.leaders.length} leaders · decklists and results from Limitless online events (last ${meta.recentDays || 30} days, newest ${meta.newestList || "—"}) · updated ${new Date(meta.updated).toLocaleDateString()}`;
      }
      render();
    },
  };
})();
