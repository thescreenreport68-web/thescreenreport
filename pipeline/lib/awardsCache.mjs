// AUTHORITATIVE AWARDS WINNERS — NON-Wikipedia, NON-Wikidata (PR5, owner rule 2026-06-28: no Wikimedia).
//
// The old awards grounding scraped Wikipedia's "Winners and nominees" section (run.mjs ~149) — the prose was
// truncated + the winners TABLE was stripped, which is the documented root of the 97th-Oscars fabrication
// (Problem #9). This replaces it with first-party / official-derived structured data, live-verified 2026-06-28:
//   • OSCARS  → a committed snapshot of DLu/oscar_data (data/oscars.tsv) — scraped from the OFFICIAL Academy
//               Awards Database (NOT Wikipedia), BSD-2, IMDb-id-keyed, refreshed by scripts/refresh-oscars.mjs.
//   • GOLDEN GLOBES → goldenglobes.com first-party wp-json awdb JSON API (per-event read + name-attribution).
//   • EMMYS  → televisionacademy.com first-party JSON-LD ItemList (best-effort; per-event).
// Award RESULTS are uncopyrightable facts (Feist), so per-event reads + name-attribution are defensible; we do
// NOT bulk-mirror the ToU-restricted first-party sites. Anything we can't source first-party (BAFTA/Critics
// Choice/Grammys) falls back to the attributed trade-RSS already in the topic — never to Wikipedia.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OSCAR_TSV = path.join(__dir, "../data/oscars.tsv");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const clean = (s) => (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "");
const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// Reduce any category label (DLu "ACTRESS IN A LEADING ROLE" or an article's "Best Actress") to a canonical
// key, so the verifier compares like-for-like. Returns null for categories we don't map (then we don't diff).
export function canonCategory(label) {
  const t = norm(label);
  if (!t) return null;
  if (/\bpicture\b|best film|best motion picture|outstanding (drama|comedy) series|best (drama|comedy|television) series/.test(t)) {
    if (/drama/.test(t)) return "picture-drama";
    if (/comedy|musical/.test(t)) return "picture-comedy";
    return "picture";
  }
  if (/direct(ing|or)/.test(t)) return "director";
  const supp = /support/.test(t);
  if (/actress|female actor|female performance|actor.*female/.test(t)) return supp ? "supporting actress" : "lead actress";
  if (/actor|male performance/.test(t)) return supp ? "supporting actor" : "lead actor";
  if (/adapted screenplay|writing.*adapted/.test(t)) return "adapted screenplay";
  if (/original screenplay|writing.*original|best screenplay/.test(t)) return "original screenplay";
  if (/animated feature/.test(t)) return "animated feature";
  if (/international feature|foreign language/.test(t)) return "international feature";
  if (/documentary feature/.test(t)) return "documentary feature";
  if (/cinematograph/.test(t)) return "cinematography";
  if (/film editing|best editing/.test(t)) return "editing";
  if (/original score|best score/.test(t)) return "score";
  if (/original song|best song/.test(t)) return "song";
  if (/costume/.test(t)) return "costume";
  if (/production design/.test(t)) return "production design";
  if (/visual effects/.test(t)) return "visual effects";
  return null;
}

// ── OSCARS: committed TSV cache (the own authoritative store) ──
let _rows = null;
function oscarRows() {
  if (_rows) return _rows;
  try {
    const lines = fs.readFileSync(OSCAR_TSV, "utf8").split(/\r?\n/).filter(Boolean);
    const h = lines[0].split("\t");
    const ix = (n) => h.indexOf(n);
    const iC = ix("Ceremony"), iY = ix("Year"), iCanon = ix("CanonicalCategory"), iCat = ix("Category"), iFilm = ix("Film"), iFilmId = ix("FilmId"), iName = ix("Name"), iWin = ix("Winner");
    _rows = lines.slice(1).map((l) => {
      const c = l.split("\t");
      return { ceremony: Number(c[iC]), year: c[iY], category: clean(c[iCanon] || c[iCat]), film: clean(c[iFilm]), filmId: clean(c[iFilmId]), name: clean(c[iName]), winner: norm(c[iWin]) === "true" };
    }).filter((r) => r.ceremony);
  } catch { _rows = []; }
  return _rows;
}

// Authoritative Oscars winners+nominees for a ceremony ORDINAL (97) or the ceremony YEAR (2025 → 97th).
export function oscarAwards(ceremonyOrYear) {
  const rows = oscarRows();
  if (!rows.length) return null;
  const n = Number(ceremonyOrYear);
  if (!n) return null;
  let sel;
  if (n <= 110) sel = rows.filter((r) => r.ceremony === n);            // an ordinal (97th)
  else sel = rows.filter((r) => Number(r.year) === n - 1 || Number(r.year) === n); // a ceremony YEAR → film year is usually year-1
  if (!sel.length) return null;
  const ceremony = sel[0].ceremony;
  const byCat = new Map();
  for (const r of sel) {
    if (!byCat.has(r.category)) byCat.set(r.category, { categoryName: r.category, winner: null, nominees: [] });
    const g = byCat.get(r.category);
    const e = { name: r.name || null, title: r.film || null };
    g.nominees.push(e);
    if (r.winner) g.winner = e;
  }
  return { show: `the ${ord(ceremony)} Academy Awards`, source: "the official Academy Awards Database", categories: [...byCat.values()].filter((c) => c.winner) };
}

// ── GOLDEN GLOBES: first-party wp-json awdb JSON API ──
export async function goldenGlobesAwards(year) {
  try {
    const r = await fetch(`https://www.goldenglobes.com/wp-json/awdb/v1/winners-and-nominees?year=${year}`, { headers: { "User-Agent": UA, accept: "application/json" } });
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return null;
    const categories = [];
    for (const a of data) {
      const cat = { categoryName: clean(a.award), winner: null, nominees: [] };
      for (const nom of a.nominations || []) {
        const item = (nom.nominees || [])[0] || {};
        const isPerson = item.type === "person";
        // person award: nominees[0].title = the PERSON, nom.show (an object) = the film; film award: item.title = the film.
        const work = nom.show && typeof nom.show === "object" ? clean(nom.show.title) : "";
        const e = isPerson ? { name: clean(item.title), title: work || null } : { name: null, title: clean(item.title) };
        cat.nominees.push(e);
        if (nom.winner) cat.winner = e;
      }
      if (cat.winner) categories.push(cat);
    }
    return categories.length ? { show: `the ${year} Golden Globe Awards`, source: "the Golden Globes", categories } : null;
  } catch { return null; }
}

// ── EMMYS: first-party JSON-LD ItemList (best-effort; raw HTML, browser UA — WebFetch strips JSON-LD) ──
export async function emmysAwards(year) {
  try {
    const r = await fetch(`https://www.televisionacademy.com/awards/nominees-winners/${year}`, { headers: { "User-Agent": UA, accept: "text/html" } });
    if (!r.ok) return null;
    const html = await r.text();
    const categories = [];
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      let j; try { j = JSON.parse(m[1]); } catch { continue; }
      const list = j?.itemListElement;
      if (!Array.isArray(list)) continue;
      const cat = { categoryName: clean(j.name || ""), winner: null, nominees: [] };
      for (const el of list) {
        const it = el.item || el;
        const award = norm(it.award || "");
        const e = { name: clean(it.name || it.actor || ""), title: clean(it.name || "") };
        cat.nominees.push(e);
        if (/winner/.test(award)) cat.winner = e;
      }
      if (cat.winner && cat.categoryName) categories.push(cat);
    }
    return categories.length ? { show: `the ${year} Primetime Emmy Awards`, source: "the Television Academy", categories } : null;
  } catch { return null; }
}

// ── Router: detect the ceremony from the topic and return the authoritative map (or null → trade-RSS fallback) ──
export async function getAuthoritativeAwards(topic) {
  const hay = norm(`${topic.primaryEntity || ""} ${topic.title || ""} ${topic.primaryKeyword || ""}`);
  const ordinal = (hay.match(/\b(\d{1,3})(st|nd|rd|th)\b/) || [])[1];
  const year = (hay.match(/\b(20\d{2})\b/) || [])[1];
  if (/academy award|oscars?/.test(hay)) return oscarAwards(Number(ordinal) || Number(year));
  if (/golden globe/.test(hay) && year) return goldenGlobesAwards(year);
  if (/emmy/.test(hay) && year) return emmysAwards(year);
  return null;
}

// Grounding block the writer must use verbatim (and the verifier diffs structured winners against).
export function awardsFactBlock(map) {
  if (!map || !map.categories?.length) return "";
  const L = [`${map.show} — AUTHORITATIVE WINNERS (${map.source}, verified — these are the ONLY correct winners; cite them exactly with attribution and NEVER state a different winner; if a category is not listed here, do not assert its winner):`];
  for (const c of map.categories) {
    const w = c.winner; if (!w) continue;
    const who = w.name ? `${w.name}${w.title ? ` — ${w.title}` : ""}` : w.title;
    L.push(`${c.categoryName}: ${who}`);
  }
  return L.join("\n");
}
