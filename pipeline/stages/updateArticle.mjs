// updateArticle.mjs — ONE STORY = ONE URL (owner standing policy, 2026-07-19).
//
// Merges a fresh development into an ALREADY-PUBLISHED article instead of minting a second URL.
// Called only when find/sameStory.mjs has confirmed, at high confidence, that the incoming topic is a
// development of an article THIS lane published within ~7 days.
//
// ── WHAT IS PRESERVED, AND WHY ───────────────────────────────────────────────────────────────────
// The whole point is that the URL survives, so everything that DEFINES the URL or its accumulated
// trust is frozen:
//   slug + category + subcategory  → the live URL is /<category>/<slug>/. Changing either would
//                                    create the very second URL this policy exists to prevent.
//   date                           → the original publish date. `dateModified` carries the refresh;
//                                    rewriting `date` would fake the article's age.
//   author                         → stable byline.
//   hero image + its dimensions    → re-sourcing costs an image+vision call per update for no reader
//                                    benefit, and swapping art on a live page is pure churn.
//   title + metaTitle              → BY DEFAULT. Headline churn on indexed pages is exactly what the
//                                    owner's 2026-07-20 directive warns about. The one exception is
//                                    below, because a stale headline is an ACCURACY failure.
//
// ── THE TITLE EXCEPTION ──────────────────────────────────────────────────────────────────────────
// A developing story can invert its own headline: "Ryan Hurst Recast as Kratos" is actively FALSE
// once the development is "God of War to Recast Kratos Following Ryan Hurst Exit" (a real pair from
// the live queue). Keeping the old headline there would publish a false statement — and accuracy
// outranks churn-avoidance. So the title is refreshed ONLY when the new headline has materially
// diverged from the old (< MATERIAL_SIM shared-stem similarity), which is rare by construction.
import fs from "node:fs";
import { createRequire } from "node:module";
import { stems } from "../find/sameStory.mjs";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

// Identity fields — frozen so the URL and the page's accrued trust survive the update.
const PRESERVE = ["slug", "date", "category", "subcategory", "author", "image", "imageWidth", "imageHeight", "imageCredit", "imageAlt"];
// Similarity below which the new headline counts as a MATERIAL development, not a rewording.
const MATERIAL_SIM = Number(process.env.UPDATE_TITLE_SIM ?? 0.6);
// Minimum gap between two updates to the same article. Without it a story that keeps resurfacing
// gets rewritten every tick — the churn signal the owner's 2026-07-20 directive warns about.
const COOLDOWN_H = Number(process.env.UPDATE_COOLDOWN_H ?? 6);

// Jaccard-style similarity over significant stems, measured against the smaller set so that a longer
// new headline that merely ADDS detail still reads as "same headline".
export function titleSimilarity(a, b) {
  const A = stems(a), B = stems(b);
  if (!A.size || !B.size) return 1;                       // unknown → treat as unchanged (safe)
  return [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size);
}

// ── MEANING INVERSION, NOT WORD DISTANCE ────────────────────────────────────────────────────────
// Similarity alone cannot see that a headline has become FALSE. The real pair from the live queue:
//   old "Ryan Hurst CAST as Kratos in Prime Video's God of War Series"
//   new "God of War to RECAST Kratos Role Following Ryan Hurst EXIT"
// Every proper noun is shared, so similarity scores 0.71 and reads as "same headline" — yet the old
// one now asserts something untrue. These markers catch the reversal/status flips that similarity
// misses: a marker present in the NEW headline and absent from the OLD one means the story moved.
const REVERSAL = /\b(recast|replaces?|replaced|replacing|exits?|exited|quits?|fired|axed|ousted|dropped|steps? down|stepping down|no longer|out as|denies|denied|debunk\w*|delayed|postponed|cancell?ed|scrapped|shelved|halted|dies|died|dead|death|confirms?|confirmed|officially|lands?|closes? deal|calls? off|pulls? out|withdraws?)\b/i;

export function headlineSuperseded(oldTitle, newTitle) {
  const o = String(oldTitle || ""), n = String(newTitle || "");
  if (!n) return false;
  const m = n.match(REVERSAL);
  return !!m && !REVERSAL.test(o);
}

// Merge `out` (a fresh assemble() result) into the existing article at `file`.
// Returns { md, slug, changed, titleChanged, sim } — or null when the file cannot be read, in which
// case the caller MUST fall back to publishing normally rather than risk losing the development.
export function mergeUpdate({ file, out, nowISO = new Date().toISOString(), cooldownH = COOLDOWN_H }) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return null; }
  let parsed;
  try { parsed = matter(raw); } catch { return null; }
  const old = parsed.data || {};
  if (!old.slug && !old.title) return null;               // not a real article → refuse to overwrite

  // ANTI-CHURN COOLDOWN: a story that keeps resurfacing must not be rewritten every tick. Rewriting a
  // live page repeatedly is the churn signal the owner's 2026-07-20 directive warns about, and it also
  // burns a full write for a marginal delta. `skipped` tells the caller to drop the topic quietly.
  const lastTouch = Date.parse(old.dateModified || old.date || "");
  if (Number.isFinite(lastTouch) && cooldownH > 0) {
    const ageH = (Date.parse(nowISO) - lastTouch) / 3600_000;
    if (ageH < cooldownH) return { skipped: true, slug: old.slug, ageH, cooldownH };
  }

  // Start from the FRESH frontmatter (new facts, tags, takeaways, FAQ, structured fields, SEO desc),
  // then stamp the frozen identity fields back over it.
  const fm = { ...out.frontmatter };
  for (const k of PRESERVE) {
    if (old[k] !== undefined) fm[k] = old[k];
    else delete fm[k];
  }

  // Headline: keep the published one unless the story materially moved (see THE TITLE EXCEPTION).
  // Two independent triggers — word-distance for a rewritten headline, reversal markers for one that
  // kept its nouns but flipped its meaning (similarity is blind to that; see headlineSuperseded).
  const sim = titleSimilarity(old.title || "", out.frontmatter.title || "");
  const superseded = headlineSuperseded(old.title, out.frontmatter.title);
  const titleChanged = !!out.frontmatter.title && (sim < MATERIAL_SIM || superseded);
  if (!titleChanged) {
    fm.title = old.title;
    if (old.metaTitle) fm.metaTitle = old.metaTitle;
  }

  // The refresh stamp the policy requires. `date` is untouched above, so the article keeps its age
  // while search engines and the page footer see a genuine modification time.
  fm.dateModified = nowISO;
  fm.updateCount = Number(old.updateCount || 0) + 1;

  // SELF-LINK: assemble() built the internal links against the NEW slug it would have minted, but this
  // body is being written to the ORIGINAL slug — so any link to that slug is now a link to the page
  // itself. Unwrap those back to plain text (keep the anchor words, drop the link).
  const selfPath = `/${fm.category}/${fm.slug}/`;
  const body = String(out.body || "").replace(
    new RegExp(`\\[([^\\]]+)\\]\\(${selfPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "g"), "$1");

  return {
    md: matter.stringify("\n" + body.trim() + "\n", fm),
    slug: fm.slug,
    frontmatter: fm,
    titleChanged,
    superseded,
    sim,
    changed: {
      title: titleChanged ? { from: old.title, to: fm.title } : null,
      dek: old.dek !== fm.dek,
      body: String(parsed.content || "").trim() !== body.trim(),
      metaDescription: old.metaDescription !== fm.metaDescription,
    },
  };
}
