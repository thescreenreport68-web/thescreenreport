// WEEKLY PLAIN-NUMBERS REPORT (owner directive 2026-07-24). Read-only Google Search Console pull, scoped
// to THIS LANE's pages. Answers three questions in plain numbers, with no interpretation dressed as fact:
//   1. Is the site being shown at all? (the recovery signal — everything else is moot until this moves)
//   2. Are the trackers indexed and earning? (position 8-30 with impressions = the format is working)
//   3. Which tracked films have real search demand? (drives coverage priority, once data exists)
//
// Run: node pipeline/boxoffice/weeklyReport.mjs        (reads ../gsc-key.json or $GSC_KEY_JSON)
// ONE cached call per tick when used from the pipeline; standalone it makes its own small set of calls.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./config.bo.mjs";

const SITE = "sc-domain:thescreenreport.com";
const HISTORY = path.join(DATA_DIR, "gscHistory.json");

function loadKey() {
  if (process.env.GSC_KEY_JSON) return JSON.parse(process.env.GSC_KEY_JSON);
  for (const p of [path.resolve(process.cwd(), "../gsc-key.json"), path.resolve(process.cwd(), "gsc-key.json")]) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  throw new Error("no GSC key (set GSC_KEY_JSON or place gsc-key.json beside the repo)");
}

async function accessToken(key) {
  const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", typ: "JWT" });
  const claim = b64({ iss: key.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now });
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("GSC auth failed: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

const ymd = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

async function gsc(tok, body) {
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.rows || [];
}

export async function weeklyReport({ log = console.log } = {}) {
  const tok = await accessToken(loadKey());

  // 1. Recovery signal — daily impressions, last 21 days
  const daily = await gsc(tok, { startDate: ymd(21), endDate: ymd(1), dimensions: ["date"], rowLimit: 50 });
  const week = (from, to) => daily.filter((r) => r.keys[0] >= ymd(from) && r.keys[0] <= ymd(to)).reduce((a, r) => a + r.impressions, 0);
  const thisWk = week(7, 1), lastWk = week(14, 8);

  log("\n=== 1. IS GOOGLE SHOWING THE SITE AT ALL? ===");
  daily.slice(-10).forEach((r) => log(`   ${r.keys[0]}   shown ${String(r.impressions).padStart(5)}   clicks ${r.clicks}`));
  log(`   this week: ${thisWk}   last week: ${lastWk}   ${thisWk > lastWk ? "RISING" : thisWk < lastWk ? "still falling" : "flat"}`);

  // 2. This lane's pages
  const pages = await gsc(tok, { startDate: ymd(28), endDate: ymd(1), dimensions: ["page"], rowLimit: 1000 });
  const mine = pages.filter((r) => /box-office|tracker/i.test(r.keys[0]));
  const trackers = mine.filter((r) => /-box-office-tracker\/?$/.test(r.keys[0]));

  log("\n=== 2. ARE THE TRACKERS EARNING? ===");
  if (!trackers.length) log("   no tracker has been shown yet (they are new — Google has to index them first)");
  trackers.forEach((r) => log(`   shown ${String(r.impressions).padStart(4)}  clicks ${r.clicks}  rank ${r.position.toFixed(1)}   ${r.keys[0].replace(/.*\/movies\//, "")}`));
  const working = trackers.filter((r) => r.position >= 8 && r.position <= 30 && r.impressions > 0);
  log(`   trackers in the "format is working" band (rank 8-30 with impressions): ${working.length} of ${trackers.length}`);

  log("\n   -- all box-office pages (incl. older features) --");
  mine.forEach((r) => log(`   shown ${String(r.impressions).padStart(4)}  clicks ${r.clicks}  rank ${r.position.toFixed(1)}   ${r.keys[0].replace("https://thescreenreport.com", "")}`));
  log(`   lane total: ${mine.reduce((a, r) => a + r.impressions, 0)} shown, ${mine.reduce((a, r) => a + r.clicks, 0)} clicks`);

  // 3. Demand — which films people actually search for
  const queries = await gsc(tok, { startDate: ymd(28), endDate: ymd(1), dimensions: ["query"], rowLimit: 1000 });
  const money = queries.filter((r) => /box office|gross|how much|opening weekend/i.test(r.keys[0]));
  log("\n=== 3. WHAT DO PEOPLE ACTUALLY SEARCH (money intent)? ===");
  money.sort((a, b) => b.impressions - a.impressions).slice(0, 15)
    .forEach((r) => log(`   shown ${String(r.impressions).padStart(4)}  rank ${r.position.toFixed(1)}   "${r.keys[0]}"`));
  if (!money.length) log("   (no money-intent searches reached the site this period)");

  // persist a weekly snapshot so trend is measurable next week
  let hist = {};
  try { hist = JSON.parse(fs.readFileSync(HISTORY, "utf8")); } catch { /* silent-ok: first run */ }
  hist[ymd(1)] = {
    siteImpressionsThisWeek: thisWk, siteImpressionsLastWeek: lastWk,
    laneImpressions: mine.reduce((a, r) => a + r.impressions, 0),
    laneClicks: mine.reduce((a, r) => a + r.clicks, 0),
    trackersShown: trackers.length, trackersWorkingBand: working.length,
  };
  try { fs.mkdirSync(path.dirname(HISTORY), { recursive: true }); fs.writeFileSync(HISTORY, JSON.stringify(hist, null, 1)); } catch { /* silent-ok: snapshot is best-effort */ }
  return hist[ymd(1)];
}

if (import.meta.url === `file://${process.argv[1]}`) await weeklyReport();
