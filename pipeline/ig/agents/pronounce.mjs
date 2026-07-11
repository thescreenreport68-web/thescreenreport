// AGENT 7 — PRONUNCIATION NORMALIZER (plan §2.2 #7): display text stays exact for
// subtitles; a parallel "speakable" line feeds the voice engine. Deterministic number/
// abbreviation expansion + a persistent lexicon; tiny LLM assist ONLY for unseen hard names.
import { llm } from "../models.mjs";
import { loadLexicon, saveLexicon } from "../lib/ledger.mjs";

// Names the trade press hits constantly — seeded; the lexicon file grows over time.
const SEED = {
  saoirse: "sur-sha", timothee: "timo-tay", timothée: "timo-tay", chalamet: "shala-may",
  zendaya: "zen-day-uh", joaquin: "wah-keen", cillian: "kill-ee-an", denis: "duh-nee",
  villeneuve: "vill-nuv", ralph: "rafe", gyllenhaal: "jill-en-hall", schwarzenegger: "shwart-zen-egger",
  scorsese: "score-sess-ee", dafoe: "duh-foe", buscemi: "boo-sem-ee", theroux: "thuh-roo",
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function expandNumbers(s) {
  let out = String(s);
  // "$12 million" / "$1.2 billion" — the unit word comes AFTER, so this must run FIRST
  // (the bare-$ rule used to fire on the "$12" alone → "twelve dollars million")
  out = out.replace(/\$([\d.,]+)\s+(million|billion|thousand|trillion)\b/gi, (_, n, u) =>
    `${numToWords(parseFloat(n.replace(/,/g, "")))} ${u.toLowerCase()} dollars`);
  // $132.5M / $90M / $1.2B
  out = out.replace(/\$([\d.]+)\s*([MBK])\b/gi, (_, n, u) =>
    `${numToWords(parseFloat(n))} ${u.toUpperCase() === "B" ? "billion" : u.toUpperCase() === "M" ? "million" : "thousand"} dollars`);
  // $250,000 / $90
  out = out.replace(/\$([\d,]+)(?!\S)/g, (_, n) => `${numToWords(parseInt(n.replace(/,/g, ""), 10))} dollars`);
  // percents
  out = out.replace(/([\d.]+)%/g, (_, n) => `${numToWords(parseFloat(n))} percent`);
  // date like 2026 / Aug 5 stays fine for TTS; expand ordinals like "July 5" untouched.
  // plain large numbers with commas
  out = out.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_, n) => numToWords(parseInt(n.replace(/,/g, ""), 10)));
  return out;
}

export function numToWords(n) {
  if (Number.isNaN(n)) return String(n);
  if (!Number.isInteger(n)) {
    const [i, d] = String(n).split(".");
    return `${numToWords(parseInt(i, 10))} point ${d.split("").map((x) => numToWords(parseInt(x, 10))).join(" ")}`;
  }
  if (n < 0) return `minus ${numToWords(-n)}`;
  const ones = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? `-${ones[n % 10]}` : "");
  if (n < 1000) return `${ones[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numToWords(n % 100)}` : ""}`;
  if (n < 1e6) return `${numToWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numToWords(n % 1000)}` : ""}`;
  if (n < 1e9) return `${numToWords(Math.floor(n / 1e6))} million${n % 1e6 ? ` ${numToWords(n % 1e6)}` : ""}`;
  return `${numToWords(Math.floor(n / 1e9))} billion${n % 1e9 ? ` ${numToWords(n % 1e9)}` : ""}`;
}

// Trigger ONLY on genuinely hard names: accented chars, 4+ consonant clusters, or
// classic French/Irish/Polish patterns. Easy names (Sandler, Pitt) must NOT trigger —
// a wrong LLM respell is worse than trusting the TTS. (E2E bug fix 2026-07-10.)
const HARD_NAME_RE = /[éèëïöüñáàâîôûå]|[bcdfghjklmnpqrstvwxz]{4,}|eau|oux|aoi|oigh|abh|obh|dh[aeiou]|czy|rz[aeiou]|szcz/i;

function plausibleRespell(name, respell) {
  if (!respell || !/^[a-z][a-z -]{1,30}$/.test(respell)) return false;
  if (respell[0] !== name[0].toLowerCase()) return false; // same first letter
  const ratio = respell.replace(/[- ]/g, "").length / name.length;
  return ratio >= 0.6 && ratio <= 1.8; // no dropped/added halves
}

export async function pronounce(sentences, entities = []) {
  const lex = { ...SEED, ...loadLexicon() };
  let learned = false;
  // LLM assist only for entity names that look hard AND aren't in the lexicon yet
  for (const e of entities) {
    for (const part of String(e.name).split(/\s+/)) {
      const key = part.toLowerCase().replace(/[^a-zé-]/g, "");
      if (!key || key.length < 4 || lex[key] || !HARD_NAME_RE.test(part)) continue;
      try {
        const res = await llm({
          role: "classify",
          system: 'Give an American-English phonetic respelling for speaking this name aloud. STRICT JSON {"respell":string} — hyphen-separated syllables, lowercase. If the name is already spoken exactly as written, return it unchanged.',
          user: part, temp: 0, maxTokens: 40, json: true,
        });
        if (plausibleRespell(part, res.respell)) { lex[key] = res.respell; learned = true; }
      } catch { /* best-effort — TTS will do its best */ }
    }
  }
  if (learned) saveLexicon(lex);

  // apply respellings ONLY to tokens that are part of THIS story's entity names —
  // a global 'ralph'→'rafe' would mispronounce every other Ralph (review finding)
  const entityTokens = new Set(
    entities.flatMap((e) => String(e.name).toLowerCase().split(/\s+/).map((t) => t.replace(/[^a-zé-]/g, ""))),
  );
  const speakable = sentences.map((s) => {
    let sp = expandNumbers(s);
    for (const [k, v] of Object.entries(lex)) {
      if (v === k || !entityTokens.has(k)) continue;
      sp = sp.replace(new RegExp(`\\b${k}\\b`, "gi"), v);
    }
    return sp.replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim();
  });
  return { speakable, lexiconUsed: Object.keys(lex).length };
}
