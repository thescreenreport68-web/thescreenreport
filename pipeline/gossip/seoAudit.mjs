// GOSSIP — SEO AUDITOR (Phase 3 of GOSSIP_MULTI_AGENT_UPGRADE_PLAN.md). The owner's "separate agent that
// checks the SEO after the article is delivered": a deterministic WALL-SET over the FINAL assembled
// frontmatter + body, with SAFE AUTO-REPAIRS (regenerate a broken meta field via the proven seo.mjs
// builders, strip markdown leaks, drop ungrounded derived items) — plus a cheap flash-lite semantic pass
// (report-only). Publish-everything stays: the auditor REPAIRS or LOGS, it never blocks.
//
// CROSS-SURFACE CONSISTENCY (the boxoffice "Obsession" lesson): every number and proper name on every
// DERIVED surface (metaTitle / metaDescription / dek / keyTakeaways / FAQ) must be grounded in the
// article's own verified corpus (title + body + claims' source quotes + bundle) — an ungrounded derived
// item is repaired or dropped, never shipped.
import { seoMetaTitle, buildMetaDescription, validMetaTitle, validMetaDesc, clampDesc, JUNK_TAG } from "./seo.mjs";
import { numbersGrounded, namesGrounded } from "./headline.mjs";
import { SCAFFOLD_RE, ABSENCE_RE } from "./proseGuards.mjs";
import { agentChat } from "./models.mjs";

const MD_RE = /\*\*|__|(?<!\w)[*_](?=\w)|`|^#+\s/m;
const stripMd = (s) => String(s ?? "").replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
const SUPERLATIVE_RE = /\b(shocking|jaw-dropping|you won'?t believe|mind-blowing|insane|unbelievable|slams|destroys|obliterates)\b/i;
const TEMPLATE_RE = /what happens when [^.?]{3,60}\?|^\s*(what|when|how|why|who|is|are|can|does|do|could|would)\b[^.?!]{3,90}\?/i;

const grounded = (s, corpus) => numbersGrounded(s, corpus) && namesGrounded(s, corpus);

/**
 * Deterministic wall-set + safe repairs over the assembled frontmatter. PURE (no LLM, no I/O) — runs inside
 * assemble on every article, offline-testable. Mutates + returns { fm, issues }.
 * issues: [{ code, field, action: "repaired"|"dropped"|"logged" , note }]
 */
export function auditArticleSeo({ fm, body = "", topic = {}, bundle = null }) {
  const issues = [];
  const log = (code, field, action, note = "") => issues.push({ code, field, action, note: String(note).slice(0, 120) });
  const names = [topic?.primaryEntity, ...(topic?.coSubjects || [])].filter(Boolean);
  // The grounding corpus: reader-verified text + the bundle evidence the claims cited.
  const corpus = [
    fm.title, body,
    ...(fm.whatWeKnow || []),
    ...((bundle?.sources || []).map((s) => s.text)),
  ].join("\n");

  // ── metaTitle wall ──
  {
    let mt = stripMd(fm.metaTitle);
    if (mt !== fm.metaTitle) log("md-leak", "metaTitle", "repaired");
    const bad = !mt || !validMetaTitle(mt, names) || !grounded(mt, corpus);
    if (bad) {
      mt = seoMetaTitle({ title: fm.title, primaryEntity: topic.primaryEntity || "", tags: fm.tags || [], coSubjects: topic.coSubjects || [] });
      log("metaTitle-contract", "metaTitle", "repaired", "regenerated from the headline");
    }
    fm.metaTitle = mt;
  }
  // ── metaDescription wall (>160 collapses to the dek at render; ungrounded specifics never ship) ──
  {
    let md = stripMd(fm.metaDescription);
    if (md !== fm.metaDescription) log("md-leak", "metaDescription", "repaired");
    if (!md || md.length > 160 || !grounded(md, corpus)) {
      md = buildMetaDescription({ writerMetaDesc: "", dek: fm.dek, keyTakeaways: fm.keyTakeaways, whatWeKnow: fm.whatWeKnow });
      log("metaDescription-contract", "metaDescription", "repaired", "rebuilt from dek + a verified fact");
    } else if (!validMetaDesc(md, fm.dek)) {
      log("metaDescription-soft", "metaDescription", "logged", "outside 140–160 target or equals the dek");
    }
    fm.metaDescription = md;
  }
  // ── dek wall ──
  {
    let dek = stripMd(fm.dek);
    if (dek !== fm.dek) log("md-leak", "dek", "repaired");
    if (dek.length > 170) { dek = clampDesc(dek, 168); log("dek-length", "dek", "repaired"); }
    if (dek && !grounded(dek, corpus)) log("dek-ungrounded", "dek", "logged", "specific not found in corpus");
    fm.dek = dek;
  }
  // ── H1 (reader-facing + already verified: NEVER auto-edited — log only) ──
  if ((fm.title || "").length > 110) log("h1-over-110", "title", "logged", `len ${fm.title.length} exceeds schema headline limit`);
  if (SUPERLATIVE_RE.test(fm.title || "")) log("h1-superlative", "title", "logged", "Discover classifier penalty risk");
  // ── body checks ──
  if (TEMPLATE_RE.test(body)) log("template-fingerprint", "body", "logged", "'What happens when…?' opener");
  const firstGraf = String(body).split(/\n{2,}/)[0] || "";
  const surname = String(topic.primaryEntity || "").split(/\s+/).pop() || "";
  if (surname.length > 2 && !firstGraf.toLowerCase().includes(surname.toLowerCase())) log("lede-entity-missing", "body", "logged", "first graf does not name the subject");
  if (!/\d/.test(body)) log("geo-no-number", "body", "logged", "no concrete number in the piece");
  if (!/\b(told|per|according to|reports?|reported|confirmed to)\b/i.test(body)) log("geo-no-attribution", "body", "logged", "no outlet named in text");
  // ── derived lists: markdown strip + grounding (ungrounded item = dropped, never shipped) ──
  if (Array.isArray(fm.keyTakeaways)) {
    const before = fm.keyTakeaways.length;
    fm.keyTakeaways = fm.keyTakeaways.map(stripMd).filter((t) => t && grounded(t, corpus));
    if (fm.keyTakeaways.length < before) log("takeaway-ungrounded", "keyTakeaways", "dropped", `${before - fm.keyTakeaways.length} item(s)`);
  }
  if (Array.isArray(fm.faq)) {
    const before = fm.faq.length;
    fm.faq = fm.faq
      .map((f) => (f && f.q && f.a ? { q: stripMd(f.q), a: stripMd(f.a) } : null))
      .filter((f) => f && f.a.split(/\s+/).length >= 4 && grounded(f.a, corpus));
    if (fm.faq.length < before) log("faq-cleaned", "faq", "dropped", `${before - fm.faq.length} item(s)`);
  }
  // ── tags: junk purge (belt over deriveKeywords' braces) ──
  if (Array.isArray(fm.tags)) {
    const before = fm.tags.length;
    fm.tags = [...new Set(fm.tags.map((t) => String(t || "").trim()).filter((t) => t && !JUNK_TAG.has(t.toLowerCase())))];
    if (fm.tags.length < before) log("junk-tag", "tags", "dropped");
  }
  // ── Discover card contract (report-only; the branded-card fallback is Phase 4) ──
  if (!fm.image) log("no-image", "image", "logged", "no og:image / no Discover card");
  else if (!fm.imageCredit) log("no-image-credit", "imageCredit", "logged");
  // ── Phase 1 heat contract presence ──
  if (!fm.eventSlug) log("no-eventSlug", "eventSlug", "logged");
  // ── 2026-07-18 final walls (the cutters run upstream — anything caught HERE means a guard regressed) ──
  if (SCAFFOLD_RE.test(body)) log("scaffolding-leak", "body", "logged", "verification language reached the final body");
  if (ABSENCE_RE.test(body)) log("absence-claim", "body", "logged", "unverifiable absence assertion in prose");
  for (const q of fm.faq || []) if (q?.a && ABSENCE_RE.test(q.a)) log("absence-claim", "faq", "logged", q.q);
  if (!/^##\s+Sources\b/m.test(body)) log("no-sources-block", "body", "logged", "article ships without cited outbound links");
  return { fm, issues };
}

// ── Semantic pass (flash-lite, metered role "seoAuditor") — REPORT-ONLY: does the snippet earn its click,
// is the keyword natural, is the unconfirmed framed honestly? Never blocks; feeds the stats ledger. ──
export async function semanticSeoPass({ fm, topic, chatImpl } = {}) {
  try {
    const user = `SEARCH SNIPPET AUDIT for a celebrity article. Judge these stored fields:
metaTitle: ${fm.metaTitle}
metaDescription: ${fm.metaDescription}
H1: ${fm.title}
rumorStatus: ${fm.rumorStatus || ""}
SUBJECT: ${topic?.primaryEntity || ""}

Return STRICT JSON: { "clickEarned": <bool — does the snippet promise exactly what an article like this delivers>, "stuffing": <bool — is any phrase unnaturally repeated for SEO>, "honestLabel": <bool — if the status is a rumor/report, does the snippet avoid stating it as settled fact>, "note": "one short clause" }`;
    const { data } = await agentChat("seoAuditor", { system: "You audit search snippets for a news site. Output strict JSON only.", user, json: true }, chatImpl ? { chatImpl } : {});
    return data && typeof data === "object" ? data : null;
  } catch { return null; }
}
