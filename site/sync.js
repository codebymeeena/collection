// Cloud sync for card counts and binder business entries (Cloudflare D1 via /api/sync).
// A random sync code links devices; a view-only link (#view=<id>) lets others look without editing.
const Sync = (() => {
  const CODE_KEY = "sync-code-v1";
  const STAMP_KEY = "sync-local-updated-v1";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  let code = store.get(CODE_KEY);
  let viewId = null;
  let viewing = false;
  let lastSynced = null;
  let status = "";
  let timer = null;

  const localStamp = () => Number(store.get(STAMP_KEY)) || 0;
  const payload = () => ({ owned: App.getOwned(), business: Business.getEntries() });
  const shareLink = () => viewId && `${location.origin}${location.pathname}#view=${viewId}`;

  function newCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
    const r = crypto.getRandomValues(new Uint8Array(20));
    return [...r].map((b) => abc[b % abc.length]).join("").match(/.{5}/g).join("-");
  }
  const cleanCode = (c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "").match(/.{1,5}/g)?.join("-") || "";

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "content-type": "application/json", ...(code && { "X-Sync-Code": code }), ...opts.headers } });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  }

  function apply(data, readOnly) {
    App.setOwned(data.owned || {}, readOnly);
    Business.setEntries(data.business || [], readOnly);
  }

  async function push() {
    if (!code || viewing) return;
    try {
      const r = await api("/api/sync", { method: "PUT", body: JSON.stringify({ data: payload(), updated: localStamp() || Date.now() }) });
      if (!r.ok) throw new Error(r.body.error || r.status);
      viewId = r.body.viewId;
      lastSynced = new Date();
      status = "";
    } catch (e) {
      status = `Couldn't save to the cloud (${e.message}). It'll try again on your next change.`;
    }
    renderDialog();
  }

  async function pull({ force = false } = {}) {
    if (!code || viewing) return;
    try {
      const r = await api("/api/sync");
      if (r.body.viewId) viewId = r.body.viewId;
      if (r.status === 404) return push(); // nothing saved yet under this code
      if (!r.ok) throw new Error(r.body.error || r.status);
      if (force || r.body.updated > localStamp()) {
        apply(r.body.data, false);
        store.set(STAMP_KEY, String(r.body.updated));
      } else if (r.body.updated < localStamp()) {
        await push(); // this device has newer changes
      }
      lastSynced = new Date();
      status = "";
    } catch (e) {
      status = `Couldn't reach the cloud (${e.message}).`;
    }
    renderDialog();
  }

  function changed() {
    if (viewing) return;
    store.set(STAMP_KEY, String(Date.now()));
    clearTimeout(timer);
    timer = setTimeout(push, 1500);
  }

  async function startView(id) {
    viewing = true;
    document.body.classList.add("viewonly");
    const banner = document.createElement("div");
    banner.className = "view-banner";
    banner.innerHTML = `<span>👀 You're looking at a shared collection (view only).</span>
      <button type="button" id="viewExit">Back to my own</button>`;
    document.body.prepend(banner);
    $("#viewExit").addEventListener("click", () => { location.hash = ""; location.reload(); });
    try {
      const r = await fetch(`/api/view/${id}`).then((x) => x.json());
      if (!r.data) throw new Error();
      apply(r.data, true);
    } catch {
      banner.querySelector("span").textContent = "That share link didn't work — it may have been turned off.";
    }
  }

  function renderDialog() {
    const d = $("#syncDialog");
    if (!d) return;
    const btn = $("#syncBtn");
    if (btn) btn.classList.toggle("on", !!code);
    d.querySelector(".sync-body").innerHTML = viewing ? `<p>You're viewing someone else's collection. Press “Back to my own” at the top to return.</p>` : code ? `
      <p class="sync-on">✓ Sync is on${lastSynced ? ` — last synced ${lastSynced.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</p>
      ${status ? `<p class="sync-err">${esc(status)}</p>` : ""}
      <h3>Your sync code</h3>
      <p class="sync-code">${esc(code)}</p>
      <p class="meta">On your phone (or another computer): open this site → ☁ → “Connect”, and type this code. Keep it private — anyone with it can change your data.</p>
      <div class="sync-row"><button type="button" data-act="copy-code">Copy code</button><button type="button" data-act="now">Sync now</button></div>
      <h3>Share (view only)</h3>
      <p class="meta">Send this link to anyone — they can see your collection and business numbers but can't change them.</p>
      <div class="sync-row"><button type="button" data-act="copy-link" ${viewId ? "" : "disabled"}>Copy share link</button>${navigator.share && viewId ? `<button type="button" data-act="share">Share…</button>` : ""}</div>
      <hr><button type="button" data-act="off" class="sync-off">Turn off sync on this device</button>` : `
      <p>Sync is <b>off</b>. Your card counts and business entries are saved only on this device.</p>
      <button type="button" class="primary" data-act="on">Turn on sync</button>
      ${status ? `<p class="sync-err">${esc(status)}</p>` : ""}
      <h3>Already using sync on another device?</h3>
      <p class="meta">Type the sync code from that device. This device's data will be replaced with the synced data.</p>
      <div class="sync-row"><input id="syncCodeIn" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" autocapitalize="characters"><button type="button" data-act="connect">Connect</button></div>`;
  }

  async function act(what) {
    if (what === "on") {
      code = newCode();
      store.set(CODE_KEY, code);
      store.set(STAMP_KEY, String(Date.now()));
      await push();
    } else if (what === "connect") {
      const c = cleanCode($("#syncCodeIn").value);
      if (c.replace(/-/g, "").length < 16) return alert("That code looks too short — it should be 20 letters/numbers.");
      const prev = code;
      code = c;
      const r = await api("/api/sync");
      if (r.status === 404) { code = prev; status = "No synced data found for that code. Check it and try again."; return renderDialog(); }
      if (!r.ok) { code = prev; status = `Couldn't reach the cloud (${r.body.error || r.status}).`; return renderDialog(); }
      store.set(CODE_KEY, code);
      viewId = r.body.viewId;
      apply(r.body.data, false);
      store.set(STAMP_KEY, String(r.body.updated));
      lastSynced = new Date();
      status = "";
    } else if (what === "now") {
      await pull();
    } else if (what === "copy-code" || what === "copy-link") {
      const text = what === "copy-code" ? code : shareLink();
      try { await navigator.clipboard.writeText(text); alert("Copied!"); } catch { prompt("Copy this:", text); }
    } else if (what === "share") {
      navigator.share({ title: "My One Piece collection", url: shareLink() }).catch(() => {});
    } else if (what === "off") {
      if (!confirm("Stop syncing on this device? Your data stays here and in the cloud; you can reconnect later with your code.")) return;
      code = null; viewId = null;
      store.set(CODE_KEY, null);
    }
    renderDialog();
  }

  function mount() {
    const d = document.createElement("dialog");
    d.id = "syncDialog";
    d.innerHTML = `<div class="sync-head"><h2>☁ Sync &amp; share</h2><button type="button" data-act="close" aria-label="Close">✕</button></div><div class="sync-body"></div>`;
    document.body.append(d);
    d.addEventListener("click", (e) => {
      if (e.target === d) return d.close();
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      if (b.dataset.act === "close") return d.close();
      act(b.dataset.act);
    });
  }

  return {
    async init() {
      mount();
      window.addEventListener("data-changed", changed);
      const m = location.hash.match(/^#view=([0-9a-f]{64})$/);
      if (m) return startView(m[1]);
      await pull();
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });
    },
    open() { renderDialog(); $("#syncDialog").showModal(); },
    get viewing() { return viewing; },
  };
})();
