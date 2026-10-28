// Cloudflare Worker: serves the site (./site) and a tiny sync API backed by D1.
//
//   PUT /api/sync          header X-Sync-Code: <code>   body: JSON   -> save
//   GET /api/sync          header X-Sync-Code: <code>                -> load
//   GET /api/view/<viewId>                                           -> load, read-only
//   GET /api/tips?me=<leader id>&vs=<leader id>                      -> AI matchup tips (Workers AI)
//
// The sync code is a long random secret made on the first device. Rows are stored under
// SHA-256(code); that hash doubles as the view-only id, so a share link can read but never write.

const MAX_BYTES = 1_000_000;
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const LEADER_ID = /^[A-Z]{1,4}\d{0,2}-\d{3}$/;

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname === "/api/tips" && request.method === "GET") return tips(url, env);

    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS sync (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)"
    ).run();

    const view = url.pathname.match(/^\/api\/view\/([0-9a-f]{64})$/);
    if (view && request.method === "GET") {
      const row = await env.DB.prepare("SELECT data, updated FROM sync WHERE id = ?").bind(view[1]).first();
      return row ? json({ data: JSON.parse(row.data), updated: row.updated }) : json({ error: "not found" }, 404);
    }

    if (url.pathname === "/api/sync") {
      const code = request.headers.get("X-Sync-Code") || "";
      if (!/^[A-Za-z0-9-]{16,64}$/.test(code)) return json({ error: "bad sync code" }, 400);
      const id = await sha256(code);
      if (request.method === "GET") {
        const row = await env.DB.prepare("SELECT data, updated FROM sync WHERE id = ?").bind(id).first();
        return row ? json({ data: JSON.parse(row.data), updated: row.updated, viewId: id }) : json({ error: "not found", viewId: id }, 404);
      }
      if (request.method === "PUT") {
        const text = await request.text();
        if (text.length > MAX_BYTES) return json({ error: "too big" }, 413);
        let body;
        try { body = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }
        const updated = Number(body.updated) || Date.now();
        await env.DB.prepare(
          "INSERT INTO sync (id, data, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated"
        ).bind(id, JSON.stringify(body.data ?? {}), updated).run();
        return json({ ok: true, updated, viewId: id });
      }
    }
    return json({ error: "not found" }, 404);
  },
};

// ---------- Matchup tips ----------

function cardLine(id, count, cards) {
  const c = cards[id];
  if (!c) return `${count ? count + "x " : ""}${id}`;
  const stats = [c.type, c.color, c.cost && `cost ${c.cost}`, c.power && `${c.power} power`, c.counter && `+${c.counter} counter`]
    .filter(Boolean).join(", ");
  return `${count ? count + "x " : ""}${c.name} (${id}) [${stats}]${c.effect ? " — " + c.effect.slice(0, 260) : ""}`;
}

function deckBlock(l, cards) {
  const out = [`${l.name} (${l.id}) — ${l.color} Leader, ${l.life || "?"} life, ${l.power || "?"} power.`,
    `Leader effect: ${l.effect || "(none)"}`];
  if (l.meta?.lists) out.push(`Meta: ${l.meta.lists} lists (${l.meta.share}% of all decks) in ${l.meta.source}${l.meta.winRate != null ? `, ${l.meta.winRate}% game win rate` : ""}.`);
  else if (l.meta) out.push(`Meta: ${l.meta.share}% of in-person tournament top finishes (Limitless).`);
  if (l.deck) {
    out.push(`Best recent list (${l.deck.placement} at ${l.deck.event}, ${l.deck.date}):`);
    for (const c of l.deck.cards.filter((c) => c.id !== l.id).slice(0, 35)) out.push("- " + cardLine(c.id, c.count, cards));
  } else {
    out.push("No tournament decklist exists yet for this leader. Cards that support it (likely in the deck):");
    for (const c of (l.support || []).slice(0, 25)) out.push("- " + cardLine(c.id, null, cards));
  }
  if (l.core?.length) {
    out.push(`Cards most ${l.name} lists play (share of lists, average copies):`);
    out.push(l.core.slice(0, 25).map((c) => `${cards[c.id]?.name || c.id} (${c.pct}%, ${c.avg})`).join("; "));
  }
  return out.join("\n");
}

async function tips(url, env) {
  const me = url.searchParams.get("me") || "";
  const vs = url.searchParams.get("vs") || "";
  if (!LEADER_ID.test(me) || !LEADER_ID.test(vs)) return json({ error: "pick two leaders" }, 400);
  const meta = await env.ASSETS.fetch(new Request(new URL("/data/meta.json", url))).then((r) => r.json());
  const leaders = Object.fromEntries(meta.leaders.map((l) => [l.id, l]));
  const a = leaders[me], b = leaders[vs];
  if (!a || !b) return json({ error: "unknown leader" }, 404);

  await env.DB.prepare("CREATE TABLE IF NOT EXISTS tips (key TEXT PRIMARY KEY, text TEXT NOT NULL, created INTEGER NOT NULL)").run();
  const key = `${me}|${vs}|${meta.updated}`;
  const hit = await env.DB.prepare("SELECT text, created FROM tips WHERE key = ?").bind(key).first();
  if (hit) return json({ text: hit.text, cached: true, created: hit.created });

  const today = new Date().toISOString().slice(0, 10);
  const rec = meta.matchups?.[`${me}|${vs}`];
  const record = rec && rec[0] + rec[1]
    ? `Real recent results for this exact matchup (online events, last ${meta.recentDays} days): ${a.name} won ${rec[0]}, lost ${rec[1]}` +
      `${rec[2] ? `, drew ${rec[2]}` : ""} (${Math.round((100 * rec[0]) / (rec[0] + rec[1]))}% win rate over ${rec[0] + rec[1]} games` +
      `${rec[0] + rec[1] < 10 ? " — small sample" : ""}).`
    : "No recorded games between these two leaders yet.";
  const messages = [
    { role: "system", content:
      "You are an expert One Piece Card Game (Bandai TCG) coach. Give practical, specific matchup advice. " +
      "Base every statement about a card ONLY on the card text given to you; never invent cards, effects or numbers. " +
      "Refer to cards by name. If the data isn't enough to be sure about something, say so briefly. " +
      "Write in clear, simple English for a player who already knows the rules." },
    { role: "user", content:
      `Today is ${today}. Newest tournament data: ${meta.newestList || "unknown"}.\n${record}\n\n` +
      `I AM PLAYING:\n${deckBlock(a, meta.cards)}\n\nMY OPPONENT IS PLAYING:\n${deckBlock(b, meta.cards)}\n\n` +
      "Write matchup tips for ME. Use exactly these markdown sections:\n" +
      "## Matchup overview\n(who is favoured and why, 2-3 sentences; use the real results if there are enough games)\n" +
      "## What their deck wants to do\n" +
      "## Their key cards to watch\n(bullets: card name — why it matters — how to play around it)\n" +
      "## Mulligan: what to keep\n" +
      "## Game plan\n(early game, mid game, closing out)\n" +
      "## Key plays to win\n(5-8 concrete bullets using my cards)\n" +
      "## Mistakes to avoid\n" +
      "Keep it under 650 words." },
  ];
  let text;
  try {
    const out = await env.AI.run(MODEL, { messages, max_tokens: 1500, temperature: 0.4 });
    text = (out.response || "").trim();
  } catch (e) {
    const limit = /limit|quota|429|neuron/i.test(String(e.message || e));
    return json({ error: limit ? "The free daily AI limit has been used up — try again tomorrow." : `The AI didn't answer (${e.message || e}).` },
      limit ? 429 : 502);
  }
  if (!text) return json({ error: "The AI returned an empty answer — try again." }, 502);
  await env.DB.prepare("INSERT OR REPLACE INTO tips (key, text, created) VALUES (?, ?, ?)").bind(key, text, Date.now()).run();
  return json({ text, cached: false, created: Date.now() });
}
