// Golf Scramble: add golfers with a rank (5 = strongest), an optional "top player" flag and
// optional partners who must play together, then split them into balanced teams, or into
// 2v2 / 3v3 games with two evenly matched teams per bay. Saved in this browser and synced with ☁ Sync.
const Golf = (() => {
  const KEY = "golf-scramble-v1";
  const RANKS = { 1: "1 · 30+ handicap", 2: "2", 3: "3 · ~20 handicap", 4: "4", 5: "5 · 10 or less" };
  const MODES = { teams: "Teams", bay2: "2v2 bays", bay3: "3v3 bays" };
  const GROUP_COLORS = ["#1c5fbf", "#7a2fa8", "#c8641e", "#0f8b8d", "#b0306a", "#5b6b12"];
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let state = load();
  let editing = null;
  let readOnly = false;
  let mounted = false;

  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return normalize({}); }
  }
  function normalize(s) {
    return { players: s.players || [], teamCount: s.teamCount || 2, mode: MODES[s.mode] ? s.mode : "teams",
      result: s.result || (s.teams ? { mode: "teams", teams: s.teams, bays: null } : null) };
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

  // ---------- Partners ----------
  // Players who must play together share a `group` id.
  const groupOf = (name) => state.players.find((p) => p.name === name)?.group;
  const mates = (p) => p.group ? state.players.filter((q) => q.group === p.group && q !== p) : [];
  function groupLabels() {
    const ids = [...new Set(state.players.map((p) => p.group).filter(Boolean))];
    return Object.fromEntries(ids.map((g, i) => [g, { letter: String.fromCharCode(65 + (i % 26)), color: GROUP_COLORS[i % GROUP_COLORS.length] }]));
  }
  // A group that is down to one player isn't a group any more.
  function tidyGroups() {
    const counts = {};
    for (const p of state.players) if (p.group) counts[p.group] = (counts[p.group] || 0) + 1;
    for (const p of state.players) if (p.group && counts[p.group] < 2) delete p.group;
  }

  // ---------- Building teams ----------
  const split = (n, count) => Array.from({ length: count }, (_, i) => Math.floor(n / count) + (i < n % count ? 1 : 0));

  // Team sizes for a format: N teams, or as many full teams of 2 / 3 as possible (leftover
  // players make some teams one bigger — never a team smaller than the format).
  function sizesFor(mode, n) {
    if (mode === "teams") return split(n, Math.max(2, Math.min(state.teamCount, n)));
    const s = mode === "bay2" ? 2 : 3;
    return split(n, Math.max(2, Math.floor(n / s)));
  }
  // Which teams share a bay: biggest teams together, two per bay; with an odd number of
  // teams the last bay has three (e.g. 2v2v2).
  function bayLayout(sizes) {
    const order = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a]);
    const bays = [];
    for (let k = 0; k < order.length; k += 2) bays.push(order.slice(k, k + 2));
    if (bays.length > 1 && bays[bays.length - 1].length === 1) bays[bays.length - 2].push(bays.pop()[0]);
    return bays;
  }

  // Splits players into teams of the given sizes. Partners stay together; top players are spread
  // one per team first; everyone else goes strongest-first to the team furthest below its fair
  // share; then whole units (a single player or a set of partners) are swapped between teams while
  // that narrows the gap between the strongest and weakest team's average rank.
  function buildTeams(players, sizes, warnings, bays = null) {
    const count = sizes.length;
    const biggest = Math.max(...sizes);
    const rank = (u) => u.reduce((s, p) => s + p.rank, 0);
    const tops = (u) => u.filter((p) => p.top).length;

    const groups = new Map();
    let units = [];
    for (const p of players) {
      if (!p.group) { units.push([p]); continue; }
      if (!groups.has(p.group)) { groups.set(p.group, []); units.push(groups.get(p.group)); }
      groups.get(p.group).push(p);
    }
    units = units.flatMap((u) => {
      if (u.length <= biggest) return [u];
      warnings.push(`${u.map((p) => p.name).join(" + ")} can't all fit on one team of ${biggest}, so they were split up.`);
      return Array.from({ length: Math.ceil(u.length / biggest) }, (_, i) => u.slice(i * biggest, (i + 1) * biggest));
    });

    const teams = sizes.map(() => []); // each team is a list of units
    const size = (t) => t.reduce((s, u) => s + u.length, 0);
    const total = (t) => t.reduce((s, u) => s + rank(u), 0);
    const teamTops = (t) => t.reduce((s, u) => s + tops(u), 0);
    function place(u) {
      const open = teams.map((t, i) => ({ i, room: sizes[i] - size(t) })).filter((x) => x.room >= u.length);
      if (!open.length) { // no team has room for the whole unit (rare): seat them one by one
        warnings.push(`${u.map((p) => p.name).join(" + ")} couldn't fit on one team, so they were split up.`);
        for (const p of u) place([p]);
        return;
      }
      const best = open.sort((a, b) =>
        (tops(u) ? teamTops(teams[a.i]) - teamTops(teams[b.i]) : 0) ||
        total(teams[a.i]) / sizes[a.i] - total(teams[b.i]) / sizes[b.i] ||
        b.room - a.room || Math.random() - 0.5)[0];
      teams[best.i].push(u);
    }
    // Units with a top player first (to spread them), then partners (harder to fit), then strongest.
    shuffle(units)
      .sort((a, b) => (tops(b) > 0) - (tops(a) > 0) || b.length - a.length || rank(b) / b.length - rank(a) / a.length)
      .forEach(place);

    const avg = (t) => total(t) / Math.max(size(t), 1);
    const gap = (ids) => { const a = ids.map((i) => avg(teams[i])); return Math.max(...a) - Math.min(...a); };
    // Teams: gap between the strongest and weakest team. Bays: the biggest gap inside any bay
    // (then the total, so every bay gets as even as it can).
    const all = teams.map((_, i) => i);
    const spread = bays
      ? () => { const g = bays.map(gap); return Math.max(...g) * 1000 + g.reduce((a, b) => a + b, 0) + gap(all) / 1000; }
      : () => gap(all);
    for (let round = 0; round < 200; round++) {
      let best = spread(), swap = null;
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++)
        for (let x = 0; x < teams[i].length; x++) for (let y = 0; y < teams[j].length; y++) {
          const u = teams[i][x], v = teams[j][y];
          if (u.length !== v.length || tops(u) !== tops(v) || rank(u) === rank(v)) continue;
          teams[i][x] = v; teams[j][y] = u;
          const s = spread();
          if (s < best - 1e-9) { best = s; swap = [i, x, j, y]; }
          teams[i][x] = u; teams[j][y] = v;
        }
      // Bays: also try moving a whole team into another bay (swapping it with a same-size team).
      if (bays) for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        if (sizes[i] !== sizes[j] || bays.some((b) => b.includes(i) && b.includes(j))) continue;
        [teams[i], teams[j]] = [teams[j], teams[i]];
        const s = spread();
        if (s < best - 1e-9) { best = s; swap = [i, null, j, null]; }
        [teams[i], teams[j]] = [teams[j], teams[i]];
      }
      if (!swap) break;
      const [i, x, j, y] = swap;
      if (x === null) [teams[i], teams[j]] = [teams[j], teams[i]];
      else [teams[i][x], teams[j][y]] = [teams[j][y], teams[i][x]];
    }
    return teams.map((t) => t.flat());
  }


  // ---------- Page ----------
  function mount() {
    $("#golfView").innerHTML = `
      <header>
        <h1>⛳ Golf Scramble</h1>
        <p class="sub">Add your golfers, rank them 1–5 (5 = strongest), then split them into balanced teams or 2v2 / 3v3 bay games.</p>
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
              <label class="golf-partner">🔗 Same team as <select name="partner"></select></label>
              <label class="golf-top"><input type="checkbox" name="top"> <span>⭐ Top player</span></label>
              <div class="golf-form-actions">
                <button class="primary" id="golfAdd">Add player</button>
                <button type="button" id="golfCancel" hidden>Cancel</button>
              </div>
            </form>
            <p class="meta">🔗 Partners always end up on the same team. ⭐ Top players are spread one per team. Both optional.</p>
            <p class="sync-err" id="golfMsg"></p>
            <div id="golfList"></div>
          </section>
          <section class="panel">
            <div class="golf-teams-head">
              <h2>Teams</h2>
              <div class="golf-modes" role="tablist">${Object.entries(MODES)
                .map(([k, v]) => `<button type="button" data-mode="${k}">${v}</button>`).join("")}</div>
              <label id="golfCountWrap">How many <select id="golfCount">${Array.from({ length: 11 }, (_, i) => i + 2)
                .map((n) => `<option value="${n}">${n} teams</option>`).join("")}</select></label>
              <span class="meta" id="golfPlan"></span>
              <button class="primary" id="golfGenerate">🏌️ Make teams</button>
              <button type="button" id="golfCopy">Copy</button>
            </div>
            <p class="sync-err" id="golfWarn"></p>
            <div id="golfTeams"></div>
          </section>
        </div>
      </main>`;
    $("#golfForm").addEventListener("submit", submit);
    $("#golfCancel").addEventListener("click", stopEdit);
    $("#golfCount").addEventListener("change", (e) => { state.teamCount = +e.target.value; save(); render(); });
    $(".golf-modes").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (b && !readOnly) { state.mode = b.dataset.mode; save(); render(); }
    });
    $("#golfGenerate").addEventListener("click", generate);
    $("#golfCopy").addEventListener("click", copyTeams);
    $("#golfList").addEventListener("click", (e) => {
      const row = e.target.closest("[data-i]");
      if (!row || readOnly) return;
      const i = +row.dataset.i;
      if (e.target.closest(".golf-edit")) startEdit(i);
      if (e.target.closest(".golf-del")) {
        state.players.splice(i, 1);
        tidyGroups();
        state.result = null;
        if (editing === i) stopEdit(); else if (editing > i) editing--;
        save(); render();
      }
      if (e.target.closest(".golf-clear") && confirm("Remove every player?")) {
        state.players = []; state.result = null; stopEdit(); save(); render();
      }
    });
  }

  function msg(text) { $("#golfMsg").textContent = text || ""; }

  function partnerOptions(selfName, chosen) {
    $("#golfForm").partner.innerHTML = `<option value="">Nobody</option>` + state.players
      .filter((p) => p.name !== selfName)
      .map((p) => `<option value="${esc(p.name)}" ${p.name === chosen ? "selected" : ""}>${esc(p.name)}${mates(p).length ? ` (with ${esc(mates(p).map((m) => m.name).join(", "))})` : ""}</option>`)
      .join("");
  }

  function submit(e) {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    const rank = +f.rank.value;
    if (!name || !rank) return msg("Add a name and pick a rank.");
    const dupe = state.players.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (dupe >= 0 && dupe !== editing) return msg(`${name} is already on the list.`);
    const old = editing != null ? state.players[editing] : null;
    const player = { name, rank, top: f.top.checked };
    const partner = f.partner.value;
    if (partner) {
      // Join the partner's group, or start a new one with them.
      const p = state.players.find((q) => q.name === partner);
      p.group ||= `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      player.group = p.group;
    }
    if (old) state.players[editing] = player; else state.players.push(player);
    tidyGroups();
    state.result = null;
    stopEdit();
    msg("");
    save(); render();
    f.name.focus();
  }

  function startEdit(i) {
    editing = i;
    const f = $("#golfForm"), p = state.players[i];
    f.name.value = p.name; f.rank.value = p.rank; f.top.checked = p.top;
    partnerOptions(p.name, mates(p)[0]?.name || "");
    $("#golfAdd").textContent = "Save changes";
    $("#golfCancel").hidden = false;
    f.classList.add("editing");
    f.name.focus();
  }
  function stopEdit() {
    editing = null;
    const f = $("#golfForm");
    f.reset();
    partnerOptions("", "");
    $("#golfAdd").textContent = "Add player";
    $("#golfCancel").hidden = true;
    f.classList.remove("editing");
  }

  function generate() {
    const n = state.players.length;
    const min = state.mode === "teams" ? 2 : 4;
    if (n < min) return msg(`Add at least ${min} players first.`);
    const sizes = sizesFor(state.mode, n);
    const bays = state.mode === "teams" ? null : bayLayout(sizes);
    const warnings = [];
    const teams = buildTeams(state.players, sizes, warnings, bays);
    const tops = state.players.filter((p) => p.top).length;
    if (tops && tops < teams.length) warnings.push(`Only ${tops} top player${tops > 1 ? "s" : ""} for ${teams.length} teams — some teams won't have one.`);
    state.result = { mode: state.mode, teams, bays, warnings };
    msg("");
    save(); render();
  }

  const avgOf = (t) => t.reduce((s, p) => s + p.rank, 0) / t.length;
  const line = (t) => t.map((p) => `${p.name}${p.top ? " ⭐" : ""} (${p.rank})`).join(", ");
  function teamsText() {
    const r = state.result;
    if (!r) return "";
    if (!r.bays) return r.teams.map((t, i) => `Team ${i + 1}: ${line(t)}`).join("\n");
    return r.bays.map((ids, k) => `Bay ${k + 1}: ${ids.map((i) => line(r.teams[i])).join("  vs  ")}`).join("\n");
  }
  async function copyTeams() {
    if (!state.result) return msg("Make teams first.");
    try { await navigator.clipboard.writeText(teamsText()); msg(""); alert("Teams copied — paste them in a message."); }
    catch { prompt("Copy the teams:", teamsText()); }
  }

  function planText() {
    const n = state.players.length;
    if (state.mode === "teams" || n < 4) return "";
    const sizes = sizesFor(state.mode, n);
    const bays = bayLayout(sizes);
    const shapes = {};
    for (const ids of bays) { const s = ids.map((i) => sizes[i]).join("v"); shapes[s] = (shapes[s] || 0) + 1; }
    return `${n} players → ${bays.length} bay${bays.length > 1 ? "s" : ""}: ${Object.entries(shapes).map(([s, c]) => `${c > 1 ? c + "× " : ""}${s}`).join(" + ")}`;
  }

  function teamCard(t, title, labels) {
    return `<div class="golf-team">
        <div class="golf-team-head"><b>${title}</b>
          <span class="meta">${t.length} players · avg ${avgOf(t).toFixed(1)}${t.some((p) => p.top) ? " · ⭐" : ""}</span></div>
        <ol>${[...t].sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)).map((p) => `<li>
          <span class="golf-rank r${p.rank}">${p.rank}</span> ${esc(p.name)}${p.top ? " ⭐" : ""}${groupChip(p, labels)}</li>`).join("")}</ol>
      </div>`;
  }
  function groupChip(p, labels) {
    const g = p.group && labels[p.group];
    return g ? ` <span class="golf-group" style="background:${g.color}" title="Partners: ${esc([p, ...mates(p)].map((m) => m.name).join(", "))}">🔗${g.letter}</span>` : "";
  }

  function render() {
    if (!mounted) return;
    const P = state.players;
    const labels = groupLabels();
    const tops = P.filter((p) => p.top).length;
    const avg = P.length ? P.reduce((s, p) => s + p.rank, 0) / P.length : 0;
    const r = state.result;
    $("#golfStats").innerHTML = [
      [P.length, "Players"], [tops, "⭐ Top players"], [Object.keys(labels).length, "🔗 Partner groups"],
      [P.length ? avg.toFixed(1) : "—", "Average rank"], [r ? (r.bays ? `${r.bays.length} bays` : r.teams.length) : "—", r?.bays ? "Games" : "Teams made"],
    ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
    if (editing == null) partnerOptions("", $("#golfForm").partner.value);
    $("#golfCount").value = state.teamCount;
    document.querySelectorAll(".golf-modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
    $("#golfCountWrap").hidden = state.mode !== "teams";
    $("#golfPlan").textContent = planText();

    $("#golfList").innerHTML = P.length ? `
      <div class="golf-list">${P.map((p, i) => `
        <div class="golf-row" data-i="${i}">
          <span class="golf-rank r${p.rank}" title="Rank ${p.rank}">${p.rank}</span>
          <span class="golf-name">${esc(p.name)}${p.top ? ' <span title="Top player">⭐</span>' : ""}${groupChip(p, labels)}</span>
          <button type="button" class="golf-edit">Edit</button>
          <button type="button" class="golf-del" aria-label="Remove ${esc(p.name)}">✕</button>
        </div>`).join("")}
      </div>
      <div class="golf-row" data-i="-1"><button type="button" class="golf-clear">Remove everyone</button></div>`
      : `<p class="meta">No players yet — add everyone, then make teams.</p>`;

    $("#golfWarn").innerHTML = (r?.warnings || []).map(esc).join("<br>");
    if (!r) {
      const need = state.mode === "teams" ? 2 : 4;
      $("#golfTeams").innerHTML = `<p class="meta">${P.length < need ? `Add at least ${need} players.` : "Pick a format, then press Make teams."}</p>`;
      return;
    }
    const avgs = r.teams.map(avgOf);
    if (!r.bays) {
      const spread = Math.max(...avgs) - Math.min(...avgs);
      $("#golfTeams").innerHTML = `
        <p class="golf-balance ${spread <= 0.5 ? "pos" : "warn"}">${spread <= 0.5 ? "✓ Balanced" : "≈ Close"} — average ranks within ${spread.toFixed(1)} of each other.
          Press Make teams again for a different mix.</p>
        <div class="golf-teams">${r.teams.map((t, i) => teamCard(t, `Team ${i + 1}`, labels)).join("")}</div>`;
      return;
    }
    const gaps = r.bays.map((ids) => { const a = ids.map((i) => avgs[i]); return Math.max(...a) - Math.min(...a); });
    const worst = Math.max(...gaps);
    $("#golfTeams").innerHTML = `
      <p class="golf-balance ${worst <= 0.5 ? "pos" : "warn"}">${worst <= 0.5 ? "✓ Even games" : "≈ Close games"} — in every bay the teams' average ranks are within ${worst.toFixed(1)}.
        Press Make teams again for a different mix.</p>
      <div class="golf-bays">${r.bays.map((ids, k) => `
        <div class="golf-bay">
          <div class="golf-bay-head"><b>Bay ${k + 1}</b><span class="meta">${ids.map((i) => r.teams[i].length).join("v")}${gaps[k] <= 0.5 ? " · even" : ` · gap ${gaps[k].toFixed(1)}`}</span></div>
          <div class="golf-bay-teams">${ids.map((i, j) => teamCard(r.teams[i], `Team ${"ABC"[j]}`, labels)).join(`<span class="golf-vs">vs</span>`)}</div>
        </div>`).join("")}
      </div>`;
  }

  return {
    getData: () => state,
    setData(data, ro) {
      readOnly = ro;
      state = normalize(data || {});
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
