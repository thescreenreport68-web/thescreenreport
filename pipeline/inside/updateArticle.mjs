// ONE STORY = ONE URL (owner directive 2026-07-20) — the shared "fold new reactions into the article
// that already owns this story" path.
//
// Two callers use it and MUST behave identically, or the same story starts drifting between two
// implementations: agentrun.mjs (a candidate resolved to a live article → update instead of a new
// slug) and updater.mjs (the scheduled freshness pass). The merge rules live here, once.
//
// What an update is allowed to touch is deliberately narrow, because of the standing no-mass-rewrite
// freeze (churn signals while Google is still building trust): it APPENDS new reaction cards and
// stamps `updated`/`dateModified`. It never rewrites the body, the title, or any SEO field, so an
// update adds substance to a URL without re-litigating anything Google has already indexed.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONTENT_DIR } from "./config.inside.mjs";
import { norm } from "./reactionFinder.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

// The dedup fingerprint for "have we already published this quote?". 90 chars of the normalized quote
// is enough to identify a post while surviving the trailing-punctuation and whitespace differences the
// harvest's own cleaners introduce. Shared so the ledger's harvestQuoteKeys stay comparable.
export const quoteKey = (q) => norm(q || "").slice(0, 90);

// A real new wave, not one straggler. Two is the floor the updater has always used: a single late
// reply is noise, and re-touching a live URL for noise is exactly the churn the freeze forbids.
export const MIN_FRESH_REACTIONS = 2;

/**
 * PURE. Pick harvested reactions that are genuinely new to this article.
 * Dedups against BOTH the full original harvest fingerprint (harvestQuoteKeys — includes posts that
 * were harvested but never made it onto the page) and the cards currently rendered, so a quote we
 * already saw can never come back as "new".
 */
export function freshReactions({ existingReactions = [], harvestQuoteKeys = [], candidates = [], max = 5 } = {}) {
  const have = new Set([...harvestQuoteKeys, ...existingReactions.map((r) => quoteKey(r?.quote))]);
  const out = [];
  for (const r of candidates) {
    if (!r?.quote) continue;
    const k = quoteKey(r.quote);
    if (have.has(k)) continue;
    have.add(k); // also dedups WITHIN this batch — two sources can carry the same post
    out.push({
      speaker: r.speaker || "A viewer",
      ...(r.connection ? { connection: r.connection } : {}),
      ...(r.platform ? { platform: r.platform } : {}),
      ...(r.date ? { date: r.date } : {}),
      quote: r.quote,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Append `fresh` reaction cards to a live article and stamp it updated. Returns
 * { ok, slug, added, path } — ok:false when there is nothing to do or the file is missing, so the
 * caller can skip cheaply without having written anything.
 */
export function applyReactionUpdate({ slug, fresh = [], now = Date.now(), dir = CONTENT_DIR, dryRun = false } = {}) {
  if (!slug) return { ok: false, reason: "no slug" };
  if (fresh.length < MIN_FRESH_REACTIONS) return { ok: false, reason: `only ${fresh.length} new reaction(s)` };
  const fp = path.join(dir, `${slug}.md`);
  if (!fs.existsSync(fp)) return { ok: false, reason: "article file missing" };
  let parsed;
  try { parsed = matter.read(fp); } catch (e) { return { ok: false, reason: `unparsable: ${String(e?.message || e).slice(0, 60)}` }; }
  const fm = { ...parsed.data };
  if (fm.retracted) return { ok: false, reason: "retracted" };

  // FINAL dedup against what the page actually renders. The caller filters against the ledger's
  // harvestQuoteKeys, but the ledger can drift from the file (a repair edited a card, an older record
  // predates the key list). The file is the truth about what a reader already sees, and it is open
  // right here — so no caller can produce a double-posted quote by filtering incorrectly.
  // The set ACCUMULATES, so a quote repeated inside `fresh` is also caught — a caller that skipped
  // its own batch-dedup must not be able to post the same reaction twice on one page.
  const seen = new Set((fm.reactions || []).map((r) => quoteKey(r?.quote)));
  const add = fresh.filter((r) => {
    const k = quoteKey(r?.quote);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (add.length < MIN_FRESH_REACTIONS) return { ok: false, reason: `only ${add.length} new after page dedup` };

  fm.reactions = [...(fm.reactions || []), ...add];
  fm.updatedCount = (fm.updatedCount || 0) + 1;
  fm.updated = new Date(now).toISOString();
  fm.dateModified = fm.updated;
  if (!dryRun) fs.writeFileSync(fp, matter.stringify("\n" + String(parsed.content).trim() + "\n", fm));
  return { ok: true, slug, added: add.length, added_quotes: add.map((r) => quoteKey(r.quote)), path: fp };
}
