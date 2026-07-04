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

import { canonCategory } from "./awardsCache.mjs";

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
  /\b(?:streaming|streams?|stream it|available|now streaming|watch(?:ing)?|premiere[sd]?|debut(?:s|ed|ing)?|land(?:s|ed|ing)?|drop(?:s|ped|ping)?|arriv\w+|releas\w+|air(?:s|ed|ing)?|exclusively)\s+(?:on|to|via|on the)\s+([A-Za-z+ ]{2,18})/gi,
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

// Negation / skip cues that make a box-office or theatrical mention CORRECT for a streaming-original
// ("skipped a theatrical release", "no box office", "went straight to Netflix", "bypassed cinemas").
const NEG = /\b(no|not|n['’]?t|never|without|skip\w*|bypass\w*|forgo\w*|foregoing|instead of|rather than|straight to|direct(?:ly)? to|didn['’]?t|wasn['’]?t|isn['’]?t|won['’]?t|avoid\w*|eschew\w*|sidestep\w*|in lieu of|no theatrical|no box)\b/i;

// True only if `re` matches the text in a context with NO nearby negation/skip cue — i.e. the article
// POSITIVELY asserts the thing (a real gross / an actual theatrical run), not its absence.
function positiveAssertion(text, re, win = 40) {
  const rx = new RegExp(re.source, "gi");
  let m;
  while ((m = rx.exec(text))) {
    const ctx = text.slice(Math.max(0, m.index - win), m.index + m[0].length + win);
    if (!NEG.test(ctx)) return true;
  }
  return false;
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
  // A NEGATED/skip mention is CORRECT framing for a streaming-original ("skipped a theatrical release",
  // "no box office", "went straight to Netflix") — only flag a POSITIVE assertion of a gross / theatrical run.
  if (tf && tf.isOTT) {
    const boRe = /(\$\s?\d[\d,.]*\s?(?:million|billion|m|b)?\b[^.\n]{0,40}?(?:box office|gross(?:ed)?|opening weekend))|((?:box office|gross(?:ed)?|opening weekend)[^.\n]{0,40}?\$\s?\d)/i;
    const theatRe = /\b(in theaters|theatrical release|hit theaters|in cinemas|box-?office (?:debut|opening|run|number|gross|haul))\b/i;
    if (positiveAssertion(text, boRe) || positiveAssertion(text, theatRe)) {
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

  // ── Layer 1e — STREAMING VIEWERSHIP (PR4): there is NO free, reliable public source for OTT viewership
  // magnitudes (Netflix Tudum is the only first-party one and it is not reliably machine-fetchable; non-Netflix
  // OTT publishes none). So any SPECIFIC viewership figure ("X million views / hours viewed / households /
  // viewers") that is not in the grounded facts is invented — flag it. Platform + rank ("on Netflix", "#1 on
  // Netflix this week") are fine (TMDB-grounded); only the magnitude NUMBER is prohibited when ungrounded.
  {
    const streamingCtx = topic.category === "streaming" || topic.formatTag === "watchguide" || (tf && tf.isOTT) ||
      /\b(netflix|prime video|hulu|hbo max|\bmax\b|disney\s?\+|apple tv\s?\+|peacock|paramount\s?\+)\b/i.test(text);
    if (streamingCtx) {
      const factsLoose = norm((topic.facts || []).map((f) => f.extract).join(" "));
      const VIEW = /(\d[\d,.]*)\s*(million|billion)\s*(hours?(?:\s*(?:viewed|of viewing))?|views|households|viewers|people)/gi;
      const WATCHED = /watched by\s*(?:over\s*)?(\d[\d,.]*)\s*(million|billion)/gi;
      for (const re of [VIEW, WATCHED]) {
        re.lastIndex = 0; let m;
        while ((m = re.exec(text))) {
          const numTok = norm(m[1]);
          if (numTok && !factsLoose.includes(numTok)) {
            findings.push({ layer: "viewership", severity: "CONTRADICTED", claim: `article states "${m[0].trim()}"`, correct: "no verified viewership figure", why: `No verified streaming-viewership figure exists for this title (Netflix Tudum is the only first-party source and non-Netflix OTT publishes none). Do NOT state a specific viewership number ("${m[0].trim()}") — report platform/rank only, or attribute it explicitly to a named outlet.` });
            break;
          }
        }
        if (findings.some((f) => f.layer === "viewership")) break;
      }
    }
  }

  // ── Layer 1d — DIRECTOR, CROSS-SOURCED (TMDB + OMDb, PR8 independent credits cross-check) ──
  // Only flag an explicit "directed by NAME" that mismatches BOTH independent sources, so a single-source
  // error never false-blocks; when TMDB and OMDb AGREE, a mismatch is a high-confidence CONTRADICTED.
  if (tf && tf.director) {
    const dirNames = [tf.director, o?.director].filter(Boolean).join(", ").split(/,|&|\band\b/).map((s) => norm(s)).filter((s) => s.length > 3);
    const agree = o?.director && norm(o.director).includes(norm(tf.director.split(/,|&|and/)[0]));
    const m = [...text.matchAll(/directed by ([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,2})/g)];
    for (const x of m) {
      const claimed = norm(x[1]);
      if (claimed.length > 4 && !dirNames.some((d) => d.includes(claimed) || claimed.includes(d))) {
        findings.push({ layer: "director", severity: "CONTRADICTED", claim: `article says ${title} is "directed by ${x[1]}"`, correct: tf.director, why: `The director of ${title} is ${tf.director}${agree ? " (TMDB + OMDb agree)" : o?.director ? ` (TMDB) / ${o.director} (OMDb)` : " (TMDB)"}, not ${x[1]}. Correct it.` });
      }
    }
  }

  // ── Layer 1f — CAST / ROLE, vs TMDB credits (2026-07-03 audit #8: the deterministic backstop for the wrong-
  // credit class — "X plays Y" when TMDB shows X plays Z). HIGH-PRECISION so it can never cut a TRUE sentence:
  // it flags ONLY when TMDB bills the SAME actor (surname-exact) to a character with ZERO token overlap with the
  // claimed role. An actor TMDB doesn't list (incomplete/animated casts) is never flagged. Complements the LLM
  // web-check with a $0 structured check the model can't "sample past."
  if (tf && Array.isArray(tf.cast) && tf.cast.length) {
    const surname = (n) => norm(n).split(" ").filter(Boolean).pop() || "";
    const overlap = (a, b) => a && b && (a.includes(b) || b.includes(a) || a.split(" ").some((w) => w.length > 3 && b.split(" ").includes(w)));
    const byActor = tf.cast.filter((c) => c && c.name && c.character).map((c) => ({ name: c.name, sur: surname(c.name), char: norm(c.character) }));
    const rx = /\b([A-Z][a-zA-Z.'’-]+(?:\s+[A-Z][a-zA-Z.'’-]+){1,2})\s+(?:plays|portrays|voices|stars as|appears as|will play|is playing)\s+([A-Z][a-zA-Z.'’-]+(?:\s+[A-Z][a-zA-Z.'’-]+){0,2})/g;
    const seen = new Set();
    for (const x of text.matchAll(rx)) {
      const actorSur = surname(x[1]); const claimedChar = norm(x[2]);
      if (actorSur.length <= 3 || claimedChar.length <= 2) continue;
      const hit = byActor.find((c) => c.sur === actorSur);
      const key = `${actorSur}|${claimedChar}`;
      if (hit && !seen.has(key) && !overlap(claimedChar, hit.char)) {
        seen.add(key);
        findings.push({ layer: "cast", severity: "CONTRADICTED", claim: `article says ${x[1]} plays ${x[2]}`, correct: `${hit.name} plays ${hit.char}`, why: `Per TMDB credits, ${hit.name} plays "${hit.char}" in ${title}, not "${x[2]}". Correct the role.` });
      }
    }
  }

  // ── Layer 2 — AWARDS (PR5): hard CATEGORY-LEVEL winner diff vs the authoritative map (topic._awards from
  // the official Academy Awards DB / first-party Golden Globes/Emmys), falling back to a grounding-presence
  // check for categories the authoritative source doesn't cover. This is what catches the 97th-Oscars
  // Wicked/Brutalist swap: the article's structured winner is diffed against the OFFICIAL winner per category.
  if (["awards", "music-awards"].includes(topic.formatTag) && Array.isArray(article.awardCategories)) {
    const factsText = norm((topic.facts || []).map((f) => `${f.title} ${f.extract}`).join(" "));
    // Index the authoritative winners by canonical category key for like-for-like comparison.
    const authByKey = new Map();
    for (const c of topic._awards?.categories || []) { const k = canonCategory(c.categoryName); if (k && c.winner) authByKey.set(k, { cat: c.categoryName, name: c.winner.name, title: c.winner.title }); }
    const overlap = (a, b) => a && b && (a.includes(b) || b.includes(a));
    for (const cat of article.awardCategories) {
      const artKey = canonCategory(cat.categoryName);
      for (const nom of (cat.nominees || []).filter((n) => n && n.isWinner)) {
        const who = norm(nom.name || ""), what = norm(nom.title || "");
        if (!who && !what) continue;
        // (a) DETERMINISTIC DIFF against the official winner for this exact category — the hard guard.
        if (artKey && authByKey.has(artKey)) {
          const aw = authByKey.get(artKey), awWho = norm(aw.name), awWhat = norm(aw.title);
          const matches = overlap(who, awWho) || overlap(what, awWhat) || overlap(who, awWhat) || overlap(what, awWho);
          if (!matches) {
            findings.push({ layer: "awards", severity: "CONTRADICTED", claim: `article names "${nom.name || nom.title}" winner of ${cat.categoryName}`, correct: `${aw.name || aw.title}`, why: `Per ${topic._awards.source}, the winner of ${aw.cat} is ${aw.name || aw.title}${aw.name && aw.title ? ` (${aw.title})` : ""}, NOT ${nom.name || nom.title}. Correct it.` });
          }
          continue; // category was authoritatively checked — done
        }
        // (b) Fallback: no authoritative category match → require the winner to at least appear in the facts.
        const grounded = (who && factsText.includes(who)) || (what && factsText.includes(what));
        if (!grounded) findings.push({ layer: "awards", severity: "NO_RECEIPT", claim: `winner "${nom.name || nom.title}" in ${cat.categoryName || "a category"}`, correct: "not found in grounded facts", why: `The structured winner "${nom.name || nom.title}" (${cat.categoryName}) does not appear anywhere in the reference facts — verify it against the official winners list or remove it (never publish an unverified winner).` });
      }
    }
  }

  // ── Layer 3 — MUSIC CHART (Billboard Hot 100 diff, PR6/music chart-diff) ── compares a stated Hot 100
  // position against the grounded Billboard entry (topic._music.billboard); flags a fabricated one, and flags
  // ANY Hot 100 number when the artist has no current entry (historical peaks aren't in the free grounding).
  const mus = topic._music || null;
  if (mus && ["music-profile", "music-news", "music-awards", "screen-music"].includes(topic.formatTag)) {
    const stated =
      (text.match(/(?:number\s*|#|no\.?\s*)(\d{1,3})[^.\n]{0,30}?(?:billboard\s*)?(?:hot\s*100|hot100|the chart)/i) ||
       text.match(/(?:billboard\s*hot\s*100|hot\s*100|billboard chart)[^.\n]{0,30}?(?:number\s*|#|no\.?\s*)(\d{1,3})/i) ||
       text.match(/(?:peaked|debuted|reached)[^.\n]{0,25}?(?:number\s*|#|no\.?\s*)(\d{1,3})[^.\n]{0,20}?(?:billboard\s*)?(?:hot\s*100|chart)/i) || [])[1];
    if (stated != null) {
      const n = Number(stated), bb = mus.billboard;
      if (!bb) {
        findings.push({ layer: "music-chart", severity: "CONTRADICTED", claim: `article states a Hot 100 position (#${n})`, correct: "no current Hot 100 entry", why: `No current Billboard Hot 100 entry exists for ${mus.name}, and historical chart peaks are not in the grounded facts. Do NOT state a Hot 100 position — speak qualitatively about chart success.` });
      } else if (n !== bb.thisWeek && n !== bb.peak) {
        findings.push({ layer: "music-chart", severity: "CONTRADICTED", claim: `article states Hot 100 #${n}`, correct: `#${bb.thisWeek} (peak #${bb.peak})`, why: `Billboard shows "${bb.song}" at #${bb.thisWeek} (peak #${bb.peak}, ${bb.date}) on the Hot 100, not #${n}. Use the correct figure or speak qualitatively.` });
      }
    }
  }

  const contradicted = findings.filter((f) => f.severity === "CONTRADICTED");
  const corrections = findings
    .map((f) => `- [${f.layer}] ${f.claim} — ${f.why}`)
    .join("\n");
  return { findings, contradicted, corrections, ok: findings.length === 0 };
}
