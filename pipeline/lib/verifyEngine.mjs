// DETERMINISTIC GROUND-TRUTH VERIFICATION (PR3) — the judge's independent second line of defence.
//
// The documented root cause of every fabrication: the cheap LLM judge only saw the SAME grounding the
// writer saw, so it could only catch CONTRADICTIONS within that grounding, never a wrong-but-plausible
// value. This engine re-derives ground truth from the STRUCTURED authoritative facts gathered in PR1
// (topic._titleFacts from TMDB, topic._omdb from OMDb) and diffs the article's PROSE + STRUCTURED FIELDS
// against them — independent of the writer's opt-out claims[]. Every disagreement becomes a pre-resolved
// CONTRADICTED hardBlock carrying the CORRECT value, fed to the cheap judge AND into the self-correct loop.
// Pure JS: no LLM call, no extra API call (the data was already fetched during grounding). This is what
// kills the proven fabrications: Atlas="Prime Video" (it's Netflix), RT 90% (it's 92%), OTT box office.

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Streaming platforms we can name-match. Each: canonical label + a matcher for the article prose.
const PLATFORMS = [
  ["Netflix", /\bnetflix\b/i],
  ["Prime Video", /\b(prime video|amazon prime(?: video)?|amazon video)\b/i],
  ["Hulu", /\bhulu\b/i],
  ["Max", /\b(hbo max|\bmax\b)\b/i],
  ["Disney+", /\bdisney\s?\+|\bdisney plus\b/i],
  ["Apple TV+", /\bapple tv\s?\+|\bapple tv plus\b/i],
  ["Peacock", /\bpeacock\b/i],
  ["Paramount+", /\bparamount\s?\+|\bparamount plus\b/i],
  ["Starz", /\bstarz\b/i],
  ["Showtime", /\bshowtime\b/i],
  ["Tubi", /\btubi\b/i],
];

// Phrases that ASSERT a title's streaming home (so we don't flag an incidental mention of a rival service).
// We capture the platform token that follows one of these assertion verbs/forms.
const STREAM_ASSERT = [
  /\b(?:streaming|available|now streaming|watch(?:ing)?|stream it|premiered?|debuted?|landed?|dropped?|arriv\w+|releas\w+|exclusively)\s+(?:on|to|via|on the)\s+([A-Za-z+ ]{2,18})/gi,
  /\ba[n]?\s+([A-Za-z+ ]{2,18})\s+(?:original|exclusive|film|movie|series|show|release)\b/gi,
];

// Collect platforms the ARTICLE asserts as this title's home (de-duped canonical labels).
function assertedPlatforms(text) {
  const found = new Set();
  for (const re of STREAM_ASSERT) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const seg = m[1] || "";
      for (const [label, matcher] of PLATFORMS) if (matcher.test(seg)) found.add(label);
    }
  }
  return [...found];
}

// All reader-visible text of the article (prose + the structured fields that render to readers).
function articleText(article) {
  const parts = [article.title, article.dek, article.body, ...(article.keyTakeaways || [])];
  for (const f of article.faq || []) { parts.push(f?.q, f?.a); }
  for (const e of article.entries || []) { parts.push(e?.title, e?.blurb, e?.whyHere); }
  for (const w of article.whereToWatch || []) { parts.push(w?.title, w?.platform); }
  if (article.verdict) parts.push(article.verdict);
  if (article.boxOffice) parts.push(JSON.stringify(article.boxOffice));
  return parts.filter(Boolean).join("\n");
}

// Pull a percentage stated near a label, both orders ("92% on Rotten Tomatoes" / "Rotten Tomatoes: 92%").
function statedPct(text, labelRe) {
  const after = text.match(new RegExp(`(\\d{1,3})\\s*%[^.\\n]{0,30}?${labelRe.source}`, "i"));
  if (after) return Number(after[1]);
  const before = text.match(new RegExp(`${labelRe.source}[^.\\n]{0,30}?(\\d{1,3})\\s*%`, "i"));
  if (before) return Number(before[1]);
  const metac = text.match(new RegExp(`${labelRe.source}[^.\\n]{0,18}?(\\d{1,3})\\s*/\\s*100`, "i"));
  if (metac) return Number(metac[1]);
  return null;
}

// The engine. Returns findings[]: {layer, severity, claim, correct, why}. severity CONTRADICTED = hard block.
export function verifyGroundTruth(article, topic) {
  const findings = [];
  const tf = topic._titleFacts || null; // TMDB structured (PR1)
  const o = topic._omdb || null;        // OMDb structured (PR1)
  const text = articleText(article);
  const title = tf?.title || topic.primaryEntity || topic.title || "this title";

  // ── Layer 1a — STREAMING PLATFORM (kills the Atlas="Prime Video" fabrication) ──
  if (tf && tf.providers && tf.providers.stream.length) {
    const ok = new Set([...tf.providers.stream, ...tf.providers.rent, ...tf.providers.buy].map(norm));
    for (const p of assertedPlatforms(text)) {
      if (!ok.has(norm(p)) && ![...ok].some((k) => k.includes(norm(p)) || norm(p).includes(k))) {
        findings.push({
          layer: "platform", severity: "CONTRADICTED",
          claim: `article says ${title} streams on ${p}`,
          correct: tf.providers.stream.join(", "),
          why: `TMDB/JustWatch shows ${title} streams on ${tf.providers.stream.join(", ")}, NOT ${p}. State only ${tf.providers.stream.join(", ")}.`,
        });
      }
    }
  }

  // ── Layer 1b — OTT box office + release type (kills invented grosses on streaming-originals) ──
  if (tf && tf.isOTT) {
    const boSays = /(\$\s?\d[\d,.]*\s?(?:million|billion|m|b)?\b[^.\n]{0,40}?(?:box office|gross(?:ed)?|opening weekend|domestic|worldwide|debut))|((?:box office|gross(?:ed)?|opening weekend)[^.\n]{0,40}?\$\s?\d)/i.test(text);
    const theatricalSays = /\b(in theaters|theatrical release|hit theaters|in cinemas|box-?office (?:debut|opening|run|number)|opening weekend)\b/i.test(text);
    if (boSays || theatricalSays) {
      findings.push({
        layer: "ott-boxoffice", severity: "CONTRADICTED",
        claim: `article reports box office / a theatrical run for ${title}`,
        correct: "streaming-original — no box office",
        why: `${title} is a STREAMING-ORIGINAL (TMDB: no theatrical release, on ${(tf.providers.stream[0] || "a streaming service")}). It has NO box office — remove every gross/opening-weekend/theatrical figure and any "in theaters" framing.`,
      });
    }
  }

  // ── Layer 1c — RATINGS (kills the RT 90%-vs-86% / 92% fabrication) ──
  if (o) {
    const rt = statedPct(text, /rotten tomatoes|tomatometer|\brt\b/);
    if (rt != null) {
      if (o.ratings.rt && o.ratings.rt.num != null) {
        if (Math.abs(rt - o.ratings.rt.num) > 2) findings.push({ layer: "rt", severity: "CONTRADICTED", claim: `article states Rotten Tomatoes ${rt}%`, correct: `${o.ratings.rt.value}`, why: `OMDb (authoritative) shows Rotten Tomatoes ${o.ratings.rt.value}, not ${rt}%. Use ${o.ratings.rt.value} or speak qualitatively.` });
      } else {
        findings.push({ layer: "rt", severity: "CONTRADICTED", claim: `article states a Rotten Tomatoes score of ${rt}%`, correct: "no verified RT score", why: `No verified Rotten Tomatoes score exists for ${title} (OMDb returns none — common for TV/new titles). Do NOT state an RT percentage; speak qualitatively.` });
      }
    }
    const mc = statedPct(text, /metacritic|metascore/);
    if (mc != null && o.ratings.metacritic && o.ratings.metacritic.num != null && Math.abs(mc - o.ratings.metacritic.num) > 2) {
      findings.push({ layer: "metacritic", severity: "CONTRADICTED", claim: `article states Metacritic ${mc}`, correct: `${o.ratings.metacritic.value}`, why: `OMDb shows Metacritic ${o.ratings.metacritic.value}, not ${mc}. Use ${o.ratings.metacritic.value}.` });
    }
  }

  // ── Layer 1d — DIRECTOR (conservative: only an explicit "directed by NAME" that clearly mismatches) ──
  if (tf && tf.director) {
    const dirNames = tf.director.split(/,|&|and/).map((s) => norm(s)).filter((s) => s.length > 3);
    const m = [...text.matchAll(/directed by ([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,2})/g)];
    for (const x of m) {
      const claimed = norm(x[1]);
      if (claimed.length > 4 && !dirNames.some((d) => d.includes(claimed) || claimed.includes(d))) {
        findings.push({ layer: "director", severity: "CONTRADICTED", claim: `article says ${title} is "directed by ${x[1]}"`, correct: tf.director, why: `TMDB credits the director of ${title} as ${tf.director}, not ${x[1]}. Correct it.` });
      }
    }
  }

  // ── Layer 2 — AWARDS: every structured winner must be grounded in the facts (Oscars-fabrication guard) ──
  // NOTE: the full authoritative ceremony→winners map (Wikidata P166 / DLu cache) is PR5; here we verify the
  // article's structured winners against whatever awards grounding exists, so an UNGROUNDED winner is caught.
  if (["awards", "music-awards"].includes(topic.formatTag) && Array.isArray(article.awardCategories)) {
    const factsText = norm((topic.facts || []).map((f) => `${f.title} ${f.extract}`).join(" "));
    for (const cat of article.awardCategories) {
      for (const nom of (cat.nominees || []).filter((n) => n && n.isWinner)) {
        const who = norm(nom.name || ""), what = norm(nom.title || "");
        const key = who || what;
        if (!key) continue;
        const grounded = (who && factsText.includes(who)) || (what && factsText.includes(what));
        if (!grounded) {
          findings.push({ layer: "awards", severity: "NO_RECEIPT", claim: `winner "${nom.name || nom.title}" in ${cat.categoryName || "a category"}`, correct: "not found in grounded facts", why: `The structured winner "${nom.name || nom.title}" (${cat.categoryName}) does not appear anywhere in the reference facts — verify it against the official winners list or remove it (never publish an unverified winner).` });
        }
      }
    }
  }

  const contradicted = findings.filter((f) => f.severity === "CONTRADICTED");
  const corrections = findings
    .map((f) => `- [${f.layer}] ${f.claim} — ${f.why}`)
    .join("\n");
  return { findings, contradicted, corrections, ok: findings.length === 0 };
}
