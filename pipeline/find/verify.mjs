// Stage 8 (v2) — cross-source VERIFY. The breaking-news answer to "Wikipedia can't tell us if a
// 10-minute-old event is true." We DON'T ask Wikipedia about the event; we corroborate it across the
// outlets that reported it and assign a trust label that controls IF and HOW it publishes.
//
// Policy (owner-decided, FIND_HALF_PLAN "OWNER DECISIONS" + App-L source tiers):
//   • CONFIRMED      — ≥2 independent major (tier≥7) sources, OR a major + a reputable secondary →
//                      plain-statement framing, FAST publish.
//   • DEVELOPING     — exactly one major (tier≥7) named source → publish WITH "according to [Outlet]"
//                      attribution; auto-upgrades to CONFIRMED when a 2nd major lands (across runs, in D1).
//   • RUMOR          — tabloid-only (tier 4) → mandatory safe-framing template.
//   • QUEUE          — a single reputable secondary (tier 5–6) alone → NOT publishable yet; wait for a
//                      major (owner: "publish on a single source only if it's a MAJOR outlet").
//   • CONFIRMING     — high-sensitivity (death/health-crisis/legal/arrest) without ≥2 majors → HOLD.
//                      (owner: "celebrities fake deaths; even majors err — hold for 2–3 majors.")
//   • EDITORIAL-HOLD — anonymous/social-only/private-person → do not publish; escalation queue.
//   • EVERGREEN      — reference/opinion niches (list/explainer/guide/profile) or TMDB-backbone items:
//                      no breaking event-claim to corroborate; grounded on Wikipedia/TMDB → publishable.
//
// NOTE (local v1-of-v2): corroboration here is within a SINGLE run's candidate set. In the cloud the
// persistent D1 candidate/cluster store accumulates sources ACROSS runs, so a DEVELOPING story upgrades
// to CONFIRMED as more outlets pick it up over the following minutes/hours. The logic is identical; only
// the source-of-sources changes (in-run array → D1 cluster). That swap is the cloud-port task.

const TIER1 = 7; // major trade / wire / official record
const SECONDARY = 5; // reputable secondary / major-celebrity outlet (5–6)
const EVERGREEN_FORMATS = new Set(["list", "explainer", "guide", "profile"]);

// DETERMINISTIC sensitivity floor — the LLM's sensitivity flag is non-deterministic, so a death/legal/
// arrest/health story could slip to "normal" and bypass the CONFIRMING-hold. This regex force-promotes
// any such story to high-sensitivity so the 2–3-major-source hold is GUARANTEED, never LLM-dependent.
// Stem-matched (leading \b, NO trailing \b) so inflections catch: alleg→alleged/allegedly/allegation,
// arrest→arrested, hospitaliz→hospitalized, indict→indicted, abus→abuse/abused.
const SENSITIVE = /\b(dead|dies|died|death|killed|obituar|passed away|passes away|arrest|charged|indict|lawsuit|sued|felony|assault|abus|alleg|hospitaliz|critical condition|overdose|suicide|in a coma|shooting|custody battle|restraining order)/i;

const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function sensitivityFloor(rep) {
  if (rep.sensitivity === "high") return "high";
  const hay = [rep.title, ...(rep.sources || []).flatMap((s) => [s.headline, s.summary])].join(" ");
  return SENSITIVE.test(hay) ? "high" : "normal";
}

export function verify(topics, monitor) {
  // Group by the outlet-agnostic event slug so two outlets on the same story corroborate each other.
  const groups = new Map();
  for (const t of topics) {
    const key = t.eventSlug || `${slug(t.primaryEntity)}:${t.eventType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const out = [];
  for (const [, group] of groups) {
    // Merge distinct outlets across the cluster onto one representative topic.
    const sources = [];
    const seen = new Set();
    for (const t of group)
      for (const s of t.sources || []) {
        if (s.outlet && !seen.has(s.outlet)) {
          seen.add(s.outlet);
          sources.push(s);
        }
      }
    const rep = pickRep(group);
    rep.sources = sources;
    rep.corroborationCount = sources.length;
    rep.verification = decide(rep, sources);
    out.push(rep);
  }

  const byStatus = {};
  for (const t of out) byStatus[t.verification.status] = (byStatus[t.verification.status] || 0) + 1;
  const publishable = out.filter((t) => t.verification.publishable).length;
  monitor.count("verifiedTopics", out.length);
  monitor.count("publishable", publishable);
  monitor.stage("verify", `${out.length} events → ${publishable} publishable`, byStatus);
  for (const t of out)
    monitor.stage("verify", `${t.verification.status}${t.verification.publishable ? "" : " (HELD)"} · [${t.formatTag}] ${t.title} · ${t.verification.outletCount} outlet(s) [${(t.sources || []).map((s) => `${s.outlet}/${s.tier}`).join(", ") || "TMDB/backbone"}]`);

  return out;
}

// Choose the cluster representative: highest source tier first, then freshest (lowest ageMin).
function pickRep(group) {
  return [...group].sort((a, b) => {
    const ta = Math.max(0, ...(a.sources || []).map((s) => s.tier || 0));
    const tb = Math.max(0, ...(b.sources || []).map((s) => s.tier || 0));
    if (tb !== ta) return tb - ta;
    return (a.ageMin ?? 1e9) - (b.ageMin ?? 1e9);
  })[0];
}

function decide(rep, sources) {
  const outlets = sources.map((s) => s.outlet);
  const tier1 = sources.filter((s) => (s.tier || 0) >= TIER1);
  const secondary = sources.filter((s) => (s.tier || 0) >= SECONDARY && (s.tier || 0) < TIER1);
  const tabloid = sources.filter((s) => (s.tier || 0) === 4);
  const maxTier = sources.reduce((m, s) => Math.max(m, s.tier || 0), 0);
  const sensitivity = sensitivityFloor(rep); // deterministic floor (never trust the LLM flag downward)
  rep.sensitivity = sensitivity;
  const base = { tier1Count: tier1.length, outletCount: outlets.length, outlets, maxTier, sensitivity, attribution: null, framing: "plain" };

  // No breaking outlet sources (TMDB backbone) OR a reference/opinion niche → evergreen, grounded, publishable.
  if (sources.length === 0 || EVERGREEN_FORMATS.has(rep.formatTag)) {
    return { ...base, status: "EVERGREEN", publishable: true };
  }

  const major = tier1[0]?.outlet;

  // High-sensitivity (death / health crisis / legal / arrest): hold unless ≥2 majors confirm.
  if (sensitivity === "high") {
    if (tier1.length >= 2) return { ...base, status: "CONFIRMED", framing: "plain", publishable: true };
    return { ...base, status: "CONFIRMING", framing: "hold", publishable: false, hold: "high-sensitivity event needs ≥2 major outlets" };
  }

  // Normal sensitivity.
  if (tier1.length >= 2 || (tier1.length >= 1 && secondary.length >= 1))
    return { ...base, status: "CONFIRMED", framing: "plain", publishable: true };
  if (tier1.length === 1)
    return { ...base, status: "DEVELOPING", framing: "attributed", attribution: major, publishable: true };
  if (secondary.length >= 2)
    return { ...base, status: "DEVELOPING", framing: "attributed", attribution: "multiple outlets", publishable: true };
  if (secondary.length === 1)
    return { ...base, status: "QUEUE", framing: "hold", publishable: false, hold: "single reputable secondary — await a major outlet to corroborate" };
  if (tabloid.length >= 1)
    return { ...base, status: "RUMOR", framing: "rumor-safe", attribution: tabloid[0].outlet, publishable: true };
  return { ...base, status: "EDITORIAL-HOLD", framing: "hold", publishable: false, hold: "no named reputable source" };
}
