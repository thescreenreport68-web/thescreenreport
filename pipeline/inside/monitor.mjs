// MONITOR (inside) — an UPDATER first, a safety net second. Reaction waves build for 24-72h, so:
// (a) TOP-UP: re-harvest each watched article's angle; genuinely NEW named voices (verbatim-walled
//     again) are appended to the frontmatter reactions[] — the UI renders them as new cards, the
//     gate-verified body is never touched. Real update → dateModified bump (the freshness lever).
// (b) DEAD EMBEDS: re-resolve cached tweetIds; deleted/protected posts are dropped from
//     frontmatter (native quote text stays — articles never rot with blank embeds).
// (c) PARENT CASCADE: if the parent news article was retracted (file gone) or corrected, the
//     inside child gets a correction banner + noindex (gossip-lane pattern) — the ripple of a
//     retracted event must never keep ranking.
// Run: node site/pipeline/inside/monitor.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONTENT_DIR, INSIDE_FORMAT_TAG, MONITOR_WINDOW_HOURS, MAX_EMBEDS } from "./config.inside.mjs";
import { loadStore, bumpUpdated } from "./store.mjs";
import { harvestReactions, factBlockText, norm } from "./reactionFinder.mjs";
import { insideEditorialGate } from "./editorialGate.mjs";
import { getTweet } from "react-tweet/api";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

function loadWatched(dir, nowMs) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    try {
      const fp = path.join(dir, f);
      const { data, content } = matter.read(fp);
      if (data.formatTag !== INSIDE_FORMAT_TAG || data.retracted) continue;
      const age = (nowMs - Date.parse(data.date || 0)) / 36e5;
      if (age > MONITOR_WINDOW_HOURS) continue;
      out.push({ fp, data, content, slug: data.slug || f.replace(/\.md$/, "") });
    } catch { /* unparsable file — skip, never crash the monitor */ }
  }
  return out;
}

const save = (a, fm, body, dryRun) => { if (!dryRun) fs.writeFileSync(a.fp, matter.stringify("\n" + body.trim() + "\n", fm)); };

export async function monitorInside({
  dir = CONTENT_DIR,
  harvestImpl = harvestReactions,
  editorialImpl = insideEditorialGate,
  getTweetImpl = getTweet,
  storeImpl = null,
  dryRun = false,
  nowMs = null,
} = {}) {
  const now = nowMs ?? Date.now();
  const store = storeImpl || loadStore();
  const watched = loadWatched(dir, now);
  const results = [];

  for (const a of watched) {
    const actions = [];
    let fm = { ...a.data };
    let body = a.content;
    try {
      // (c) parent cascade first — a retracted parent trumps everything.
      if (fm.parentSlug) {
        const parentPath = path.join(dir, fm.parentSlug + ".md");
        let parentGone = !fs.existsSync(parentPath);
        let parentCorrected = false;
        if (!parentGone) {
          try { parentCorrected = !!matter.read(parentPath).data.correction; } catch { /* unreadable parent = leave child */ }
        }
        if (parentGone || parentCorrected) {
          // One-shot: an already-cascaded child is left alone (re-prepending the banner every
          // run would stack Editor's notes forever).
          if (fm.correction) { results.push({ slug: a.slug, action: "UNCHANGED", reason: "cascade already applied" }); continue; }
          const note = parentGone
            ? "The story this coverage responded to has been retracted. This article is retained for the record but should not be relied on."
            : "The story this coverage responded to has been corrected — see the linked article for the current facts.";
          fm.robots = "noindex";
          fm.correction = note;
          fm.dateModified = new Date(now).toISOString();
          body = `> **Editor's note (${new Date(now).toISOString().slice(0, 10)}):** ${note}\n\n${body}`;
          save(a, fm, body, dryRun);
          results.push({ slug: a.slug, action: "PARENT-CASCADE", reason: parentGone ? "parent retracted" : "parent corrected" });
          continue;
        }
      }

      // (b) dead embeds.
      if (Array.isArray(fm.tweetIds) && fm.tweetIds.length) {
        const alive = [];
        for (const id of fm.tweetIds) {
          try { const t = await getTweetImpl(String(id)); if (t && t.text) alive.push(id); } catch { /* dead */ }
        }
        if (alive.length !== fm.tweetIds.length) {
          actions.push(`embeds ${fm.tweetIds.length}→${alive.length}`);
          fm.tweetIds = alive;
          // Strip the key entirely — an `undefined` value makes gray-matter's stringify throw on save.
          fm.reactions = (fm.reactions || []).map((r) => {
            if (r.tweetId && !alive.includes(r.tweetId)) { const { tweetId, ...rest } = r; return rest; }
            return r;
          });
        }
      }

      // (a) top-up: re-harvest via the stored angle/trigger snapshot; append only NEW named
      // voices. Dedup against the FULL original harvest fingerprint (not just the curated cards),
      // and re-run the editorial event-match over the fresh material — this path is unattended,
      // so it fails CLOSED: no editor verdict, no append (retry next cycle).
      const rec = store.published.find((r) => r.slug === a.slug);
      if (rec?.angle && rec?.trigger) {
        const h = await harvestImpl(rec.trigger, rec.angle).catch(() => ({ ok: false }));
        if (h.ok) {
          const have = new Set([
            ...(rec.harvestQuoteKeys || []),
            ...(fm.reactions || []).map((r) => norm(r.quote).slice(0, 90)),
          ]);
          const fresh = h.factBlock.reactions
            .filter((r) => r.speaker && !have.has(norm(r.quote).slice(0, 90)))
            .slice(0, 5)
            .map((r) => ({ speaker: r.speaker, ...(r.connection ? { connection: r.connection } : {}), ...(r.platform ? { platform: r.platform } : {}), ...(r.date ? { date: r.date } : {}), quote: r.quote }));
          if (fresh.length >= 2) { // one straggler isn't an update; a real wave is
            const ed = await editorialImpl({
              trigger: rec.trigger, angle: rec.angle, factBlock: h.factBlock,
              factText: factBlockText(h.factBlock, rec.trigger),
            }).catch(() => ({ ran: false, reject: false }));
            if (ed.ran && !ed.reject) {
              fm.reactions = [...(fm.reactions || []), ...fresh];
              fm.updatedCount = (fm.updatedCount || 0) + 1;
              rec.harvestQuoteKeys = [...(rec.harvestQuoteKeys || []), ...fresh.map((r) => norm(r.quote).slice(0, 90))];
              actions.push(`+${fresh.length} new voices`);
            }
          }
        }
      }

      if (actions.length) {
        fm.updated = new Date(now).toISOString();
        fm.dateModified = fm.updated;
        save(a, fm, body, dryRun);
        if (!dryRun) bumpUpdated(store, a.slug);
        results.push({ slug: a.slug, action: "UPDATED", reason: actions.join("; ") });
      } else {
        results.push({ slug: a.slug, action: "UNCHANGED", reason: "" });
      }
    } catch (e) {
      results.push({ slug: a.slug, action: "ERROR", reason: String(e?.message || e).slice(0, 120) });
    }
  }
  return { watched: watched.length, results };
}

// CLI
if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const r = await monitorInside({ dryRun: process.argv.includes("--dry-run") });
  console.log(`━━ INSIDE MONITOR ━━ watched ${r.watched}`);
  for (const x of r.results) if (x.action !== "UNCHANGED") console.log(`  ${x.slug}: ${x.action} — ${x.reason}`);
}
