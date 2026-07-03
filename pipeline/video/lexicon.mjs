// PRONUNCIATION ENGINE v2 (owner-approved plan 2026-07-03; verified findings in
// /Users/sivajithcu/Movie News site/PRONUNCIATION_RESEARCH.json — read it before changing rules).
// TWO SEPARATE TRACKS: normalizeForSpeech() = the SAY track (voice only); sanitizeForDisplay() = the
// SHOW track (captions only). The voice text NEVER touches the screen.
// Verified engine facts driving these rules: phonemizer re-inserts periods as PAUSE tokens ("$3.2M"
// -> "dollar three ⏸ two em"; "Dr." -> "doctor ⏸"; dotted acronyms pause) — so every rule below
// removes digit/abbrev periods; caps do NOT force spell-out (MCU->"m'koo") — acronyms are FORCED via
// hyphenated letters ("M-C-U" spells cleanly, zero pause); intra-word hyphens never pause (left alone);
// en-dash is silently DROPPED by the engine (must become " to " between digits); em-dash = pause (ok).

// ── verified PHONEME entries (espeak-IPA, en-us; generated with the engine's own tokenizer then
// hand-fixed; kokoro_tts.py splices these via is_phonemes=True — the broadcast-grade lane).
// VALIDATION RULE: every char must exist in kokoro_onnx/config.json's 114-symbol vocab (unknown chars
// are SILENTLY dropped by the engine). Add entries by running: k.tokenizer.phonemize(word,'en-us') → fix.
export const PHONEME_LEX = {
  "Saoirse": "sˈɜːʃə",
  "KVIFF": "kˌeɪvˌiːˌaɪˌɛfˈɛf",
  "MCU": "ˌɛmsˌiːjˈuː",
};

// ── respelling lexicon (text-level; runs before phonemization; SAY track only)
export const LEXICON = {
  "Doctor Who": "Doctor Hoo",
  "Timothée Chalamet": "Timo-tay Shala-may",
  "Chalamet": "Shala-may",
  "Timothée": "Timo-tay",
  "Zendaya": "Zen-day-uh",
  "Joaquin Phoenix": "Wah-keen Phoenix",
  "Joaquin": "Wah-keen",
  "Denis Villeneuve": "Duh-nee Vil-nuhv",
  "Villeneuve": "Vil-nuhv",
  "Cillian Murphy": "Kill-ee-an Murphy",
  "Cillian": "Kill-ee-an",
  "Scorsese": "Score-sess-ee",
  "Gyllenhaal": "Jillen-hall",
  "McConaughey": "Muh-kon-uh-hay",
  "Schwarzenegger": "Shwarts-en-egger",
  "Ratajkowski": "Rata-cow-ski",
  "Nyong'o": "N'yong-oh",
  "Chiwetel Ejiofor": "Choo-i-tell Edge-ee-oh-for",
  "Domhnall Gleeson": "Doh-nal Gleeson",
  "Sinéad": "Shin-aid",
  "Niamh": "Neev",
  "Barry Keoghan": "Barry Kee-oh-gan",
  "Keoghan": "Kee-oh-gan",
  "Mescal": "Mess-cal",
  "Pugh": "Pew",
  "Ana de Armas": "Anna day Arm-as",
  "Lupita": "Loo-pee-ta",
  "Charlbi": "Sharl-bee",
};

// ── brand punctuation / stylized names (exact match, SAY track; research PASS 1.2)
const BRANDS = {
  "E! News": "E News", "E!": "E", "Yahoo!": "Yahoo", "Jeopardy!": "Jeopardy", "Wham!": "Wham",
  "Panic! at the Disco": "Panic at the Disco", "P!nk": "Pink", "Ke$ha": "Kesha", "A$AP": "Ay sap",
  "*NSYNC": "In Sync", "will.i.am": "will I am", "Disney+": "Disney Plus", "Apple TV+": "Apple TV Plus",
  "Paramount+": "Paramount Plus", "AT&T": "Ay Tee and Tee", "Se7en": "Seven", "M3GAN": "Megan",
  "Thir13en Ghosts": "Thirteen Ghosts", "F1": "F one", "Deadpool & Wolverine": "Deadpool and Wolverine",
  "U.S.": "US", "U.K.": "UK", "L.A.": "LA", "N.Y.": "NY", "D.C.": "DC",
};

// ── acronym policy (research: caps ≠ spell-out — the engine GUESSES; we force explicitly).
// SPELL list → hyphenated letters (clean spell, zero pauses). WORD list → leave as-is (engine reads
// them correctly as words). Anything not listed: 2-3 letter all-caps default to SPELL; 4+ left alone.
const ACRONYM_SPELL = ["HBO", "CBS", "NBC", "ABC", "CNN", "TMZ", "CW", "AMC", "FX", "BBC", "ITV", "MTV", "SNL", "DC", "EGOT", "CGI", "VFX", "MCU", "DCU", "NFL", "NBA", "UFC", "WWE", "CEO", "PGA", "DGA", "WGA"];
const ACRONYM_WORD = ["NASA", "IMAX", "BAFTA", "SAG", "TIFF", "AFI", "PIXAR", "A24", "OSCARS"];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// number → words (US style, hyphenated tens, no "and") for the cases the engine fumbles
const ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
function numWords(n) {
  n = Math.floor(Math.abs(n));
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + numWords(n % 100) : "");
  if (n < 1e6) return numWords(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? " " + numWords(n % 1000) : "");
  return String(n);
}
const decimalWords = (s) => {
  const [i, d] = String(s).replace(/,/g, "").split(".");
  return numWords(+i) + (d ? " point " + d.split("").map((c) => ONES[+c]).join(" ") : "");
};

// ═══ SAY TRACK ═══ ordered passes — never reorder (research: protect-then-rewrite design)
export function normalizeForSpeech(text) {
  let t = String(text);
  // PASS 0 · sanitize
  t = t.normalize("NFC").replace(/[’‘]/g, "'").replace(/[“”«»„]/g, '"').replace(/\.{3,}|…/g, ", ")
    .replace(/[​-‍﻿]|[\p{Extended_Pictographic}]/gu, "").replace(/[™®©†#*_]/g, "");
  // PASS 1 · brands + respellings (longest key first; exact strings beat all later grammars)
  for (const map of [BRANDS, LEXICON])
    for (const key of Object.keys(map).sort((a, b) => b.length - a.length))
      t = t.replace(new RegExp(`(?<![\\w])${escRe(key)}(?![\\w])`, "g"), map[key]);
  // PASS 2 · acronym policy (before number/dot rules)
  for (const a of ACRONYM_SPELL) t = t.replace(new RegExp(`\\b${a}\\b`, "g"), a.split("").join("-"));
  t = t.replace(/\b([A-Z]{2,3})\b(?![-\w])/g, (m) => (ACRONYM_WORD.includes(m) ? m : m.split("").join("-"))); // default: short caps spell
  // PASS 3 · currency/percent/ordinals/counts (kills the digit-period pause bug)
  t = t.replace(/\$(\d[\d,]*(?:\.\d+)?)\s*(million|billion|trillion|[MBK])\b/gi, (m, n, u) => {
    const unit = { m: "million", b: "billion", k: "thousand", t: "trillion" }[u[0].toLowerCase()] || u.toLowerCase();
    return `${decimalWords(n)} ${unit} dollars`;
  });
  t = t.replace(/\$(\d[\d,]*(?:\.\d+)?)/g, (m, n) => `${decimalWords(n)} dollars`);
  t = t.replace(/(\d+(?:\.\d+)?)\s*%/g, (m, n) => `${decimalWords(n)} percent`);
  t = t.replace(/\bNo\.\s*(\d+)/gi, (m, n) => `number ${numWords(+n)}`);
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*\/\s*10\b/g, (m, n) => `${decimalWords(n)} out of ten`); // ratings
  t = t.replace(/\bS(\d{1,2})E(\d{1,2})\b/gi, (m, s, e) => `season ${numWords(+s)} episode ${numWords(+e)}`);
  t = t.replace(/'(\d0)s\b/g, (m, d) => ({ 20: "twenties", 30: "thirties", 40: "forties", 50: "fifties", 60: "sixties", 70: "seventies", 80: "eighties", 90: "nineties" }[d] || m));
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*(million|billion|trillion)\b/gi, (m, n, u) => `${decimalWords(n)} ${u.toLowerCase()}`); // "3.2 million" decimal-period pause fix
  // PASS 4 · abbreviations (strip the period BEFORE it becomes a pause)
  t = t.replace(/\bDr\.(?=\s)/g, "Doctor").replace(/\bMr\.(?=\s)/g, "Mister").replace(/\bMrs\.(?=\s)/g, "Missus")
    .replace(/\bMs\.(?=\s)/g, "Miss").replace(/\bJr\.?\b/g, "Junior").replace(/\bSr\.?\b/g, "Senior")
    .replace(/\bSt\.(?=\s[A-Z])/g, "Saint").replace(/\bvs\.?(?=\s|$)/gi, "versus").replace(/\bfeat\.\b/gi, "featuring")
    .replace(/\bapprox\.\b/gi, "approximately").replace(/\bet al\.?/gi, "and others");
  // PASS 5 · dashes (verified: en-dash silently dropped by the engine — must be words; em-dash = pause, keep as comma)
  t = t.replace(/(\d)\s*[–-]\s*(\d)/g, "$1 to $2"); // ranges "2024–25", "10-15"
  t = t.replace(/\s+[–—]\s+/g, ", "); // separator dashes → breath
  t = t.replace(/:\s+(?=[A-Z"])/g, ", "); // title colons: "Dune: Part Two" → "Dune, Part Two"
  t = t.replace(/[&+]/g, " and ");
  t = t.replace(/["“”]/g, ""); // quote marks = odd pauses; the words carry the quote
  // PASS 6 · seam tidy
  t = t.replace(/\s+([.,!?;])/g, "$1").replace(/,\s*([.!?])/g, "$1").replace(/,{2,}/g, ",").replace(/\s{2,}/g, " ");
  return t.trim();
}

// ═══ SHOW TRACK ═══ captions only — professional reels style: no terminal punctuation, no markdown
// symbols, digits STAY digits ("$3.2M" reads better on screen than words). Never sees the SAY text.
export function sanitizeForDisplay(text) {
  let t = String(text);
  t = t.normalize("NFC").replace(/[’‘]/g, "'").replace(/[“”«»„"]/g, "").replace(/\.{3,}|…/g, "")
    .replace(/[​-‍﻿]|[\p{Extended_Pictographic}]/gu, "").replace(/[™®©†#*_]/g, "")
    .replace(/\s+[–—]\s+/g, " ").replace(/[();:]/g, " ")
    .replace(/[.,!?]+$/g, "") // no terminal punctuation on screen
    .replace(/([a-z])[.,](\s|$)/gi, "$1$2") // mid-phrase commas/periods off screen too
    .replace(/\s{2,}/g, " ");
  return t.trim();
}

// every SAY line must end with terminal punctuation (the engine's pause + intonation anchor)
export function ensureSentencePunct(line) {
  const t = String(line).trim();
  return /[.!?,]$/.test(t) ? t : t + ".";
}
