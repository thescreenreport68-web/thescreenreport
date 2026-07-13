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
