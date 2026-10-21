// Binder painting business tracker: supply costs in, binder sales out, profit.
// Everything is saved in this browser (localStorage); Backup / Restore move it between devices.
const Business = (() => {
  const KEY = "binder-business-v1";
  const CATEGORIES = ["Markers", "Binders", "Paint & brushes", "Shipping & fees", "Other supplies"];
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const cad = (v) => (v < 0 ? "−" : "") + "CA$" + Math.abs(v).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  let entries = load();
  let filter = "all";
  let editing = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}").entries || []; } catch { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ entries })); } catch {
      alert("Couldn't save in this browser (private window?). Use Backup so you don't lose it.");
    }
  }
  const sum = (list) => list.reduce((t, e) => t + e.amount, 0);
  const sales = () => entries.filter((e) => e.type === "sale");
  const expenses = () => entries.filter((e) => e.type === "expense");

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
            <label>What / who <input name="desc" placeholder="e.g. Zoro binder for Sam" required></label>
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
            <label>What <input name="desc" placeholder="e.g. Posca 12-pack"></label>
            <div class="row">
              <label>Quantity <input type="number" name="qty" min="1" step="1" value="1" required></label>
              <label>Cost (CA$) <input type="number" name="amount" min="0" step="0.01" placeholder="0.00" required></label>
            </div>
            <button class="primary">Add expense</button>
          </form>
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
      if (e.target.matches(".del") && confirm(`Delete "${entry.desc || entry.category}" (${cad(entry.amount)})?`)) {
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
      desc: f.desc.value.trim(),
      category: type === "sale" ? "Binder sale" : f.category.value,
      qty: Math.max(1, Math.floor(+f.qty.value) || 1),
      amount: Math.round((+f.amount.value || 0) * 100) / 100,
    };
    if (editing) entries = entries.map((x) => (x.id === editing.id ? entry : x));
    else entries.push(entry);
    stopEdit();
    f.reset();
    f.date.value = today();
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
    if (f.category) f.category.value = entry.category;
    f.classList.add("editing");
    f.querySelector("button.primary").textContent = "Save changes";
    f.scrollIntoView({ behavior: "smooth", block: "center" });
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
    $("#bizBreakdown").innerHTML = `
      <div class="biz-cols">
        <div>
          <h2>Where the money went</h2>
          ${byCat.length ? byCat.map(([c, v]) => `
            <div class="bar-row"><span>${c}</span><b>${cad(v)}</b></div>
            <div class="bar"><i style="width:${(v / spent) * 100}%"></i></div>`).join("") : `<p class="meta">No expenses yet.</p>`}
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
        <span class="what"><b>${esc(e.desc || e.category)}</b>
          <span class="meta">${e.type === "sale" ? `${e.qty} binder${e.qty > 1 ? "s" : ""}` : `${esc(e.category)}${e.qty > 1 ? ` · ×${e.qty}` : ""}`}</span></span>
        <span class="amt">${e.type === "sale" ? "+" : "−"}${cad(e.amount).replace("−", "")}</span>
        <button class="edit" title="Edit">Edit</button>
        <button class="del" title="Delete">✕</button>
      </div>`).join("") : `<p class="meta">Nothing here yet — add a sale or an expense above.</p>`;
  }

  function download(name, text, type) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    a.click();
  }
  function downloadCsv() {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["Date", "Type", "Category", "Description", "Quantity", "Amount (CAD)"],
      ...[...entries].sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => [e.date, e.type === "sale" ? "Sale" : "Expense", e.category, e.desc, e.qty, (e.type === "sale" ? 1 : -1) * e.amount])];
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
    show() {
      if (!mounted) { mount(); mounted = true; }
      document.title = "Binder Business";
      render();
    },
  };
})();
