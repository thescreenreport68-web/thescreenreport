// Small shared helpers — dependency-free (house style).
import fs from "node:fs";
import path from "node:path";

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// Robust JSON extraction from LLM text (handles fences, leading prose).
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.search(/[{[]/);
    if (start === -1) continue;
    for (let end = c.length; end > start; end--) {
      const slice = c.slice(start, end).trim();
      if (!slice.endsWith("}") && !slice.endsWith("]")) continue;
      try {
        return JSON.parse(slice);
      } catch {}
    }
  }
  return null;
}

export async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function retry(fn, { tries = 2, delayMs = 1500, label = "op" } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw new Error(`${label} failed after ${tries} tries: ${lastErr?.message || lastErr}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

// Normalize text to comparable word tokens (verbatim wall, entity matching).
export function normWords(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'$% ]+/g, " ")
    .split(/\s+/)
    // strip WRAPPING quote apostrophes so a quoted title matches its own tokens:
    // "'knocked" → "knocked", "up'" → "up". Internal apostrophes stay, so contractions
    // ("didn't") and possessives are untouched. Titles are ALWAYS quoted in scripts, so without
    // this a movie/TV title never matched its sentence → its poster was sourced but never placed
    // and every gap fell back to the primary person's face. (root fix, owner 2026-07-12)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

// NUMBER/CURRENCY tokens — the ONE place the spoken audio and its transcript legitimately
// diverge: the pronounce stage expands "$1 billion" → "one billion dollars" while whisper writes
// "1 billion" / "$1B". Numbers are checked by their own literal wall, so the VERBATIM comparison
// (ad-lib/length/drift) must ignore them or a number-heavy box-office script shows a huge false
// drift and every take gets rejected → Kokoro → hold. (owner 2026-07-12)
const NUM_TOKEN = /^(\$?\d[\d,.]*%?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|dollar|dollars|cent|cents|percent|first|second|third)$/;
export function contentWords(s) {
  return normWords(s).filter((w) => !NUM_TOKEN.test(w));
}

// Token-level edit ops between two word arrays (small inputs — O(n*m) fine).
export function tokenDiff(a, b) {
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[n][m];
}

// Minimal frontmatter parser (no deps): returns { data, body }.
// Supports YAML folded/literal scalars (>- > | |-) — gossip-lane articles use them for
// image URLs and deks (`image: >-` + indented URL line).
export function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: md };
  const data = {};
  let currentKey = null;
  let folding = false;
  for (const line of m[1].split(/\r?\n/)) {
    if (folding) {
      // indented lines are ALWAYS continuations (keys are never indented here) —
      // and a URL's "https:" must not be mistaken for a new key
      const cont = line.match(/^\s{2,}(.*\S)\s*$/);
      if (cont) {
        data[currentKey] = ((data[currentKey] || "") + " " + cont[1]).trim();
        continue;
      }
      folding = false;
    }
    const arr = line.match(/^\s*-\s+(.*)$/);
    if (arr && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(stripQuotes(arr[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const v = kv[2].trim();
      if (/^[>|][+-]?$/.test(v)) { data[currentKey] = ""; folding = true; continue; }
      if (v === "") { data[currentKey] = data[currentKey] ?? null; continue; }
      if (v === "[]") { data[currentKey] = []; continue; }
      if (/^\[.*\]$/.test(v)) {
        data[currentKey] = v.slice(1, -1).split(",").map((x) => stripQuotes(x.trim())).filter(Boolean);
        continue;
      }
      data[currentKey] = stripQuotes(v);
    }
  }
  return { data, body: m[2] || "" };
}
function stripQuotes(s) {
  return String(s).replace(/^["']|["']$/g, "");
}

export function stripMarkdown(s) {
  return String(s || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function todayInTz(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// ── OUTLET BLOCKLIST (owner audit 2026-07-16): a news outlet's name must NEVER ship in public copy —
// not as an attribution ("Described by E! News as…"), not as an entity, not as a hashtag (#ENews,
// #WallStreetJournal, #TIME shipped publicly). One shared list, applied at entity extraction
// (gather), source-strip (caption + platformMeta), and hashtag gates (normTags/repairCaption).
export const OUTLET_NAMES = [
  "E! News", "E News", "TMZ", "People", "People Magazine", "Variety", "Deadline", "The Hollywood Reporter",
  "Hollywood Reporter", "THR", "Wall Street Journal", "WSJ", "TIME", "Time Magazine", "Page Six",
  "Us Weekly", "Entertainment Tonight", "Entertainment Weekly", "Daily Mail", "The Sun", "The Mirror",
  "New York Times", "NYT", "New York Post", "Rolling Stone", "Billboard", "Vulture", "IndieWire",
  "Collider", "ScreenRant", "Screen Rant", "Newsweek", "BBC", "CNN", "Fox News", "Reuters",
  "Associated Press", "Bloomberg", "Forbes", "Business Insider", "Insider", "BuzzFeed", "Complex",
  "Pitchfork", "TVLine", "Just Jared", "Hollywood Life", "In Touch", "Life & Style", "RadarOnline",
  "The Blast", "People TV", "Extra", "Access Hollywood", "The Wrap", "TheWrap", "Puck", "Semafor",
  "The Atlantic", "The Guardian", "USA Today", "Los Angeles Times", "LA Times",
];
// matches an outlet name as a whole word/phrase, case-insensitive ("TIME" only as standalone word)
export const OUTLET_RE = new RegExp(
  `\\b(?:${OUTLET_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|")})\\b`,
  "i",
);
// hashtag form: outlet names collapsed to tag tokens (#ENews, #WallStreetJournal, #TIME, #TMZ …)
const OUTLET_TAG_TOKENS = new Set(OUTLET_NAMES.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, "")));
export function isOutletTag(tag) {
  return OUTLET_TAG_TOKENS.has(String(tag).replace(/^#/, "").toLowerCase().replace(/[^a-z0-9]/g, ""));
}
// strip attribution CLAUSES that smuggle an outlet into public copy. Covers the shipped failures:
// "Described by E! News as …", "told People", "People reports/reported/wrote", "speaking to TMZ".
// Only fires when a REAL outlet name is present — never mangles normal prose.
export function stripOutletAttribution(s) {
  const text = String(s || "");
  if (!OUTLET_RE.test(text)) return text;
  const O = OUTLET_RE.source.replace(/^\\b|\\b$/g, ""); // inner alternation, re-wrapped per rule below
  return text
    // "described by <outlet> as X" → "described as X"; same for called/named/dubbed
    .replace(new RegExp(`\\b(described|called|named|dubbed)\\s+by\\s+\\b(?:${O})\\b\\s+as\\b`, "gi"), "$1 as")
    // "told <outlet>" → "said"; "tells <outlet>" → "says"
    .replace(new RegExp(`\\btold\\s+\\b(?:${O})\\b`, "gi"), "said")
    .replace(new RegExp(`\\btells?\\s+\\b(?:${O})\\b`, "gi"), "says")
    // "speaking to/with <outlet>," / "in an interview with <outlet>" → drop the clause
    .replace(new RegExp(`[\\s,;:—-]*\\b(?:while\\s+)?(?:speaking|spoke|talking|talked)\\s+(?:to|with)\\s+\\b(?:${O})\\b[,]?`, "gi"), "")
    .replace(new RegExp(`[\\s,;:—-]*\\bin\\s+an?\\s+(?:interview|statement|chat)\\s+(?:to|with)\\s+\\b(?:${O})\\b[,]?`, "gi"), "")
    // "<outlet> reports/reported/wrote/says/said/confirmed/revealed (that)" → drop the frame
    .replace(new RegExp(`\\b(?:${O})\\b\\s+(?:reports?|reported|wrote|writes|says?|said|confirmed|confirms|revealed|reveals)\\s*(?:that\\s+)?`, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.?!,;:])/g, "$1")
    .trim()
    .replace(/^([a-z])/, (m, c) => c.toUpperCase()); // a dropped leading frame can leave a lowercase start
}

// ── STALE-DATE GUARD (owner audit 2026-07-16): "Kai Cenat Returns July 6th" shipped on 07-15 — a
// story from the fresh-window pool framed a PAST date as upcoming. Detects a month-day reference
// more than `graceHours` in the past combined with future-framing language. Year-less dates assume
// the nearest occurrence (a date >6 months ahead is treated as last year's = past).
const MONTHS = { january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7, september:8, october:9, november:10, december:11, jan:0, feb:1, mar:2, apr:3, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11 };
const DATE_RE = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
const UPCOMING_RE = /\b(returns?|returning|premieres?|premiering|drops?|dropping|arrives?|arriving|comes?\s+(?:out|back)|coming|launches?|launching|debuts?|debuting|hits\s+(?:theaters|screens|netflix|streaming)|opens?|opening|set\s+(?:to|for)|scheduled\s+for|will\s+(?:return|premiere|drop|arrive|launch|debut|open))\b/i;
export function pastDatesReferenced(text, now = new Date(), graceHours = 48) {
  const out = [];
  for (const m of String(text || "").matchAll(DATE_RE)) {
    const mon = MONTHS[m[1].toLowerCase().replace(".", "")];
    const day = parseInt(m[2], 10);
    if (mon === undefined || !(day >= 1 && day <= 31)) continue;
    let d = new Date(Date.UTC(now.getUTCFullYear(), mon, day, 12));
    if (d.getTime() - now.getTime() > 183 * 864e5) d = new Date(Date.UTC(now.getUTCFullYear() - 1, mon, day, 12)); // "Dec 28" said in Jan = last month, not next winter
    if (now.getTime() - d.getTime() > graceHours * 3600e3) out.push({ text: m[0], date: d });
  }
  return out;
}
export function pastDateAsUpcoming(text, now = new Date(), graceHours = 48) {
  const t = String(text || "");
  if (!UPCOMING_RE.test(t)) return null;
  const past = pastDatesReferenced(t, now, graceHours);
  return past.length ? past[0] : null;
}
