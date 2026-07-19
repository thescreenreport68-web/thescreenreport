// The Screen Report — site search API (Phase 1 of ARCHITECTURE_MIGRATION_PLAN.md).
// Routed at thescreenreport.com/api/search* (more specific than the static-site
// worker's /* route, so Cloudflare sends only search traffic here).
// Backed by D1 (SQLite FTS5) — the index is refreshed by deploy-live on every publish
// via scripts/build-search-index.mjs. Replaces Pagefind (which shipped ~1 file per
// article into the deploy bundle and a WASM index to every client).

const JSONH = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/search")) return new Response("Not found", { status: 404 });
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    if (q.length < 2) return new Response(JSON.stringify({ query: q, results: [] }), { headers: JSONH });

    // FTS5 MATCH string: bare tokens, each quoted with a prefix wildcard —
    // user punctuation/operators neutralized so input can't break the query.
    const tokens = q.replace(/['"^*():~-]/g, " ").split(/\s+/).filter(Boolean).slice(0, 8);
    if (!tokens.length) return new Response(JSON.stringify({ query: q, results: [] }), { headers: JSONH });
    const match = tokens.map((t) => `"${t}"*`).join(" ");

    try {
      const { results } = await env.DB.prepare(
        `SELECT a.slug, a.category, a.title, a.dek, a.date, a.image,
                snippet(articles_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet
         FROM articles_fts
         JOIN articles a ON a.id = articles_fts.rowid
         WHERE articles_fts MATCH ?1
         ORDER BY bm25(articles_fts, 10.0, 4.0, 1.0)
         LIMIT 20`
      )
        .bind(match)
        .all();
      return new Response(JSON.stringify({ query: q, results }), { headers: JSONH });
    } catch (e) {
      return new Response(JSON.stringify({ query: q, results: [], error: "search-unavailable" }), {
        status: 200, // degrade gracefully — the UI shows "no results" rather than an error page
        headers: { ...JSONH, "Cache-Control": "no-store" },
      });
    }
  },
};
