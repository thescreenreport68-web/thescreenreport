// GOSSIP — CLASSIFY & FRAME ENGINE (Phase 1, Stage 4). The brain that "analyzes each claim and decides how
// it must be written" so the writer is structurally unable to produce an indefensible article.
//
// Input  : a gossip topic { title, claim, primaryEntity, sources:[{outlet,tier?}], confirmed?, official?, denied? }
// Output : a FRAME that drives the writer + the legal gate + the UI:
//   { decision: "PUBLISH"|"HOLD", severity, tier, framing, uiLabel, attribution,
//     needsDisclaimer, disclaimerText, monitor, writerDirective, reason }
//
// Owner policy encoded here:
//   • EXTREME (sexual assault / minors) with no established outlet → HOLD (wait for a major to report it).
//   • Anything not hard-confirmed → PUBLISH NOW but needsDisclaimer=true (in-text "this is unconfirmed") +
//     monitor=true (post-publish recheck). We never WAIT to publish; the disclaimer carries the safety.
//   • CONFIRMED / OFFICIAL_RECORD → publish plainly (cite the record), no disclaimer needed.

import { severity, confidenceTier, TIER_META, hasEstablished, topOutlet } from "./policy.mjs";

// The exact in-text non-confirmation sentence the writer MUST include (owner: "mention in the article itself
// that the story is unconfirmed — not confirmed by the authorities / the person / the studio").
function disclaimerFor(tier, entity, attribution) {
  const who = entity || "those involved";
  if (tier === "DENIED")
    return `${who} and their representatives have denied this, and The Screen Report has not independently verified it — it remains unconfirmed.`;
  if (tier === "REPORTED_BY_MAJOR")
    return `${attribution} reported this; it has not been officially confirmed by ${who} or their representatives, and The Screen Report has not independently verified it.`;
  // single-source rumor / social speculation
  return `This has not been confirmed by ${who}, their representatives, or any official source — it is unverified and currently circulating as speculation.`;
}

// A short directive injected into the writer prompt for THIS article (Stage 5 reads frame.writerDirective).
function directiveFor({ tier, severity: sev, attribution, entity, needsDisclaimer, disclaimerText }) {
  const lines = [];
  const meta = TIER_META[tier];
  if (meta.framing === "plain") lines.push(`This is CONFIRMED — you may state it plainly, but still cite where it was confirmed.`);
  else if (meta.framing === "official") lines.push(`This comes from OFFICIAL RECORDS — report only what the record says and attribute it ("according to court documents / police"). Do not editorialize guilt.`);
  else if (meta.framing === "attributed") lines.push(`Attribute the core claim to ${attribution} in your own words ("According to ${attribution}, …"). Do NOT present it as independently confirmed fact.`);
  else if (meta.framing === "rumor-safe") lines.push(`Frame this as the PUBLIC CONVERSATION / SPECULATION, not a fact ("fans are speculating…", "rumors are circulating that…"). Never assert it as true.`);
  else if (meta.framing === "denial-forward") lines.push(`Lead with the DENIAL. Make clear ${entity || "the subject"} (or their rep) has denied this.`);
  lines.push(`Every damaging statement about a person MUST be attributed or framed as opinion/speculation — never asserted as your own fact.`);
  if (needsDisclaimer) lines.push(`MANDATORY: include this exact non-confirmation note in the body (its own sentence): "${disclaimerText}"`);
  if (sev !== "NORMAL") lines.push(`This is a SENSITIVE (${sev}) topic — be especially careful: report, attribute, do not amplify, and never state a conclusion the sources don't support.`);
  return lines.join(" ");
}

export function frameTopic(topic, bundle = null, editorial = null) {
  const text = `${topic.title || ""} ${topic.claim || ""}`;
  const sev = severity(text);
  // Tier off the FULL corroborated picture — the discovery source PLUS every outlet the content-finder found
  // covering this story — not just the one thin discovery blurb. (Fixes: a Pop-Crave-discovered story that AP/CBS/
  // Variety all reported was tiering as "social speculation" because the frame only saw Pop Crave.)
  const sources = [
    ...(topic.sources || []),
    ...((bundle?.sources || []).filter((s) => s.corroborating)),
    ...(bundle?.corroboratingOutlets || []),
  ];
  const tier = confidenceTier(topic, sources);
  const meta = TIER_META[tier];
  // Attribution: the outlet the editorial gate found ACTUALLY reports the claim (content-grounded) wins over
  // "the highest-tier outlet whose headline names the entity" (which credited aggregators like Yahoo / a
  // corroborating People.com that we never actually read).
  const attribution = editorial?.attribution || topOutlet(sources);
  const entity = topic.primaryEntity || null;

  // EXTREME gate (owner rule 2): sexual-assault / minor claims are NOT run on raw speculation. They publish
  // ONLY once a well-known established outlet (tier ≥ 6) — or an official record / on-record confirmation —
  // carries it; then we re-report it in our own attributed words. Otherwise HOLD.
  const extremeOk = tier === "CONFIRMED" || tier === "OFFICIAL_RECORD" || tier === "REPORTED_BY_MAJOR" || hasEstablished(sources);
  if (sev === "EXTREME" && !extremeOk) {
    return {
      decision: "HOLD",
      severity: sev,
      tier,
      framing: meta.framing,
      uiLabel: meta.label,
      attribution,
      needsDisclaimer: false,
      disclaimerText: "",
      monitor: false,
      writerDirective: "",
      reason: "EXTREME class (sexual assault / minor) with no well-known established outlet — hold until a major outlet reports it, then re-report attributed.",
    };
  }

  // needsDisclaimer: anything not HARD-confirmed needs the in-text "unconfirmed" note. A major outlet carrying
  // a SENSITIVE (HIGH/EXTREME) claim still needs it (it's not officially confirmed); a major carrying a NORMAL
  // dating item is fine on attribution alone.
  const needsDisclaimer =
    !meta.hardConfirmed && !(tier === "REPORTED_BY_MAJOR" && sev === "NORMAL");

  const disclaimerText = needsDisclaimer ? disclaimerFor(tier, entity, attribution) : "";
  const uiLabel = tier === "REPORTED_BY_MAJOR" && attribution ? `${meta.label} ${attribution}` : meta.label;

  const frame = {
    decision: "PUBLISH",
    severity: sev,
    tier,
    framing: meta.framing,
    uiLabel,
    attribution,
    needsDisclaimer,
    disclaimerText,
    // Post-publish monitor for everything not hard-confirmed (and for sensitive confirmed-by-one-major items).
    monitor: needsDisclaimer || sev !== "NORMAL",
    reason: "",
  };
  frame.writerDirective = directiveFor({ tier, severity: sev, attribution, entity, needsDisclaimer, disclaimerText });
  return frame;
}
