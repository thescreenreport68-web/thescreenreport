// test-pin-copy.mjs — regression tests for the 2026-07-16 pin-copy root fixes (copyfinish.mjs).
// Deterministic only (no LLM, no network). Run: node pipeline/pinterest/test-pin-copy.mjs
import { noMd, factCheck, cleanHashtags, completeSentences, finishPinTitle, frontLoaded, ctaFor, CTA_STYLES } from "./copyfinish.mjs";

let n = 0, failed = 0;
const ok = (cond, name) => { n++; if (!cond) { failed++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); };

// a realistic article fixture (the F9/Venice/Emmys defect classes baked in)
const ART = {
  title: "Margot Robbie, Andy Serkis Join Venice Immersive Lineup at Venice Film Festival 2026",
  dek: "The Venice Immersive sidebar returns with 68 virtual reality and mixed reality projects.",
  whatWeKnow: "F9: The Fast Saga ranked #7 in the Netflix Top 10 with 9.4 million hours viewed.",
  keyTakeaways: ["Xolo Maridueña returns as Blue Beetle", "The Emmys defended the nomination"],
  body: "Margot Robbie and Andy Serkis join the Venice Film Festival 2026 Venice Immersive lineup of 68 projects. F9: The Fast Saga, starring Vin Diesel, ranked #7 in the Netflix Top 10 with 9.4 million hours viewed. Xolo Maridueña returns as Blue Beetle. The Emmys defended the nomination for the Netflix series.",
};

console.log("— 1. noMd: '#' preserved, markdown stripped —");
ok(noMd("ranked #7 in the Top 10") === "ranked #7 in the Top 10", "keeps facts like '#7'");
ok(noMd("#MovieNews #BoxOffice") === "#MovieNews #BoxOffice", "keeps hashtags intact");
ok(noMd("**bold** _it_ `code` ~x~") === "bold it code x", "still strips markdown chars");

console.log("— 2. hashtags as validated data —");
ok(cleanHashtags(["#MovieNews", "#VeniceFilmFestival", "#MargotRobbie", "#TVNews", "#Extra5"], ART).length <= 3, "caps at 3");
ok(cleanHashtags(["MovieNews", "Margot Robbie", "#-bad"], ART).length === 0, "drops malformed (no '#', spaces)");
ok(cleanHashtags(["#MargotRobbie"], ART).join() === "#MargotRobbie", "entity tag that matches the article passes");
ok(cleanHashtags(["#TaylorSwift"], ART).length === 0, "entity tag the article never states is dropped");
ok(cleanHashtags(["#MovieNews"], ART).join() === "#MovieNews", "generic category tag passes");
ok(cleanHashtags(["#movienews", "#MovieNews"], ART).length === 1, "dedupes case-insensitively");

console.log("— 3. fact/entity verification —");
ok(!factCheck(ART, "Venice Film Festival 2024 lineup revealed").ok, "catches wrong year (2024 vs article 2026)");
ok(factCheck(ART, "Venice Film Festival 2026 lineup").ok, "passes the correct year");
ok(!factCheck(ART, "The Emyys defended the nomination").ok, "catches the 'Emyys' typo class");
ok(!factCheck(ART, "ranked #12 on Netflix").ok, "catches an unsupported number");
ok(factCheck(ART, "F9 ranked #7 with 9.4 million hours on Netflix").ok, "passes supported numbers incl. #7 and 9.4");
ok(factCheck(ART, "Xolo Mariduena returns as Blue Beetle").ok, "deburred entity match (Maridueña/Mariduena)");
ok(factCheck(ART, "Margot Robbie joins. Discover more. Tap through for the full story on The Screen Report.").ok, "CTA glue words don't false-positive");
ok(!factCheck(ART, "Margot Robbie stars in Oppenheimer").ok, "catches an off-article entity");
ok(factCheck(ART, "68 projects #VeniceFilmFestival2024").ok, "hashtag block is exempt here (validated separately)");

console.log("— 4a. descriptions end complete, never '…' —");
const longText = "First sentence is here. Second sentence adds detail. Third sentence keeps going with more words than fit.";
const d1 = completeSentences(longText, 60);
ok(d1 === "First sentence is here. Second sentence adds detail.", "trims at sentence boundary");
ok(!/…/.test(completeSentences("A very long sentence without any period that keeps going and going and going forever and ever", 50)), "never emits ellipsis");
ok(/[.!?]$/.test(completeSentences("no terminal punctuation here", 100)), "always ends as a sentence");
ok(completeSentences("Short one. ", 480) === "Short one.", "short text passes through");

console.log("— 4b. titles: complete phrase, never truncated —");
const t1 = finishPinTitle({ model: "Christopher Nolan's 'The Odyssey' Movie: Cast, Release Date & How 'Oppenheimer' Made It…", article: { title: "Christopher Nolan Credits 'Oppenheimer' Success for Making 'The Odyssey' Possible" } });
ok(!/…$/.test(t1) && !/\b(the|of|and|in|for|with|how|made)$/i.test(t1), `no ellipsis / fragment tail: "${t1}"`);
const t2 = finishPinTitle({ model: "", article: ART });
ok(t2.length > 0 && !/…/.test(t2), `article-title fallback is clean: "${t2}"`);
ok(frontLoaded("Margot Robbie, Andy Serkis Join Venice Immersive", ART), "front-load check passes when entity leads");
ok(!frontLoaded("You Won't Believe What Happened At This Festival Event", ART), "front-load check fails on entity-free opener");

console.log("— 4c. hyphen/possessive entities + fragment tails (2026-07-16 repair-run findings) —");
const ART2 = { title: "Anya Taylor-Joy Joins 'The Hunt for Gollum' in James Gunn's Slate", dek: "", whatWeKnow: "", keyTakeaways: [], body: "Anya Taylor-Joy stars. James Gunn's slate grows with Xolo Maridueña." };
ok(factCheck(ART2, "Anya Taylor-Joy shines").ok, "hyphenated name matches (Taylor-Joy)");
ok(factCheck(ART2, "James Gunn's slate and Xolo Maridueña").ok, "possessive + accented entities match");
ok(!factCheck(ART2, "Anya Taylor-Smith shines").ok, "wrong hyphenated surname still caught");
const t3 = finishPinTitle({ model: "Venice Film Festival Immersive Lineup with Margot", article: { title: "Margot Robbie, Andy Serkis Join Venice Immersive Lineup" } });
ok(!/with Margot$/.test(t3), `split first name trimmed: "${t3}"`);
const t4 = finishPinTitle({ model: "Anya Taylor-Joy Joins LOTR", article: { title: "Anya Taylor-Joy Joins LOTR: The Hunt for Gollum Cast" } });
ok(/Joins LOTR/.test(t4) || t4.length >= 30, `legit cue+acronym ending NOT over-trimmed: "${t4}"`);
const t5 = finishPinTitle({ model: "Anya Taylor-Joy Cast in 'Lord of the Rings: The Hunt for", article: { title: "Anya Taylor-Joy Joins 'Lord of the Rings: The Hunt for Gollum' as a Lethal Elf" } });
ok(!/\b(for|the|of|in)$/i.test(t5) && !/…/.test(t5), `fragment-tail input rescued: "${t5}"`);

console.log("— 5. CTA rotation —");
const slugs = ["anya-lotr", "nolan-odyssey", "emmy-noms", "dutton-ranch", "blue-beetle", "venice-vr", "f9-netflix", "summer-house"];
const picks = new Set(slugs.map(ctaFor));
ok(picks.size >= 4, `rotation covers ≥4 styles across 8 slugs (got ${picks.size})`);
ok(ctaFor("anya-lotr") === ctaFor("anya-lotr"), "deterministic per slug");
ok(CTA_STYLES.every((c) => /[.!?]$/.test(c)), "every CTA is a complete sentence");

console.log(`\n${n - failed}/${n} passed${failed ? ` — ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
