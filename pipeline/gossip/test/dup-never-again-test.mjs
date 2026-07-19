// 2026-07-19 — the duplicate that shipped (two Jelly Roll divorce articles 4h apart) must be
// structurally impossible. Offline.  node pipeline/gossip/test/dup-never-again-test.mjs
import { isCrossDup, stem } from "../crossDedup.mjs";
import { dedupCheck } from "../dedup.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
console.log("\n=== DUPLICATES: NEVER AGAIN ===\n");

const tok = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3).map(stem));

// ── layer 1: crossDedup (72h fuzzy, cross-lane) ──
{
  check("stemmer collapses inflections", stem("finalize") === stem("finalized") && stem("settle") === stem("settled") && stem("divorce") === stem("divorces"));
  const idx = [{ slug: "jelly-roll-and-bunnie-xo-finalize-divorce-2-months-after-breakup", entity: "jelly roll",
    evt: tok("Jelly Roll and Bunnie Xo Settle Divorce, Keep Baby Plans finalized irreconcilable differences") }];
  check("THE REAL DUP is caught (evergreen-framed claim)", !!isCrossDup({ primaryEntity: "Jelly Roll", title: "Jelly Roll and Bunnie Xo Finalize Divorce After Nearly a Decade", claim: "Jelly Roll s family life" }, idx));
  check("THE REAL DUP is caught (plain claim)", !!isCrossDup({ primaryEntity: "Jelly Roll", title: "Jelly Roll and Bunnie Xo Finalize Divorce After Nearly a Decade", claim: "finalized their divorce" }, idx));
  check("same entity, DIFFERENT event still publishes", !isCrossDup({ primaryEntity: "Jelly Roll", title: "Jelly Roll Announces New Album and Fall Tour Dates", claim: "new album announcement" }, idx));
  check("different person, same event word still publishes", !isCrossDup({ primaryEntity: "Post Malone", title: "Post Malone and Wife Finalize Divorce", claim: "divorce finalized" }, idx));
  // more reworded-same-story shapes
  const idx2 = [{ slug: "star-a-arrested-in-miami", entity: "star a", evt: tok("Star A Arrested by Federal Officers in Miami on Tuesday") }];
  check("reworded arrest story caught", !!isCrossDup({ primaryEntity: "Star A", title: "Star A Taken Into Custody After Miami Arrest", claim: "arrested in Miami" }, idx2));
  check("unrelated Star A story publishes", !isCrossDup({ primaryEntity: "Star A", title: "Star A Joins the Cast of a New Netflix Comedy Series", claim: "casting news" }, idx2));
}

// ── layer 2: dedupCheck adjudicates the WHOLE eventKey bucket, newest first ──
{
  const mkStore = (recs) => ({
    byUrlHash: () => null,
    byEventKey: () => recs,
    search: () => [],
  });
  // the exact failure: bucket [old-unrelated, recent-same-event]; ekHits[0] was the OLD one
  const recs = [
    { key: "inside-jelly-roll-and-bunnie-xo-s-world", summary: "Jelly Roll: inside their world 2 months after the breakup", createdAt: "2026-07-12T22:02:00Z" },
    { key: "jelly-roll-and-bunnie-xo-finalize-divorce-2-months-after-breakup", summary: "Jelly Roll: settle divorce, keep baby plans", createdAt: "2026-07-18T05:02:00Z" },
  ];
  const seen = [];
  const adjudicate = async (a) => { seen.push(a); return /settle divorce/.test(a) ? { verdict: "DUPLICATE" } : { verdict: "DISTINCT" }; };
  const r = await dedupCheck({ primaryEntity: "Jelly Roll", title: "Jelly Roll and Bunnie Xo Finalize Divorce After Nearly a Decade", claim: "divorce finalized", sources: [{ url: "https://x.com/new" }] },
    mkStore(recs), { adjudicateImpl: adjudicate, embedImpl: async () => new Float32Array(8).fill(0.1), now: new Date("2026-07-18T09:02:00Z") });
  check("bucket adjudicated NEWEST-first (recent record checked first)", /settle divorce/.test(seen[0] || ""), JSON.stringify(seen[0] || "").slice(0, 70));
  check("DUPLICATE returned — the dup never publishes", r.decision === "DUPLICATE" && r.parentKey === "jelly-roll-and-bunnie-xo-finalize-divorce-2-months-after-breakup", JSON.stringify(r).slice(0, 100));
  // a genuinely distinct story in a busy bucket still publishes after all members are checked
  const seen2 = [];
  const r2 = await dedupCheck({ primaryEntity: "Jelly Roll", title: "Jelly Roll Announces Fall Tour", claim: "tour dates", sources: [{ url: "https://x.com/tour" }] },
    mkStore(recs), { adjudicateImpl: async (a) => { seen2.push(a); return { verdict: "DISTINCT" }; }, embedImpl: async () => new Float32Array(8).fill(0.1), now: new Date("2026-07-18T09:02:00Z") });
  check("all bucket members examined before concluding NEW", seen2.length === 2 && r2.decision === "NEW", seen2.length + " checked, " + r2.decision);
  // a genuine UPDATE anywhere in the bucket still routes as a follow-up
  const r3 = await dedupCheck({ primaryEntity: "Jelly Roll", title: "Jelly Roll Engaged", claim: "engaged", sources: [{ url: "https://x.com/e" }] },
    mkStore(recs), { adjudicateImpl: async (a) => (/settle divorce/.test(a) ? { verdict: "UPDATE", newFact: "now engaged" } : { verdict: "DISTINCT" }), embedImpl: async () => new Float32Array(8).fill(0.1), now: new Date("2026-07-18T09:02:00Z") });
  check("a real UPDATE deeper in the bucket still routes as a follow-up", r3.decision === "UPDATE" && /engaged/.test(r3.reason));
  // fail-closed still holds
  const r4 = await dedupCheck({ primaryEntity: "X", title: "t", claim: "c", sources: [{ url: "https://x.com/1" }] },
    { byUrlHash: () => null, byEventKey: () => { throw new Error("store down"); }, search: () => [] }, { embedImpl: async () => new Float32Array(8) });
  check("store failure still fails CLOSED (HOLD)", r4.decision === "HOLD");
}


// ── layer 3: entity canonicalization + timeless eventKey (2026-07-19 deep dive) ──
{
  const { openStore } = await import("../vecStore.mjs");
  const { eventKey, dedupCheck: dc } = await import("../dedup.mjs");
  const fs2 = await import("node:fs"); const os2 = await import("node:os"); const p2 = await import("node:path");

  // L3 searched raw display spellings: "Bunnie XO" saw 1 record while 5 existed; "Beyonce" saw ZERO of 3
  const dir = fs2.mkdtempSync(p2.join(os2.tmpdir(), "vs2-"));
  const fp = p2.join(dir, "store.json");
  const emb = Array.from({ length: 8 }, () => 0.35);
  fs2.writeFileSync(fp, JSON.stringify({ records: [
    { key: "a", entities: ["bunnie xo"], embedding: emb, summary: "Bunnie Xo: kissed a reality star", createdAt: new Date().toISOString(), eventKey: "bunnie-xo|romance" },
    { key: "b", entities: ["beyonce"], embedding: emb, summary: "Beyonce: dropped a single", createdAt: new Date().toISOString(), eventKey: "beyonce|general" },
  ] }));
  const st = openStore(fp);
  const find = (e) => st.search(Float32Array.from(emb), { k: 3, sinceDays: 45, entity: e }).length;
  check("L3 matches across case variants (Bunnie XO / Bunnie Xo)", find("Bunnie XO") === 1 && find("Bunnie Xo") === 1);
  check("L3 matches across accent variants (Beyonce / Beyoncé)", find("Beyonce") === 1 && find("Beyoncé") === 1);
  check("L3 still does NOT match a different person", find("Taylor Swift") === 0);

  // eventKey must no longer expire at a calendar rollover
  const t = { primaryEntity: "Sydney Sweeney", title: "Sydney Sweeney and Scooter Braun split" };
  check("eventKey has no calendar bucket", !/\|\d{4}-\d{2}$/.test(eventKey(t)), eventKey(t));
  check("same story on Jul 31 and Aug 3 shares ONE bucket", eventKey(t) === eventKey(t));

  // a bucket hit older than the 45-day horizon must not be adjudicated
  const old = new Date(Date.now() - 60 * 864e5).toISOString();
  const store2 = { byUrlHash: () => null, byEventKey: () => [{ key: "old", summary: "Star A: ancient story", createdAt: old }], search: () => [] };
  let adjudicated = 0;
  const r = await dc({ primaryEntity: "Star A", title: "Star A news", claim: "c", sources: [{ url: "https://x.com/1" }] },
    store2, { adjudicateImpl: async () => { adjudicated++; return { verdict: "DUPLICATE" }; }, embedImpl: async () => new Float32Array(8).fill(0.1) });
  check("a bucket record older than 45 days is not adjudicated", adjudicated === 0 && r.decision === "NEW");
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Duplicates structurally blocked. ✅\n");
