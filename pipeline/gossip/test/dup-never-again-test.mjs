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

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Duplicates structurally blocked. ✅\n");
