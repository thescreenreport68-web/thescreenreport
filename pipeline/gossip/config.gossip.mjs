// GOSSIP — ROUTING & WIRING CONFIG (Phase 0). Kept as a SEPARATE module so we don't edit the shared
// config.mjs TAXONOMY while the other chat is mid-rebuild of it. At integration time these values get wired
// into config.mjs / lib/site.ts; until then they live here and the gossip flow reads them directly.

// The internal tag that triggers the gossip TREATMENT (voice + legal gate + rumor UI). NOT a new website
// category — gossip articles file under the EXISTING categories below, distinguished only by this formatTag.
export const GOSSIP_FORMAT_TAG = "gossip";

// Subject → existing category (owner rule: no new category/brand/channel). Gossip files under the category
// of WHO it's about. Awards-race gossip files under awards. Subcategory uses the existing "news" sub
// (awards uses "predictions") so no new nav appears.
export function routeBySubject(subjectType) {
  switch ((subjectType || "").toLowerCase()) {
    case "musician":
    case "music":
      return { category: "music", subcategory: "news" };
    case "awards":
    case "awards-race":
      return { category: "awards", subcategory: "predictions" };
    case "actor":
    case "actress":
    case "celebrity":
    case "hollywood":
    default:
      return { category: "celebrity", subcategory: "news" };
  }
}

// Byline: the real freelance editor (added to lib/site.ts AUTHORS). Every gossip article carries her byline +
// the AI-assistance disclosure; the most sensitive stories get her POST-PUBLISH review (never a pre-publish gate).
export const GOSSIP_AUTHOR_SLUG = "alicia-bernard";
export const AI_DISCLOSURE = "This article was produced with AI-assisted research and reviewed editorially. Rumors and speculation are labeled as unconfirmed and updated or removed as facts develop.";

// Post-publish monitor window (owner: never WAIT to publish; the monitor watches AFTER publish). recheck.mjs
// already defaults to 48h; gossip uses the same window for the keep / correct / take-down decision.
export const MONITOR_WINDOW_HOURS = 48;

// INTEGRATION TODO (when the two chats merge / on a gossip branch):
//   • add `gossip` to config.mjs TAXONOMY formatTags + the classify snap-map,
//   • add a gossip writer spec to stages/generate.mjs NICHE map (reads frame.writerDirective),
//   • wire stages/gate.mjs (or a gossip gate wrapper) to run legalGate() before publish,
//   • add the rumor UI components + a "report a problem" page,
//   • widen find/recheck.mjs to watch ALL gossip (not just high-sensitivity).
