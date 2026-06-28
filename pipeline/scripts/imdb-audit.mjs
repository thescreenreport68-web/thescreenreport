// PR8 — IMDb non-commercial dataset cross-check for DIRECTOR credits. DEV/AUDIT ONLY, never a runtime path.
// Runtime credit verification is already done live in lib/verifyEngine.mjs (it cross-checks the article's
// director against BOTH TMDB and OMDb). This script is the deeper OFFLINE audit against IMDb's own data, for
// a periodic spot-check that our TMDB-sourced credits match IMDb. It streams the gzip TSVs line-by-line (two
// passes, memory-bounded — never loads the whole file). ⚠ ~1GB download; run LOCALLY; NEVER republish IMDb
// data (non-commercial ToS — this output is for internal QA only).
//   Run: node site/pipeline/scripts/imdb-audit.mjs tt15239678 tt1745960 …
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dir, "../data/imdb"); // gitignored — large, non-republishable
const BASE = "https://datasets.imdbws.com/";
const FILES = { crew: "title.crew.tsv.gz", names: "name.basics.tsv.gz" };

async function ensure(file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return p;
  fs.mkdirSync(CACHE, { recursive: true });
  console.log(`downloading ${file} (large; first run only) …`);
  const r = await fetch(BASE + file, { headers: { "User-Agent": "TheScreenReport/1.0 (editor@thescreenreport.com)" } });
  if (!r.ok) throw new Error(`download failed: ${file} HTTP ${r.status}`);
  await fs.promises.writeFile(p, Buffer.from(await r.arrayBuffer()));
  return p;
}

async function* lines(gzPath) {
  const rl = readline.createInterface({ input: fs.createReadStream(gzPath).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

// Map of {tconst → [director primaryName]} for the requested titles only (memory-bounded).
export async function imdbDirectors(tconsts) {
  const want = new Set(tconsts);
  const dirN = new Map(), needNames = new Set();
  for await (const line of lines(await ensure(FILES.crew))) {
    const tab = line.indexOf("\t");
    const tconst = line.slice(0, tab);
    if (!want.has(tconst)) continue;
    const directors = line.split("\t")[1] || "";
    const ns = directors.split(",").filter((x) => x.startsWith("nm"));
    dirN.set(tconst, ns); ns.forEach((n) => needNames.add(n));
  }
  const nm = new Map();
  for await (const line of lines(await ensure(FILES.names))) {
    const tab = line.indexOf("\t");
    const nconst = line.slice(0, tab);
    if (needNames.has(nconst)) nm.set(nconst, line.split("\t")[1] || nconst);
  }
  const out = {};
  for (const t of tconsts) out[t] = (dirN.get(t) || []).map((n) => nm.get(n) || n);
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("imdb-audit.mjs")) {
  const ids = process.argv.slice(2).filter((a) => /^tt\d+$/.test(a));
  if (!ids.length) { console.log("usage: node site/pipeline/scripts/imdb-audit.mjs tt15239678 [tt…]\n(cross-check the printed IMDb director against the pipeline's TMDB credit for that title)"); process.exit(0); }
  const res = await imdbDirectors(ids);
  for (const [t, dirs] of Object.entries(res)) console.log(`${t}: IMDb director(s) = ${dirs.join(", ") || "(none)"}`);
}
