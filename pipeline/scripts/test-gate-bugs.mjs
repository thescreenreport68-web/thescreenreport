// DEV-ONLY unit test (no network): prove the step-3 mechanical gate-bug fixes — diacritic fold, short proper-token
// keep, word-boundary keyword matching, and the abbreviation-safe sentence splitter (Flesch).
import { deterministic } from "../stages/gate.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };
const mk = (title, body, kw) => deterministic({ title, body, faq: [], keyTakeaways: [] }, { primaryKeyword: kw, formatTag: "news" });

console.log("=== diacritic fold: 'beyonce' must match 'Beyoncé' (old bug HARD-BLOCKED correct titles) ===");
ok(mk("Beyoncé Announces a New World Tour", "Beyoncé announced a tour today.", "beyonce tour").kwInTitle, "accented title satisfies unaccented keyword");

console.log("=== short proper token kept: 'F1' (old length>3 filter erased it -> any 'movie' title passed) ===");
ok(mk("F1 Movie Races to a Box Office Record", "The F1 movie opened big this weekend.", "f1 movie").kwInTitle, "F1 token present -> kwInTitle TRUE");
ok(!mk("The Best Movie of the Year, Ranked", "A generic list of movies here.", "f1 movie").kwInTitle, "generic 'movie' title WITHOUT F1 -> kwInTitle FALSE (old bug wrongly passed)");

console.log("=== word boundary: 'bear' must not match 'beard' ===");
ok(!mk("A Man Grows a Beard This Winter", "He grew a beard over the winter.", "bear").kwInTitle, "'beard' does NOT satisfy keyword 'bear'");
ok(mk("The Bear Returns for Season 4 Soon", "The Bear is back on FX.", "bear").kwInTitle, "'Bear' as a whole word satisfies 'bear'");

console.log("=== sentence splitter not shredded by abbreviations/decimals (Flesch sane) ===");
const fl = mk("Box Office Report", "Supergirl earned $1.5 million on Friday for Mr. Gunn and the U.S. team this weekend.", "box office").flesch;
ok(fl > 0 && fl < 121, "Flesch is a sane number (" + fl + "), not garbage from over-splitting on '$1.5', 'Mr.', 'U.S.'");

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
