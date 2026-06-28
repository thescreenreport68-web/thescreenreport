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

// PARENT-COMPANY groups — same-owner outlets are NOT independent corroboration. Penske Media (PMC) owns
// Deadline + Variety + THR + IndieWire, so when PMC syndicates one scoop all three carry it in minutes:
// that is ONE editorial source, not three. CONFIRMED therefore requires 2 INDEPENDENT OWNERS, not 2 strings.
const OWNER = { Variety: "PMC", Deadline: "PMC", THR: "PMC", IndieWire: "PMC", Collider: "Valnet", ScreenRant: "Valnet", SlashFilm: "Static", People: "DotdashMeredith" };
const ownerOf = (o) => OWNER[o] || o;

// DETERMINISTIC sensitivity floor — the LLM's sensitivity flag is non-deterministic, so a death/legal/
// arrest/health story could slip to "normal" and bypass the CONFIRMING-hold. This regex force-promotes
// any such story to high-sensitivity so the 2–3-major-source hold is GUARANTEED, never LLM-dependent.
// Stem-matched (leading \b, NO trailing \b) so inflections catch: alleg→alleged/allegedly/allegation,
// arrest→arrested, hospitaliz→hospitalized, indict→indicted, abus→abuse/abused.
const SENSITIVE = /\b(dead|dies|died|death|killed|obituar|passed away|passes away|arrest|charged|indict|lawsuit|sued|felony|assault|abus|alleg|hospitaliz|critical condition|overdose|suicide|in a coma|shooting|custody battle|restraining order)/i;

const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Title-token overlap for the secondary cluster-merge. Two outlets rarely emit byte-identical eventSlugs
// for the same scoop ("brad-pitt-joins-f1-sequel" vs "brad-pitt-cast-f1-2"), so an eventSlug-only grouping
// splits one real 2-major event into two false single-source events. We rescue those by merging clusters
// that share the SAME entity + SAME eventType AND have high title-word overlap — which keeps "Brad Pitt
// cast in X" and "Brad Pitt cast in Y" APART (the distinguishing film token drops the overlap below the
// threshold). Robust semantic clustering (embeddings, cross-run) is the cloud-port; this is the local floor.
const STOP = new Set("a an the of to in on for at by and or with as is are was were be been will would could star stars cast joins set new film movie show series report reports says according".split(" "));
const titleTokens = (s) => new Set((s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

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

  // Secondary merge: collapse distinct-eventSlug clusters that are really ONE event (same entity + type +
  // overlapping titles) so genuine cross-outlet corroboration isn't lost to slug wording differences.
  const merged = mergeClusters([...groups.values()]);

  const out = [];
  for (const group of merged) {
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

// Union-find merge of eventSlug clusters into true events. Two clusters merge when their representatives
// share the same normalized primaryEntity AND eventType AND title-token Jaccard ≥ 0.5. Threshold is
// deliberately high: it rescues wording variants of ONE scoop without fusing two different same-person,
// same-type stories (the distinguishing film/title token keeps their overlap below 0.5).
function mergeClusters(clusters) {
  const reps = clusters.map((g) => {
    const r = pickRep(g);
    return { ent: slug(r.primaryEntity), type: r.eventType || "", tok: titleTokens(r.title) };
  });
  const parent = clusters.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < clusters.length; i++)
    for (let j = i + 1; j < clusters.length; j++) {
      if (!reps[i].ent || reps[i].ent !== reps[j].ent || reps[i].type !== reps[j].type) continue;
      if (jaccard(reps[i].tok, reps[j].tok) >= 0.5) parent[find(j)] = find(i);
    }
  const byRoot = new Map();
  clusters.forEach((g, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(...g);
  });
  return [...byRoot.values()];
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
  // INDEPENDENT owners among the major (tier-1) sources — 3 PMC outlets count as ONE.
  const tier1Owners = new Set(tier1.map((s) => ownerOf(s.outlet)));
  // NORMAL-sensitivity CONFIRMED bar: 2 independent major owners, OR a major + an independently-owned secondary.
  const twoIndependentMajors = tier1Owners.size >= 2 || (tier1.length >= 1 && secondary.some((s) => !tier1Owners.has(ownerOf(s.outlet))));
  // HIGH-sensitivity (death/arrest/legal) bar is STRICTER — owner rule "hold for 2–3 INDEPENDENT MAJORS": a
  // secondary outlet does NOT count toward confirming a death/arrest. Two distinct major OWNERS are required
  // (so 3 PMC trades, or 1 major + a celebrity-secondary, still HOLD as CONFIRMING — never auto-CONFIRMED).
  const twoIndependentMajorOwners = tier1Owners.size >= 2;
  const base = { tier1Count: tier1.length, tier1Owners: tier1Owners.size, outletCount: outlets.length, outlets, maxTier, sensitivity, attribution: null, framing: "plain" };

  // Reference/opinion niches (or TMDB backbone) are normally evergreen+publishable — BUT a fresh
  // HIGH-SENSITIVITY event (death/legal/arrest) framed as a profile/list must STILL pass the hold below.
  if (sources.length === 0 || (EVERGREEN_FORMATS.has(rep.formatTag) && sensitivity !== "high")) {
    return { ...base, status: "EVERGREEN", publishable: true };
  }

  const major = tier1[0]?.outlet;

  // High-sensitivity (death / health crisis / legal / arrest): hold unless 2 INDEPENDENT majors confirm
  // (3 PMC outlets ≠ corroboration — one company's error must not become a "CONFIRMED" death/arrest).
  if (sensitivity === "high") {
    if (twoIndependentMajorOwners) return { ...base, status: "CONFIRMED", framing: "plain", publishable: true };
    return { ...base, status: "CONFIRMING", framing: "hold", publishable: false, hold: "high-sensitivity event needs 2 INDEPENDENT MAJOR outlets (same-owner trades and secondary outlets don't count)" };
  }

  // Normal sensitivity — CONFIRMED needs 2 INDEPENDENT owners (else it's still one source → DEVELOPING).
  if (twoIndependentMajors)
    return { ...base, status: "CONFIRMED", framing: "plain", publishable: true };
  if (tier1.length >= 1) // one or more majors but all the SAME owner = one editorial source → developing
    return { ...base, status: "DEVELOPING", framing: "attributed", attribution: major, publishable: true };
  if (secondary.length >= 2)
    return { ...base, status: "DEVELOPING", framing: "attributed", attribution: "multiple outlets", publishable: true };
  if (secondary.length === 1)
    return { ...base, status: "QUEUE", framing: "hold", publishable: false, hold: "single reputable secondary — await a major outlet to corroborate" };
  if (tabloid.length >= 1)
    return { ...base, status: "RUMOR", framing: "rumor-safe", attribution: tabloid[0].outlet, publishable: true };
  return { ...base, status: "EDITORIAL-HOLD", framing: "hold", publishable: false, hold: "no named reputable source" };
}
