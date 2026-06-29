// GOSSIP AUTOMATION — POLICY CONFIG (Phase 0). Self-contained; edits NONE of the shared news-pipeline files
// (the other chat is mid-rebuild of those). Reuses only lib/* helpers. This is the single source of truth for:
//   • source tiers + the "well-known established outlet" bar,
//   • the severity classes (NORMAL / HIGH / EXTREME),
//   • the confidence tiers, and the framing / UI-label / disclaimer each (tier × severity) demands.
//
// OWNER RULES (2026-06-29):
//   1. Publish unconfirmed stories IMMEDIATELY with an in-text "this is unconfirmed" disclaimer — never wait.
//   2. EXTREME class (sexual assault / minors) is NOT run on raw speculation — only once a well-known
//      ESTABLISHED outlet has reported it, then re-reported in our own attributed, reporter-friendly words.
//   3. Hard "never-do" methods: never assert a damaging claim as our own unattributed fact; never fabricate
//      a source/quote; never host/link intimate or leaked media; never allege crime/sex about a minor.

// Outlet → trust tier. (Mirrors the news pipeline's App-L tiering idea, kept LOCAL so we don't touch it.)
export const OUTLET_TIER = {
  // tier 7 — major trade / wire / record
  Variety: 7, Deadline: 7, "The Hollywood Reporter": 7, THR: 7, AP: 7, "Associated Press": 7, Reuters: 7,
  "The New York Times": 7, "Washington Post": 7, BBC: 7, CNN: 7, "NBC News": 7, "ABC News": 7, "CBS News": 7,
  // tier 6 — established celebrity desks (well-known; these break crime/legal/death the right way)
  TMZ: 6, "Page Six": 6, People: 6, "Us Weekly": 6, "Entertainment Weekly": 6, EW: 6, "E! News": 6,
  Billboard: 6, "Rolling Stone": 6, "Vanity Fair": 6,
  // tier 5 — secondary entertainment
  "Just Jared": 5, Collider: 5, IndieWire: 5, Complex: 5, Vulture: 5, "Entertainment Tonight": 5,
  // tier 4 — tabloid / gossip blog
  "Daily Mail": 4, "The Sun": 4, "The Shade Room": 4, "Radar Online": 4, "The Blast": 4,
  // tier 2 — social / anonymous (a DISCOVERY signal only, never proof of a claim)
  "Pop Crave": 2, PopBase: 2, DeuxMoi: 2, Deuxmoi: 2, X: 2, Twitter: 2, Reddit: 2, Instagram: 2, TikTok: 2,
};
export const ESTABLISHED_TIER = 6; // the "well-known established outlet" bar (gates the EXTREME class)
export const tierOf = (outlet) => OUTLET_TIER[outlet] ?? 3; // unknown outlet = a cautious mid-low default
export const maxTier = (sources = []) => sources.reduce((m, s) => Math.max(m, s.tier ?? tierOf(s.outlet)), 0);
export const topOutlet = (sources = []) =>
  [...sources].sort((a, b) => (b.tier ?? tierOf(b.outlet)) - (a.tier ?? tierOf(a.outlet)))[0]?.outlet || null;
export const hasEstablished = (sources = []) => sources.some((s) => (s.tier ?? tierOf(s.outlet)) >= ESTABLISHED_TIER);

// ── SEVERITY ──────────────────────────────────────────────────────────────────────────────────────
// EXTREME = sexual-assault class, OR any serious allegation involving a minor → gated behind an
//           established outlet (owner rule 2). HIGH = death/crime/health/affair/outing → publish WITH the
//           in-text disclaimer + post-publish monitor. NORMAL = dating/feuds/fashion/deals → publish freely.
export const SEV = {
  extreme: /\b(sexual(ly)?\s+(assault|abuse|misconduct|harass\w*)|\brape[ds]?\b|raping|molest\w*|grooming|sexual predator|underage\s+(sex|relationship)|child\s+(abuse|porn|sexual))\b/i,
  minor: /\b(underage|under-?age|a\s+minor\b|the\s+minor\b|(1[0-7]|[1-9])-year-old|teenage(r)?|\bchild\b|\bchildren\b|\bkids?\b)\b/i,
  high: /\b(dead|dies|died|death|passed away|obituar\w*|killed|murder\w*|arrest\w*|charged|indict\w*|felony|lawsuit|sued|\bdui\b|assault\w*|abus\w+|hospitaliz\w*|overdos\w*|rehab|addict\w*|cancer|terminal|in a coma|suicid\w*|self-?harm|restraining order|custody battle|divorce|cheat\w*|affair|unfaithful|pregnan\w*|miscarriage|came out|comes out|\bgay\b|sexuality)\b/i,
};
export function severity(text = "") {
  const t = text || "";
  if (SEV.extreme.test(t)) return "EXTREME";
  if (SEV.minor.test(t) && SEV.high.test(t)) return "EXTREME"; // a serious allegation involving a minor
  if (SEV.high.test(t)) return "HIGH";
  return "NORMAL";
}

// ── CONFIDENCE TIER (from the sources, unless explicit topic flags say otherwise) ───────────────────
export function confidenceTier(topic) {
  if (topic.confirmed) return "CONFIRMED"; // on the record / the person's own words / the studio confirmed
  if (topic.official) return "OFFICIAL_RECORD"; // a court filing / police statement (fair-report lane)
  if (topic.denied) return "DENIED"; // the subject / their rep has denied it
  const t = maxTier(topic.sources || []);
  if (t >= ESTABLISHED_TIER) return "REPORTED_BY_MAJOR"; // an established outlet is carrying it
  if (t >= 4) return "SINGLE_SOURCE_RUMOR"; // a secondary/tabloid blog
  return "SOCIAL_SPECULATION"; // X / Reddit / anon only
}

// UI label + whether confirmation is hard (no disclaimer needed) for a given tier.
export const TIER_META = {
  CONFIRMED: { label: "Confirmed", hardConfirmed: true, framing: "plain" },
  OFFICIAL_RECORD: { label: "Per official records", hardConfirmed: true, framing: "official" },
  REPORTED_BY_MAJOR: { label: "Reported by", hardConfirmed: false, framing: "attributed" }, // label gets the outlet appended
  SINGLE_SOURCE_RUMOR: { label: "Unconfirmed rumor", hardConfirmed: false, framing: "rumor-safe" },
  SOCIAL_SPECULATION: { label: "Social speculation", hardConfirmed: false, framing: "rumor-safe" },
  DENIED: { label: "Denied by subject", hardConfirmed: false, framing: "denial-forward" },
};
