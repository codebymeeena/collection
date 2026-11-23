// Binder painting business tracker: supply costs in, binder sales out, profit.
// Everything is saved in this browser (localStorage); Backup / Restore move it between devices.
const Business = (() => {
  const KEY = "binder-business-v1";
  const BINDER_TYPES = ["4-pocket", "9-pocket", "12-pocket"];
  const BRANDS = ["Vault X", "Ultra PRO", "Ultimate Guard", "Dragon Shield", "Gamegenic", "BCW", "Monster Protectors", "Card Guard", "Amazon / no brand", "Other"];
  const COLOURS = ["Black", "White", "Grey", "Blue", "Navy", "Red", "Pink", "Purple", "Green", "Yellow", "Orange", "Brown", "Clear", "Multicolour"];
  const pocketsField = `<label>Pockets <select name="binderType">${BINDER_TYPES.map((t) => `<option ${t === "9-pocket" ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
  const toploaderField = `<label>Top loader <select name="toploader"><option value="">No</option><option value="yes">Yes</option></select></label>`;
  const brandField = `<label>Brand <select name="brand"><option value="">—</option>${BRANDS.map((b) => `<option>${b}</option>`).join("")}</select></label>`;
  const binderFields = `<div class="row">${pocketsField}${toploaderField}</div><div class="row">${brandField}`;
  const colourField = `<label>Colour <input name="color" list="bizColours" placeholder="e.g. Black" autocomplete="off"></label>`;
  // "Black 9-pocket" — what a binder is, for lists and labels.
  // Older entries stored "Top loader" (or 16/20-pocket) as the binder type.
  const isToploader = (e) => !!e.toploader || e.binderType === "Top loader";
  const pockets = (e) => (e.binderType === "Top loader" ? "" : e.binderType || "");
  // A sale's binder details come from the binder purchase it's linked to (older sales kept their own).
  const binderOf = (e) => (e.type === "sale" && linkedBuy(e)) || e;
  const binderLabel = (e) => { const b = binderOf(e); return [b.brand, b.color, pockets(b), isToploader(b) && "top loader"].filter(Boolean).join(" "); };
  const binderType = (e) => { const b = binderOf(e); return [pockets(b) || "Pockets not set", isToploader(b) && "top loader"].filter(Boolean).join(" · "); };
  const title = (e) => e.desc || (e.category === "Binders" && binderLabel(e) ? `${binderLabel(e)} binder${e.qty > 1 ? "s" : ""}` : e.category);
  const CATEGORIES = ["Binders", "Markers", "Paint & brushes", "Shipping & fees", "Other supplies"];
  const CHANNELS = ["Instagram", "Facebook / Marketplace", "TikTok", "Snapchat", "Text / iMessage", "Discord", "Kijiji", "In person", "Other"];
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const cad = (v) => (v < 0 ? "−" : "") + "CA$" + Math.abs(v).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  let entries = load();
  let filter = "all";
  let editing = null;
  let readOnly = false;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}").entries || []; } catch { return []; }
  }
  // notify=false for data that came from the cloud, so it isn't treated as a new edit.
  function save(notify = true) {
    if (readOnly) return;
    try { localStorage.setItem(KEY, JSON.stringify({ entries })); } catch {
      alert("Couldn't save in this browser (private window?). Use Backup so you don't lose it.");
    }
    if (notify) window.dispatchEvent(new Event("data-changed"));
  }
  const sum = (list) => list.reduce((t, e) => t + e.amount, 0);
  const sales = () => entries.filter((e) => e.type === "sale");
  const expenses = () => entries.filter((e) => e.type === "expense");

  // A sale can point at the purchase its binder came from (sale.binderFrom = expense id).
  // A purchase of 3 binders for CA$60 costs CA$20 per binder sold from it.
  const unitCost = (x) => x.amount / Math.max(x.qty, 1);
  const linkedBuy = (sale) => sale.binderFrom && entries.find((x) => x.id === sale.binderFrom && x.type === "expense");
  // A customer who brings their own binder costs nothing for the binder.
  const OWN = "own";
  const saleCost = (sale) => { if (sale.ownBinder) return 0; const b = linkedBuy(sale); return b ? unitCost(b) * sale.qty : null; };
  const salesFrom = (buy) => sales().filter((x) => x.binderFrom === buy.id);
  const usedFrom = (buy, except) => salesFrom(buy).filter((x) => x.id !== except).reduce((t, x) => t + x.qty, 0);
  const who = (e) => [e.customer, e.via].filter(Boolean).join(" · ");
  function mount() {
    $("#businessView").innerHTML = `
      <header>
        <h1>Binder Business</h1>
        <p class="sub">Log what you spend on supplies and what you make from binders — profit is worked out for you.</p>
        <div class="stats" id="bizStats"></div>
      </header>
      <main class="biz">
        <div class="biz-forms">
          <form class="panel" id="saleForm">
            <h2>💰 I sold a binder</h2>
            <label>Date <input type="date" name="date" required></label>
            <label>What did you make? <input name="desc" placeholder="e.g. Zoro binder" required></label>
            <div class="row">
              <label>Customer's name <input name="customer" placeholder="e.g. Sam" autocomplete="off"></label>
              <label>Messaged on <select name="via"><option value="">—</option>${CHANNELS.map((c) => `<option>${c}</option>`).join("")}</select></label>
            </div>
            <label>Their username / contact <input name="handle" placeholder="e.g. @sam.cards" autocomplete="off"></label>
            <label>🔗 Binder used <select name="binderFrom"></select></label>
            <p class="meta biz-binder-info" id="saleBinderInfo"></p>
            <div class="row">
              <label>Binders <input type="number" name="qty" min="1" step="1" value="1" required></label>
              <label>Paid (CA$) <input type="number" name="amount" min="0" step="0.01" placeholder="0.00" required></label>
            </div>
            <button class="primary">Add sale</button>
          </form>
          <form class="panel" id="expenseForm">
            <h2>🛒 I bought supplies</h2>
            <label>Date <input type="date" name="date" required></label>
            <label>Type <select name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></label>
            <label class="not-binder">What <input name="desc" placeholder="e.g. Posca 12-pack"></label>
            <div class="binder-only">${binderFields}${colourField}</div></div>
            <div class="row">
              <label>Quantity <input type="number" name="qty" min="1" step="1" value="1" required></label>
              <label>Cost (CA$) <input type="number" name="amount" min="0" step="0.01" placeholder="0.00" required></label>
            </div>
            <button class="primary">Add expense</button>
          </form>
          <datalist id="bizColours">${COLOURS.map((c) => `<option value="${c}">`).join("")}</datalist>
        </div>
        <section class="panel" id="bizBreakdown"></section>
        <section class="panel">
          <div class="biz-head">
            <h2>History</h2>
            <div class="tabs" id="bizFilter">
              <button data-f="all" class="active">All</button>
              <button data-f="sale">Sales</button>
              <button data-f="expense">Expenses</button>
            </div>
            <div class="biz-actions">
              <button type="button" id="bizCsv">Download CSV</button>
              <button type="button" id="bizBackup">Backup</button>
              <label class="import">Restore<input id="bizRestore" type="file" accept="application/json" hidden></label>
            </div>
          </div>
          <div id="bizList"></div>
        </section>
        <p class="meta">Saved in this browser only. Tap <b>Backup</b> now and then (or before switching phone/computer) and <b>Restore</b> it on the other device.</p>
      </main>`;
    for (const f of ["#saleForm", "#expenseForm"]) $(f).date.value = today();
    $("#saleForm").addEventListener("submit", (e) => submit(e, "sale"));
    $("#expenseForm").addEventListener("submit", (e) => submit(e, "expense"));
    // Pockets / colour only matter for binder purchases.
    $("#expenseForm").category.addEventListener("change", showBinderFields);
    showBinderFields();
    // Linking a sale to a purchase fills in that binder's pockets and colour.
    $("#saleForm").binderFrom.addEventListener("change", (e) => {
      const buy = entries.find((x) => x.id === e.target.value);
      showSaleBinder();
    });
    $("#bizFilter").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b) return;
      filter = b.dataset.f;
      $("#bizFilter").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      renderList();
    });
    $("#bizList").addEventListener("click", (e) => {
      const row = e.target.closest("[data-id]");
      if (!row) return;
      const entry = entries.find((x) => x.id === row.dataset.id);
      const linked = entry.type === "expense" ? salesFrom(entry).length : 0;
      if (e.target.matches(".del") && confirm(`Delete "${title(entry)}" (${cad(entry.amount)})?` +
          (linked ? `\n${linked} sale${linked > 1 ? "s are" : " is"} linked to it and will be unlinked.` : ""))) {
        for (const x of salesFrom(entry)) delete x.binderFrom;
        entries = entries.filter((x) => x !== entry);
        save();
        render();
      }
      if (e.target.matches(".edit")) startEdit(entry);
    });
    $("#bizCsv").addEventListener("click", downloadCsv);
    $("#bizBackup").addEventListener("click", () =>
      download(`binder-business-${today()}.json`, JSON.stringify({ entries }, null, 1), "application/json"));
    $("#bizRestore").addEventListener("change", restore);
  }

  function submit(e, type) {
    e.preventDefault();
    const f = e.target;
    const entry = {
      id: editing?.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type,
      date: f.date.value,
      // Binder purchases are described by their pockets / top loader / brand / colour instead.
      desc: type === "expense" && f.category.value === "Binders" ? "" : f.desc.value.trim(),
      category: type === "sale" ? "Binder sale" : f.category.value,
      // Older sales keep the binder details they were saved with.
      ...(type === "sale" && editing && {
        binderType: editing.binderType, toploader: editing.toploader, brand: editing.brand, color: editing.color,
      }),
      ...(type === "expense" && f.category.value === "Binders" && {
        binderType: f.binderType.value,
        toploader: f.toploader.value === "yes" || undefined,
        brand: f.brand.value || undefined,
        color: f.color.value.trim() || undefined,
      }),
      ...(type === "sale" && {
        customer: f.customer.value.trim(),
        via: f.via.value,
        handle: f.handle.value.trim(),
        binderFrom: f.binderFrom.value && f.binderFrom.value !== OWN ? f.binderFrom.value : undefined,
        ownBinder: f.binderFrom.value === OWN || undefined,
      }),
      qty: Math.max(1, Math.floor(+f.qty.value) || 1),
      amount: Math.round((+f.amount.value || 0) * 100) / 100,
    };
    if (editing) entries = entries.map((x) => (x.id === editing.id ? entry : x));
    else entries.push(entry);
    stopEdit();
    f.reset();
    f.date.value = today();
    showBinderFields();
    showSaleBinder();
    save();
    render();
  }

  function startEdit(entry) {
    stopEdit();
    editing = entry;
    const f = entry.type === "sale" ? $("#saleForm") : $("#expenseForm");
    f.date.value = entry.date;
    f.desc.value = entry.desc;
    f.qty.value = entry.qty;
    f.amount.value = entry.amount;
    if (f.category) { f.category.value = entry.category; showBinderFields(); fillBinder(f, entry); }
    if (entry.type === "sale") {
      f.customer.value = entry.customer || "";
      f.via.value = entry.via || "";
      f.handle.value = entry.handle || "";
      binderOptions(entry);
      showSaleBinder();
    }
    f.classList.add("editing");
    f.querySelector("button.primary").textContent = "Save changes";
    f.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  // Binder purchases to link a sale to: ones with binders left first, then used-up ones.
  function binderOptions(sale = null) {
    const buys = expenses().filter((x) => x.category === "Binders" || x.id === sale?.binderFrom)
      .map((x) => ({ x, left: x.qty - usedFrom(x, sale?.id) }))
      .sort((a, b) => (b.left > 0) - (a.left > 0) || b.x.date.localeCompare(a.x.date));
    $("#saleForm").binderFrom.innerHTML = `<option value="">Not linked</option>` +
      `<option value="${OWN}" ${sale?.ownBinder ? "selected" : ""}>🙋 Customer brought their own binder</option>` + buys.map(({ x, left }) =>
      `<option value="${esc(x.id)}" ${x.id === sale?.binderFrom ? "selected" : ""}>${esc(x.date)} · ${esc([binderLabel(x), x.desc].filter(Boolean).join(" — ") || x.category)} · ${cad(unitCost(x))} each · ${left > 0 ? `${left} of ${x.qty} left` : "all used"}</option>`).join("") +
      (buys.length ? "" : `<option value="" disabled>Log a binder purchase under “I bought supplies” first</option>`);
  }
  // Puts a binder's pockets / top loader / brand / colour into a form (keeping odd old values selectable).
  function fillBinder(f, e) {
    const keep = (sel, value) => {
      if (value && ![...sel.options].some((o) => o.value === value)) sel.add(new Option(value, value));
      sel.value = value || sel.options[0].value;
    };
    keep(f.binderType, pockets(e) || "9-pocket");
    f.toploader.value = isToploader(e) ? "yes" : "";
    keep(f.brand, e.brand || "");
    f.color.value = e.color || "";
  }
  function showBinderFields() {
    const binders = $("#expenseForm").category.value === "Binders";
    $("#expenseForm .binder-only").hidden = !binders;
    $("#expenseForm .not-binder").hidden = binders;
  }
  // Under "Binder used": what that binder is.
  function showSaleBinder() {
    const v = $("#saleForm").binderFrom.value;
    const buy = v && v !== OWN && entries.find((x) => x.id === v);
    $("#saleBinderInfo").textContent = buy ? `${binderLabel(buy) || "Binder"} · ${cad(unitCost(buy))}` :
      v === OWN ? "They supplied the binder — no binder cost." : "Pick the binder you bought for this sale to track its cost and details.";
  }
  function stopEdit() {
    editing = null;
    for (const [sel, label] of [["#saleForm", "Add sale"], ["#expenseForm", "Add expense"]]) {
      $(sel).classList.remove("editing");
      $(sel).querySelector("button.primary").textContent = label;
    }
  }

  function render() {
    const made = sum(sales());
    const spent = sum(expenses());
    const binders = sales().reduce((t, e) => t + e.qty, 0);
    const month = today().slice(0, 7);
    const inMonth = (e) => e.date.startsWith(month);
    const monthProfit = sum(sales().filter(inMonth)) - sum(expenses().filter(inMonth));
    $("#bizStats").innerHTML = [
      [cad(made - spent), "Profit (all time)", made - spent < 0 ? "neg" : "pos"],
      [cad(made), "Made from binders"],
      [cad(spent), "Spent on supplies"],
      [binders, "Binders sold"],
      [binders ? cad(made / binders) : "—", "Average per binder"],
      [cad(monthProfit), "Profit this month", monthProfit < 0 ? "neg" : "pos"],
    ].map(([v, l, cls]) => `<div class="stat ${cls || ""}"><b>${v}</b><span>${l}</span></div>`).join("");
    if (!editing || editing.type !== "sale") { binderOptions(); showSaleBinder(); }
    renderBreakdown(spent);
    renderList();
  }

  function renderBreakdown(spent) {
    const byCat = CATEGORIES.map((c) => [c, sum(expenses().filter((e) => e.category === c))]).filter(([, v]) => v > 0);
    const months = {};
    for (const e of entries) {
      const m = (months[e.date.slice(0, 7)] ||= { made: 0, spent: 0 });
      e.type === "sale" ? (m.made += e.amount) : (m.spent += e.amount);
    }
    const monthRows = Object.entries(months).sort(([a], [b]) => b.localeCompare(a));
    const types = {};
    for (const e of sales()) {
      const t = (types[binderType(e)] ||= { count: 0, made: 0 });
      t.count += e.qty;
      t.made += e.amount;
    }
    const typeRows = Object.entries(types).sort(([, a], [, b]) => b.made - a.made);
    const colours = {};
    for (const e of sales()) {
      const c = (colours[binderOf(e).color || "Not set"] ||= { count: 0, made: 0 });
      c.count += e.qty;
      c.made += e.amount;
    }
    const colourRows = Object.entries(colours).sort(([, a], [, b]) => b.count - a.count || b.made - a.made);
    const channels = {};
    for (const e of sales()) {
      const c = (channels[e.via || "Not set"] ||= { count: 0, made: 0 });
      c.count += 1;
      c.made += e.amount;
    }
    const channelRows = Object.entries(channels).sort(([, a], [, b]) => b.made - a.made);
    $("#bizBreakdown").innerHTML = `
      <div class="biz-cols">
        <div>
          <h2>Where the money went</h2>
          ${byCat.length ? byCat.map(([c, v]) => `
            <div class="bar-row"><span>${c}</span><b>${cad(v)}</b></div>
            <div class="bar"><i style="width:${(v / spent) * 100}%"></i></div>`).join("") : `<p class="meta">No expenses yet.</p>`}
        </div>
        <div>
          <h2>Sales by pockets</h2>
          ${typeRows.length ? `<table class="biz-table"><tr><th>Pockets</th><th>Sold</th><th>Made</th><th>Avg each</th></tr>
            ${typeRows.map(([t, v]) => `<tr><td>${esc(t)}</td><td>${v.count}</td><td>${cad(v.made)}</td><td>${cad(v.made / v.count)}</td></tr>`).join("")}
            </table>` : `<p class="meta">No sales yet.</p>`}
        </div>
        <div>
          <h2>Sales by colour</h2>
          ${colourRows.length ? `<table class="biz-table"><tr><th>Colour</th><th>Sold</th><th>Made</th></tr>
            ${colourRows.map(([c, v]) => `<tr><td>${esc(c)}</td><td>${v.count}</td><td>${cad(v.made)}</td></tr>`).join("")}
            </table>` : `<p class="meta">No sales yet.</p>`}
        </div>
        <div>
          <h2>Where customers came from</h2>
          ${channelRows.length ? `<table class="biz-table"><tr><th>Messaged on</th><th>Sales</th><th>Made</th></tr>
            ${channelRows.map(([c, v]) => `<tr><td>${esc(c)}</td><td>${v.count}</td><td>${cad(v.made)}</td></tr>`).join("")}
            </table>` : `<p class="meta">No sales yet.</p>`}
        </div>
        <div>
          <h2>By month</h2>
          ${monthRows.length ? `<table class="biz-table"><tr><th>Month</th><th>Made</th><th>Spent</th><th>Profit</th></tr>
            ${monthRows.map(([m, v]) => `<tr><td>${new Date(m + "-15").toLocaleDateString("en-CA", { month: "short", year: "numeric" })}</td>
              <td>${cad(v.made)}</td><td>${cad(v.spent)}</td><td class="${v.made - v.spent < 0 ? "neg" : "pos"}">${cad(v.made - v.spent)}</td></tr>`).join("")}
            </table>` : `<p class="meta">Nothing logged yet.</p>`}
        </div>
      </div>`;
  }

  function renderList() {
    const list = entries.filter((e) => filter === "all" || e.type === filter)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    $("#bizList").innerHTML = list.length ? list.map((e) => `
      <div class="biz-entry ${e.type}" data-id="${esc(e.id)}">
        <span class="date">${esc(e.date)}</span>
        <span class="what"><b>${esc(title(e))}</b>
          <span class="meta">${e.type === "sale" ? saleDetails(e) : buyDetails(e)}</span></span>
        <span class="amt">${e.type === "sale" ? "+" : "−"}${cad(e.amount).replace("−", "")}</span>
        <button class="edit" title="Edit">Edit</button>
        <button class="del" title="Delete">✕</button>
      </div>`).join("") : `<p class="meta">Nothing here yet — add a sale or an expense above.</p>`;
  }

  function saleDetails(e) {
    const bits = [`${e.qty} × ${binderLabel(e) ? esc(binderLabel(e)) + " " : ""}binder${e.qty > 1 ? "s" : ""}`];
    // Customer details stay private on view-only share links.
    if (!readOnly && (e.customer || e.via || e.handle))
      bits.push(`👤 ${[e.customer, e.via, e.handle].filter(Boolean).map(esc).join(" · ")}`);
    const cost = saleCost(e);
    if (e.ownBinder) bits.push(`<span class="biz-link">🙋 their own binder → profit <b class="pos">${cad(e.amount)}</b></span>`);
    else if (cost != null) bits.push(`<span class="biz-link">🔗 binder ${cad(cost)} → profit <b class="${e.amount - cost < 0 ? "neg" : "pos"}">${cad(e.amount - cost)}</b></span>`);
    return bits.join(" · ");
  }
  function buyDetails(e) {
    const bits = [`${esc(e.category)}${e.qty > 1 ? ` · ×${e.qty}` : ""}`];
    const used = salesFrom(e);
    if (used.length) bits.push(`<span class="biz-link">🔗 used for ${used.reduce((t, x) => t + x.qty, 0)} of ${e.qty}${readOnly ? "" : `: ${used.map((x) => esc(x.customer || x.desc)).join(", ")}`}</span>`);
    return bits.join(" · ");
  }

  function download(name, text, type) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    a.click();
  }
  function downloadCsv() {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["Date", "Type", "Category", "Pockets", "Top loader", "Brand", "Colour", "Description", "Quantity", "Amount (CAD)",
      "Customer", "Messaged on", "Username / contact", "Binder used", "Binder cost (CAD)", "Profit on sale (CAD)"],
      ...[...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
        const sale = e.type === "sale", cost = sale ? saleCost(e) : null, buy = sale && linkedBuy(e);
        const binder = sale || e.category === "Binders";
        const b = binderOf(e);
        return [e.date, sale ? "Sale" : "Expense", e.category, binder ? pockets(b) : "", binder ? (isToploader(b) ? "Yes" : "No") : "", binder ? b.brand || "" : "",
          binder ? b.color || "" : "", title(e), e.qty, (sale ? 1 : -1) * e.amount,
          sale ? e.customer || "" : "", sale ? e.via || "" : "", sale ? e.handle || "" : "",
          e.ownBinder ? "Customer's own binder" : buy ? `${buy.date} ${title(buy)}` : "", cost != null ? cost.toFixed(2) : "", cost != null ? (e.amount - cost).toFixed(2) : ""];
      })];
    download(`binder-business-${today()}.csv`, rows.map((r) => r.map(q).join(",")).join("\n"), "text/csv");
  }
  async function restore(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.entries)) throw new Error();
      if (entries.length && !confirm(`Replace your ${entries.length} entries with the ${data.entries.length} in this backup?`)) return;
      entries = data.entries;
      save();
      render();
    } catch { alert("That file isn't a binder business backup."); }
  }

  let mounted = false;
  return {
    getEntries: () => entries,
    setEntries(list, ro) {
      readOnly = ro;
      entries = Array.isArray(list) ? list : [];
      if (!ro) save(false);
      if (mounted) render();
    },
    show() {
      if (!mounted) { mount(); mounted = true; }
      document.title = "Binder Business";
      render();
    },
  };
})();
