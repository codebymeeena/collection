// Cloudflare Worker: serves the site (./site) and a tiny sync API backed by D1.
//
//   PUT /api/sync          header X-Sync-Code: <code>   body: JSON   -> save
//   GET /api/sync          header X-Sync-Code: <code>                -> load
//   GET /api/view/<viewId>                                           -> load, read-only
//
// The sync code is a long random secret made on the first device. Rows are stored under
// SHA-256(code); that hash doubles as the view-only id, so a share link can read but never write.

const MAX_BYTES = 1_000_000;

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
