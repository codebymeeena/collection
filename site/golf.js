// Golf Scramble: add golfers with a rank (5 = strongest) and an optional "top player" flag,
// then split them into balanced teams. Saved in this browser and synced with ☁ Sync.
const Golf = (() => {
  const KEY = "golf-scramble-v1";
  const RANKS = { 1: "1 · 30+ handicap", 2: "2", 3: "3 · ~20 handicap", 4: "4", 5: "5 · 10 or less" };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let state = load();
  let editing = null;
  let readOnly = false;
  let mounted = false;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "{}");
      return { players: s.players || [], teamCount: s.teamCount || 2, teams: s.teams || null };
    } catch { return { players: [], teamCount: 2, teams: null }; }
  }
  // notify=false for data that came from the cloud, so it isn't treated as a new edit.
  function save(notify = true) {
    if (readOnly) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    if (notify) window.dispatchEvent(new Event("data-changed"));
  }

  function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // Strongest first; players with the same rank come out in a random order,
  // so pressing Generate again gives a different (equally balanced) split.
  const byRank = (list) => shuffle(list).sort((a, b) => b.rank - a.rank);

  function buildTeams(players, count) {
    const sizes = Array.from({ length: count }, (_, i) => Math.floor(players.length / count) + (i < players.length % count ? 1 : 0));
    const teams = sizes.map(() => []);
    const total = (t) => t.reduce((s, p) => s + p.rank, 0);
    // Team that is furthest below its fair share (total compared with its size); ties go to the emptier team.
    const pick = () => teams
      .map((t, i) => ({ i, room: t.length < sizes[i], score: total(t) / sizes[i], size: t.length }))
      .filter((t) => t.room)
      .sort((a, b) => a.score - b.score || a.size - b.size || Math.random() - 0.5)[0]?.i;
    const tops = byRank(players.filter((p) => p.top));
    const rest = byRank(players.filter((p) => !p.top));
    // One top player per team first (as far as they go), then everyone else strongest-first.
    for (const p of tops.slice(0, count)) {
      const i = teams.findIndex((t, k) => !t.some((x) => x.top) && t.length < sizes[k]);
      teams[i].push(p);
    }
    for (const p of byRank([...tops.slice(count), ...rest])) teams[pick()].push(p);

    // Then swap players between teams (top for top, others for others) while it narrows
    // the gap between the strongest and weakest team's average rank.
    const spread = () => { const a = teams.map((t) => total(t) / t.length); return Math.max(...a) - Math.min(...a); };
    for (let round = 0; round < 200; round++) {
      let best = spread(), swap = null;
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++)
        for (let x = 0; x < teams[i].length; x++) for (let y = 0; y < teams[j].length; y++) {
          const p = teams[i][x], q = teams[j][y];
          if (p.top !== q.top || p.rank === q.rank) continue;
          teams[i][x] = q; teams[j][y] = p;
          const s = spread();
          if (s < best - 1e-9) { best = s; swap = [i, x, j, y]; }
          teams[i][x] = p; teams[j][y] = q;
        }
      if (!swap) break;
      const [i, x, j, y] = swap;
      [teams[i][x], teams[j][y]] = [teams[j][y], teams[i][x]];
    }
    return teams;
  }

  function mount() {
    $("#golfView").innerHTML = `
      <header>
        <h1>⛳ Golf Scramble</h1>
        <p class="sub">Add your golfers, rank them 1–5 (5 = strongest), then split them into balanced teams.</p>
        <div class="stats" id="golfStats"></div>
      </header>
      <main class="biz">
        <div class="golf-cols">
          <section class="panel">
            <h2>Players</h2>
            <form id="golfForm" class="golf-form">
              <label>Name <input name="name" placeholder="e.g. Sam" autocomplete="off" required></label>
              <label>Rank <select name="rank" required>
                <option value="">Pick…</option>
                ${[5, 4, 3, 2, 1].map((r) => `<option value="${r}">${RANKS[r]}</option>`).join("")}
              </select></label>
              <label class="golf-top"><input type="checkbox" name="top"> <span>⭐ Top player</span></label>
              <div class="golf-form-actions">
                <button class="primary" id="golfAdd">Add player</button>
                <button type="button" id="golfCancel" hidden>Cancel</button>
              </div>
            </form>
            <p class="meta">⭐ Top players are spread one per team first. Optional.</p>
            <p class="sync-err" id="golfMsg"></p>
            <div id="golfList"></div>
          </section>
          <section class="panel">
            <div class="golf-teams-head">
              <h2>Teams</h2>
              <label>How many <select id="golfCount">${Array.from({ length: 11 }, (_, i) => i + 2)
                .map((n) => `<option value="${n}">${n} teams</option>`).join("")}</select></label>
              <button class="primary" id="golfGenerate">🏌️ Make teams</button>
              <button type="button" id="golfCopy">Copy</button>
            </div>
            <div id="golfTeams"></div>
          </section>
        </div>
      </main>`;
    $("#golfForm").addEventListener("submit", submit);
    $("#golfCancel").addEventListener("click", stopEdit);
    $("#golfCount").addEventListener("change", (e) => { state.teamCount = +e.target.value; save(); render(); });
    $("#golfGenerate").addEventListener("click", generate);
    $("#golfCopy").addEventListener("click", copyTeams);
    $("#golfList").addEventListener("click", (e) => {
      const row = e.target.closest("[data-i]");
      if (!row || readOnly) return;
      const i = +row.dataset.i;
      if (e.target.closest(".golf-edit")) startEdit(i);
      if (e.target.closest(".golf-del")) {
        state.players.splice(i, 1);
        state.teams = null;
        if (editing === i) stopEdit();
        save(); render();
      }
      if (e.target.closest(".golf-clear") && confirm("Remove every player?")) {
        state.players = []; state.teams = null; stopEdit(); save(); render();
      }
    });
  }

  function msg(text) { $("#golfMsg").textContent = text || ""; }

  function submit(e) {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    const rank = +f.rank.value;
    if (!name || !rank) return msg("Add a name and pick a rank.");
    const dupe = state.players.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (dupe >= 0 && dupe !== editing) return msg(`${name} is already on the list.`);
    const player = { name, rank, top: f.top.checked };
    if (editing != null) state.players[editing] = player; else state.players.push(player);
    state.teams = null;
    stopEdit();
    msg("");
    save(); render();
    f.name.focus();
  }

  function startEdit(i) {
    editing = i;
    const f = $("#golfForm"), p = state.players[i];
    f.name.value = p.name; f.rank.value = p.rank; f.top.checked = p.top;
    $("#golfAdd").textContent = "Save changes";
    $("#golfCancel").hidden = false;
    f.classList.add("editing");
    f.name.focus();
  }
  function stopEdit() {
    editing = null;
    const f = $("#golfForm");
    f.reset();
    $("#golfAdd").textContent = "Add player";
    $("#golfCancel").hidden = true;
    f.classList.remove("editing");
  }

  function generate() {
    const n = state.players.length;
    if (n < 2) return msg("Add at least 2 players first.");
    const count = Math.min(state.teamCount, n);
    const tops = state.players.filter((p) => p.top).length;
    state.teams = buildTeams(state.players, count);
    msg(tops && tops < count ? `Only ${tops} top player${tops > 1 ? "s" : ""} for ${count} teams — some teams won't have one.` : "");
    save(); render();
  }

  function teamsText() {
    return (state.teams || []).map((t, i) =>
      `Team ${i + 1}: ${t.map((p) => `${p.name}${p.top ? " ⭐" : ""} (${p.rank})`).join(", ")}`).join("\n");
  }
  async function copyTeams() {
    if (!state.teams) return msg("Make teams first.");
    try { await navigator.clipboard.writeText(teamsText()); msg(""); alert("Teams copied — paste them in a message."); }
    catch { prompt("Copy the teams:", teamsText()); }
  }

  function render() {
    if (!mounted) return;
    const P = state.players;
    const tops = P.filter((p) => p.top).length;
    const avg = P.length ? P.reduce((s, p) => s + p.rank, 0) / P.length : 0;
    $("#golfStats").innerHTML = [
      [P.length, "Players"], [tops, "⭐ Top players"], [P.length ? avg.toFixed(1) : "—", "Average rank"],
      [state.teams ? state.teams.length : "—", "Teams made"],
    ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
    $("#golfCount").value = state.teamCount;

    $("#golfList").innerHTML = P.length ? `
      <div class="golf-list">${P.map((p, i) => `
        <div class="golf-row" data-i="${i}">
          <span class="golf-rank r${p.rank}" title="Rank ${p.rank}">${p.rank}</span>
          <span class="golf-name">${esc(p.name)}${p.top ? ' <span title="Top player">⭐</span>' : ""}</span>
          <button type="button" class="golf-edit">Edit</button>
          <button type="button" class="golf-del" aria-label="Remove ${esc(p.name)}">✕</button>
        </div>`).join("")}
      </div>
      <div class="golf-row" data-i="-1"><button type="button" class="golf-clear">Remove everyone</button></div>`
      : `<p class="meta">No players yet — add everyone, then make teams.</p>`;

    const T = state.teams;
    if (!T) { $("#golfTeams").innerHTML = `<p class="meta">${P.length < 2 ? "Add at least 2 players." : "Pick how many teams, then press Make teams."}</p>`; return; }
    const totals = T.map((t) => t.reduce((s, p) => s + p.rank, 0) / t.length);
    const spread = Math.max(...totals) - Math.min(...totals);
    $("#golfTeams").innerHTML = `
      <p class="golf-balance ${spread <= 0.5 ? "pos" : "warn"}">${spread <= 0.5 ? "✓ Balanced" : "≈ Close"} — average ranks within ${spread.toFixed(1)} of each other.
        Press Make teams again for a different mix.</p>
      <div class="golf-teams">${T.map((t, i) => `
        <div class="golf-team">
          <div class="golf-team-head"><b>Team ${i + 1}</b>
            <span class="meta">${t.length} players · avg ${totals[i].toFixed(1)}${t.some((p) => p.top) ? " · ⭐" : ""}</span></div>
          <ol>${byName(t).map((p) => `<li><span class="golf-rank r${p.rank}">${p.rank}</span> ${esc(p.name)}${p.top ? " ⭐" : ""}</li>`).join("")}</ol>
        </div>`).join("")}
      </div>`;
  }
  const byName = (t) => [...t].sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));

  return {
    getData: () => state,
    setData(data, ro) {
      readOnly = ro;
      state = { players: data?.players || [], teamCount: data?.teamCount || 2, teams: data?.teams || null };
      if (!ro) save(false);
      render();
    },
    show() {
      document.title = "Golf Scramble";
      if (!mounted) { mount(); mounted = true; }
      render();
    },
  };
})();
