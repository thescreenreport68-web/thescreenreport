// GOSSIP — LEGAL-SAFETY GATE (Phase 1, Stage 6). The automated stand-in for a libel lawyer: a FAIL-CLOSED
// pre-publish check that BLOCKS (never softens) anything indefensible. Operates on the finished article + its
// frame. Returns { pass, blocks[] }. This is the gate the testing harness validates before go-live.
//
// What it enforces (each maps to a way real gossip outlets got sued — see RUMOR_GOSSIP_AUTOMATION_PLAN.md §3):
//   1. MISSING_DISCLAIMER      — an unconfirmed/sensitive story must say in the body that it is unconfirmed.
//   2. UNATTRIBUTED_DAMAGING   — a damaging claim stated as our own fact with no attribution/hedge (the Tasha-K move).
//   3. INTIMATE_MEDIA          — hosting/linking sex tapes / leaked nudes (the Gawker trap + revenge-porn law).
//   4. MINOR_ALLEGATION        — a criminal/sexual allegation involving a minor.
//   5. HOLD                    — the frame already decided to hold (EXTREME w/o an established outlet).
//   6. FABRICATION (optional)  — a checkable claim with a fabricated/missing receipt (reuses claimcheck).

import { verifyClaims } from "../lib/claimcheck.mjs";

// Body text the reader sees (prose + the headline + the dek).
const readerText = (a) => [a.title, a.dek, a.body, ...(a.faq || []).flatMap((f) => [f?.q, f?.a])].filter(Boolean).join("\n");

// The article explicitly says, somewhere, that the story is unconfirmed / not officially verified.
const DISCLAIMER_RE = /(not (been )?(independently )?(confirmed|verified)|has(?:n'?t| not) been (confirmed|verified)|unconfirmed|unverified|no official confirmation|has not (commented|responded|confirmed)|have not (commented|responded|confirmed)|could not (independently )?(confirm|verify)|representatives? (have|has) not|neither .{0,40}? (has|have) (confirmed|commented)|circulating as (a )?(rumou?r|speculation)|remains? (a )?(rumou?r|unconfirmed|speculation))/i;

// A sentence that imputes something genuinely damaging (defamation-per-se territory: disease, crime, drugs,
// sexual misconduct, infidelity, "secretly X"). These MAY only appear attributed or clearly framed as rumor.
const DAMAGING = /\b(herpes|hiv|std|tested positive|is a (prostitute|sex worker|escort|hooker)|(used|using|on|doing) (cocaine|heroin|meth|crack|drugs)|overdos\w*|is an? (addict|alcoholic)|cheat(ed|ing)?|having an affair|unfaithful|abus(ed|ing|er)|assault(ed|ing)?|\brape[ds]?\b|molest\w*|is (secretly )?(gay|pregnant|broke|bankrupt)|secretly (gay|pregnant|married|dating)|arrested|convicted|guilty of|fired for|fraud|scam\w*)\b/i;

// Attribution / hedge / framing that makes a damaging mention defensible within the same sentence.
const ATTRIB = /(according to|reportedly|alleged\w*|claim\w*|sources? (say|tell|claim)|per [A-Z]|told [A-Z][a-z]|rumou?r\w*|unconfirmed|unverified|denies|denied|speculat\w*|appears? to|seem\w* to|fans? (think|believe|speculate)|is said to|purported\w*|insider\w*)/i;

// Intimate / leaked media + any hosting/serving language → we report the STORY, never the media.
const INTIMATE = /(sex tape|nude (photo|pic|image|leak)|leaked (nudes?|photos?|videos?|images?|footage)|revenge porn|naked (photo|pic|image)|explicit (photo|video|image)s?)/i;
const HOSTING = /(watch|download|view|see (it|them|the)|click|tap|link|here|full (video|tape)|uncensored|leaked below|see more)/i;

// Minor + a sexual/criminal context → never publish.
const MINOR = /\b(underage|under-?age|a minor\b|the minor\b|\d{1,2}-year-old|teenage(r)?|\bchild\b|\bchildren\b|\bkids?\b|\bminors?\b)\b/i;
const MINOR_BAD = /\b(sexual\w*|assault\w*|abuse\w*|\brape[ds]?\b|molest\w*|nude|sex\b|explicit|groom\w*|predator)\b/i;

function splitSentences(text) {
  return (text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

export function legalGate(article, frame = {}, topic = null) {
  const blocks = [];
  const text = readerText(article);

  // 5) the frame already decided to HOLD (EXTREME w/o an established outlet) — defense in depth.
  if (frame.decision === "HOLD") blocks.push(`HOLD: ${frame.reason}`);

  // 1) disclaimer must be present when the frame requires it.
  if (frame.needsDisclaimer && !DISCLAIMER_RE.test(text))
    blocks.push("MISSING_DISCLAIMER: this story is unconfirmed/sensitive but the body never states it is unconfirmed (not confirmed by the person/authorities/studio). The mandatory non-confirmation sentence is missing.");

  // 2) unattributed damaging assertion — per sentence (the single most lawsuit-prone error).
  for (const s of splitSentences([article.title, article.dek, article.body].filter(Boolean).join(". "))) {
    if (DAMAGING.test(s) && !ATTRIB.test(s)) {
      blocks.push(`UNATTRIBUTED_DAMAGING_CLAIM: "${s.slice(0, 100)}" — a damaging claim stated as fact with no attribution or rumor-framing. Attribute it or frame it as speculation.`);
      break;
    }
  }

  // 3) hosting / linking intimate or leaked media.
  if (INTIMATE.test(text) && HOSTING.test(text))
    blocks.push("INTIMATE_MEDIA: the article appears to host or link intimate/leaked media. Report that the story exists; never serve or link the media itself.");

  // 4) a sexual/criminal allegation involving a minor.
  if (MINOR.test(text) && MINOR_BAD.test(text))
    blocks.push("MINOR_ALLEGATION: a sexual/criminal allegation involving a minor — never publish.");

  // 6) fabrication (only if the writer emitted claims[] + we have grounding facts to check against).
  if (Array.isArray(article.claims) && article.claims.length && topic && (topic.facts || []).length) {
    const cc = verifyClaims(article, topic);
    for (const v of cc.contradicted) blocks.push(`FABRICATION: "${v.claim}" — ${v.why}`);
  }

  return { pass: blocks.length === 0, blocks };
}
