// Wikidata structured facts (free, keyless) — the authoritative, machine-readable layer that the prose
// Wikipedia extract can't give us (its filmography/award TABLES are HTML, stripped by explaintext). Uses
// the QID already captured by wikiSummary(). Serves BOTH grounding (inject real facts so the writer
// never invents) AND Layer-B verification (check the writer's award/date/figure claims). This is what
// makes "Oscar-winning vs nominated" impossible to fake.
const API = "https://www.wikidata.org/w/api.php";
const UA = "The Screen Report/1.0 (https://thescreenreport.com; editor@thescreenreport.com)";

async function wd(params) {
  try {
    const u = `${API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
    const r = await fetch(u, { headers: { "User-Agent": UA, accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const idOf = (snak) => snak?.datavalue?.value?.id || null; // a referenced QID
const timeYear = (q, prop) => {
  const t = (q?.[prop]?.[0]?.datavalue?.value?.time) || null; // e.g. "+2023-01-01T00:00:00Z"
  return t ? (t.match(/\d{4}/) || [])[0] : null;
};
const amount = (snak) => snak?.datavalue?.value?.amount?.replace(/^\+/, "") || null;

// Resolve a set of QIDs → {qid: label} via one batched call (≤50 ids).
async function labels(qids) {
  const ids = [...new Set(qids.filter(Boolean))].slice(0, 50);
  if (!ids.length) return {};
  const j = await wd({ action: "wbgetentities", ids: ids.join("|"), props: "labels", languages: "en" });
  const out = {};
  for (const [q, e] of Object.entries(j?.entities || {})) out[q] = e?.labels?.en?.value || q;
  return out;
}

// Fetch the structured facts we care about for an entity (person OR work).
export async function wikidataFacts(qid) {
  if (!qid) return null;
  const j = await wd({ action: "wbgetclaims", entity: qid });
  const c = j?.claims;
  if (!c) return null;

  const P166 = c.P166 || []; // award received (WON)
  const P1411 = c.P1411 || []; // nominated for (NOMINATION)
  const wins = P166.map((cl) => ({ award: idOf(cl.mainsnak), year: timeYear(cl.qualifiers, "P585"), work: idOf((cl.qualifiers?.P1686 || [])[0]) }));
  const noms = P1411.map((cl) => ({ award: idOf(cl.mainsnak), year: timeYear(cl.qualifiers, "P585"), work: idOf((cl.qualifiers?.P1686 || [])[0]) }));
  const boxOffice = amount((c.P2142 || [])[0]?.mainsnak);
  const budget = amount((c.P2130 || [])[0]?.mainsnak);
  const releaseDate = (c.P577 || [])[0]?.mainsnak?.datavalue?.value?.time?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || timeYear(c, "P577");
  const born = (c.P569 || [])[0]?.mainsnak?.datavalue?.value?.time?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;
  const died = (c.P570 || [])[0]?.mainsnak?.datavalue?.value?.time?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;

  // resolve award + work labels
  const lbl = await labels([...wins.map((w) => w.award), ...wins.map((w) => w.work), ...noms.map((n) => n.award), ...noms.map((n) => n.work)]);
  const fmt = (x) => ({ award: lbl[x.award] || null, year: x.year, work: lbl[x.work] || null }).award ? `${lbl[x.award]}${x.year ? ` (${x.year})` : ""}${x.work && lbl[x.work] ? ` — for ${lbl[x.work]}` : ""}` : null;

  return {
    qid,
    wins: wins.map(fmt).filter(Boolean),
    nominations: noms.map(fmt).filter(Boolean),
    boxOffice: boxOffice ? `$${Number(boxOffice).toLocaleString("en-US")}` : null,
    budget: budget ? `$${Number(budget).toLocaleString("en-US")}` : null,
    releaseDate,
    born,
    died,
  };
}

// A grounding block the writer is told to use VERBATIM (and the verifier checks claims against).
export function wikidataFactBlock(f) {
  if (!f) return "";
  const lines = [];
  if (f.wins.length) lines.push(`AWARDS WON (these are confirmed WINS — state plainly): ${f.wins.join("; ")}`);
  if (f.nominations.length) lines.push(`AWARD NOMINATIONS (these were NOMINATED, NOT won — never call these "winning"): ${f.nominations.slice(0, 20).join("; ")}`);
  if (f.boxOffice) lines.push(`Box office (Wikidata): ${f.boxOffice}`);
  if (f.budget) lines.push(`Budget (Wikidata): ${f.budget}`);
  if (f.releaseDate) lines.push(`Release/publication date (Wikidata): ${f.releaseDate}`);
  if (f.born) lines.push(`Born: ${f.born}`);
  if (f.died) lines.push(`Died: ${f.died}`);
  return lines.join("\n");
}
