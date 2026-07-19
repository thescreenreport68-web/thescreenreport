// GOSSIP — cross-lane 72h fuzzy dedup (fix #4): the same story must not publish twice, matched on ENTITY +
// EVENT (token overlap), NOT eventSlug string equality. Run: node pipeline/gossip/test/cross-dedup-test.mjs
import { isCrossDup, tokens, normName } from "../crossDedup.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

// Build index entries with the MODULE'S normalizers — never re-implement them. A local copy silently
// drifted from the real tokenizer when stemming was added, which is exactly how a duplicate escapes.
const entry = (slug, entity, text) => ({ slug, entity: normName(entity), evt: tokens(text) });

console.log("\n=== CROSS-DEDUP (fix #4) ===\n");

const index = [
  entry("rosie-quit-talk-show", "Rosie O'Donnell", "Rosie O'Donnell Says She Quit Her Talk Show After Earning $100 Million"),
  entry("taylor-kelce-wedding", "Taylor Swift", "Taylor Swift and Travis Kelce Wed at Madison Square Garden"),
];

// 1) SAME story, reworded headline, different slug → DUP.
check("same story (reworded, diff slug) → flagged as dup",
  !!isCrossDup({ primaryEntity: "Rosie O'Donnell", title: "Rosie O'Donnell Reveals the Real Reason She Quit Her Talk Show" }, index));

// 2) SAME entity, DIFFERENT event → NOT a dup.
check("same entity, different event → NOT a dup",
  !isCrossDup({ primaryEntity: "Rosie O'Donnell", title: "Rosie O'Donnell Moves to Ireland After the Election" }, index));

// 3) DIFFERENT entity, overlapping words → NOT a dup.
check("different entity → NOT a dup",
  !isCrossDup({ primaryEntity: "Whoopi Goldberg", title: "Whoopi Goldberg Quit Her Talk Show After a Contract Dispute" }, index));

// 4) the wedding story reworded → DUP (different slug, same event).
check("wedding reworded → dup",
  !!isCrossDup({ primaryEntity: "Taylor Swift", title: "Taylor Swift, Travis Kelce Marry in a Madison Square Garden Wedding" }, index));

// 5) empty / thin topic → no false dup.
check("thin topic (no entity) → not a dup", !isCrossDup({ primaryEntity: "", title: "hi" }, index));

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Cross-dedup green. ✅\n");
