// FROZEN TRACKER SEO (owner directive 2026-07-24, evidence-led).
//
// WHY THIS EXISTS. Google showed the site 584 times on Jul 14 and 2 times on Jul 21 — a 96% collapse that
// began the day titles churned. Meanwhile the GSC record for 90 days shows this lane earned 23 impressions
// and ZERO clicks, and not one of the 64 retired day-N URLs was ever shown at all. The box-office pages
// that DO earn are evergreen/reference shaped:
//     "barbie box office" (53 imp), "barbie movie total gross", "barbie budget and box office",
//     "avatar all-time worldwide box office gross exact 2026", and even the literal figure "$2,923,710,708".
// Nobody searches "<film> box office day 33". They search for a film's TOTAL, and they search long after
// release. So a tracker's headline is set ONCE in that evergreen shape and then FROZEN FOREVER.
//
// THE HARD CONSTRAINT: the headline must contain NO FIGURE. buildMetaTitle regenerates the metaTitle from
// the canonical figures on every update, so a frozen headline carrying yesterday's number would either go
// stale or be rejected by numberConsistencyGate — which would block every future daily update, forever.
// Number-free is what makes "frozen" and "updates daily" able to coexist.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.bo.mjs";
import { fault, SEV } from "./health.mjs";

export const FROZEN_PATH = path.join(DATA_DIR, "seoFrozen.json");
const MAX_META = 60; // stay inside the site's <=65 clamp with headroom

export function loadFrozen(file = FROZEN_PATH) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { /* silent-ok: absent on first run is the normal cold-start path */ return {}; }
}

export function saveFrozen(map, file = FROZEN_PATH) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map, null, 1));
  } catch (e) {
    fault("seo:frozen-write", `could not persist frozen tracker SEO — a headline may be regenerated: ${e?.message || e}`, { severity: SEV.WARN });
  }
}

// The evergreen headline, longest variant that fits. Mirrors the query shapes that measurably earn on this
// site ("<film> box office", "<film> movie total gross"), and carries no figure so it never goes stale.
export function evergreenHeadline(filmTitle) {
  const f = String(filmTitle || "").trim();
  const cands = [
    `${f} Box Office: Total Gross and Daily Breakdown`,
    `${f} Box Office: Total Gross by Day`,
    `${f} Box Office Total and Daily Gross`,
    `${f} Box Office Total`,
    `${f} Box Office`,
  ];
  return cands.find((c) => c.length <= MAX_META) || cands[cands.length - 1].slice(0, MAX_META);
}

// The standfirst, also evergreen and figure-free: it answers the "how much has X made" intent without
// asserting a number that the next day's update would contradict.
export function evergreenDek(filmTitle) {
  const f = String(filmTitle || "").trim();
  return `How much ${f} has made at the domestic box office, with a day-by-day breakdown of its theatrical run, updated daily.`;
}

// resolveFrozen(slug, filmTitle) -> { metaTitle, dek, created }
// Set ONCE per tracker, then returned verbatim forever. `created` tells the caller a new entry was minted
// so it can persist the ledger. This is the whole freeze mechanism: identity lives in data, not discipline.
export function resolveFrozen(map, slug, filmTitle) {
  const existing = map[slug];
  if (existing?.metaTitle) return { metaTitle: existing.metaTitle, dek: existing.dek, created: false };
  const entry = {
    metaTitle: evergreenHeadline(filmTitle),
    dek: evergreenDek(filmTitle),
    frozenAt: new Date().toISOString(),
    basis: "evergreen-reference (GSC: earning box-office queries are total/reference shaped, never day-N)",
  };
  map[slug] = entry;
  return { metaTitle: entry.metaTitle, dek: entry.dek, created: true };
}
