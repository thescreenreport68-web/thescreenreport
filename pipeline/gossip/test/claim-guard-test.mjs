// GOSSIP — CLAIM GUARD regression test (2026-07-25 review fixes).
//
// Every fixture below is REAL TEXT from the reviewed live article. The four fabrications it shipped were
// all UNQUOTED, so quoteGuard (which proved all 14 quotes verbatim) never looked at them.
//
// 🔴 The two most important asserts in this file are the PROMPT-LEAK ones. "fans were quick to notice"
//    was listed in the writer's system prompt as an approved idiom, and "WABI" appeared in it as an
//    example outlet name — the model copied both into the article as if they were facts about the story.
//    A guard that catches the output is not enough; the instruction itself must not supply the words.
import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { OBSERVATION_RE, CROWD_RE, cutUngroundedClaims, cutInventedObservation, inventedObservations, unsourcedOutlets, claimFixIssues, groundedPhrase, corpusOf } from "../claimGuard.mjs";
import { auditableSentences, auditFixIssues } from "../claimAudit.mjs";
import { ABSENCE_RE, cutAbsenceClaims } from "../proseGuards.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; const fails = [];
const check = (name, cond, got = "") => { if (cond) { pass++; } else { fails.push(`${name}${got ? `  ${got}` : ""}`); console.log(`❌ ${name}` + (got ? `  ${got}` : "")); } };

// The sources the live article actually had: a TV interview write-up + a People statement. No video,
// no fan reaction, no outlet named WABI, and the word "treatment" — never "therapy".
const SRC = `Nivea B. Hamilton appeared on Cadillac Chronicles TV with Brian Freeman on Tuesday, July 21, 2026.
"I was diagnosed with leukemia earlier this year," she said. "I am so grateful to God. I've been going through
treatment, and everything is going great so far. And I expect it to continue." She told People in a statement
released July 23 that she was diagnosed with CML (Chronic Myeloid Leukemia) in early 2026. "I'm going to school
for audio engineering," she said. She has four children: Navy Nash, London Nash, Christian Nash and Neal Carter.`;
const bundle = { sources: [{ outlet: "People", tier: 6, url: "https://people.com/x", text: SRC }], quotes: [] };
const corpus = corpusOf(bundle);

// ── 1. INVENTED OBSERVATION — we read text; we never watched the interview ────────────────────────
const LEDE = `The camera panned in as Nivea B. Hamilton sat across from Brian Freeman, her voice steady, her eyes clear. She leaned forward, not for drama, but for truth.`;
check("🔴 detects the invented camera/face/voice lede", inventedObservations(LEDE, bundle).length >= 1, `${inventedObservations(LEDE, bundle).length} found`);
check("…and it is FLAGGED for repair before anything is cut", claimFixIssues(LEDE, bundle).some((i) => /INVENTED OBSERVATION/.test(i)));
const cutObs = cutInventedObservation(LEDE, bundle);
check("…and cut if the surgical pass does not repair it", !/camera panned|eyes clear|leaned forward/i.test(cutObs.body), cutObs.body.slice(0, 60));
check("She didn't flinch — invented manner", OBSERVATION_RE.test("She didn't flinch."));
check("the room fell silent — invented atmosphere", OBSERVATION_RE.test("The room fell silent."));

// observation the SOURCE actually states must survive — the guard checks grounding, not vocabulary
const grounded = `She said her voice was steady throughout.`;
const gBundle = { sources: [{ outlet: "People", tier: 6, text: SRC + " Her voice was steady throughout the sit-down." }] };
check("🔴 an observation the SOURCE states is NOT cut", cutInventedObservation(grounded, gBundle).cut.length === 0);
// a verbatim quote that happens to mention a face must never be deleted
const qSent = `"I could see it in her eyes," Freeman said.`;
check("🔴 a QUOTE mentioning eyes is never cut", cutInventedObservation(qSent, bundle).cut.length === 0);

// ── 2. INVENTED PUBLIC REACTION ───────────────────────────────────────────────────────────────────
const CROWD = `Fans were quick to notice her absence from the spotlight in early 2026, but speculation was minimal until her TV appearance.`;
check("🔴 detects invented fan reaction", CROWD_RE.test(CROWD));
check("…and cuts it (we gathered no fan reaction)", cutUngroundedClaims(CROWD, bundle).cut.length === 1, JSON.stringify(cutUngroundedClaims(CROWD, bundle).cut));
check("social-media eruption is caught too", CROWD_RE.test("Social media erupted within minutes."));
// but reported reaction, actually in the sources, survives
const rBundle = { sources: [{ outlet: "People", tier: 6, text: SRC + " Fans were quick to notice her absence from the spotlight." }] };
check("🔴 fan reaction the SOURCE reports survives", cutUngroundedClaims(CROWD, rBundle).cut.length === 0);

// ── 3. PHANTOM CORROBORATION ──────────────────────────────────────────────────────────────────────
const PHANTOM = `Since then, WABI and other outlets have echoed the news, citing her interview and People statement.`;
check("🔴 detects an outlet we never gathered (WABI)", unsourcedOutlets(PHANTOM, bundle).some((x) => x.outlet === "WABI"));
check("…and cuts the phantom-corroboration sentence", cutUngroundedClaims(PHANTOM, bundle).cut.length === 1);
check("🔴 an outlet that IS in the bundle is never flagged", !unsourcedOutlets(`She told People in a statement.`, bundle).length);
check("ordinary prose with no attribution is untouched", cutUngroundedClaims("She has four children.", bundle).cut.length === 0);

// ── 4. ABSENCE PADDING — all four live phrasings walked past the old regex ────────────────────────
const ABSENCE_LIVE = [
  "No other outlets have reported additional medical details.",
  "No further details about her treatment plan, prognosis, or timeline have been confirmed.",
  "There is no public record of hospitalization, no social media montage of chemo sessions.",
  "No outside medical records have been released, and no representative has issued a separate statement.",
];
ABSENCE_LIVE.forEach((s, i) => check(`🔴 absence phrasing ${i + 1} is now caught`, ABSENCE_RE.test(s), s.slice(0, 56)));
check("…and they are cut from the body", cutAbsenceClaims(ABSENCE_LIVE.join(" ")).body.trim() === "");
["She was diagnosed with CML in early 2026, she told People.",
 "Live Nation confirmed refunds would be issued automatically within 30 days.",
 "Her representative said he expects to reschedule in 2027."]
  .forEach((s, i) => check(`real reporting ${i + 1} is NOT cut as an absence`, !ABSENCE_RE.test(s), s.slice(0, 50)));

// ── 5. THE PROMPT ITSELF MUST NOT SUPPLY THE FABRICATIONS ─────────────────────────────────────────
const writerSrc = fs.readFileSync(path.join(HERE, "..", "writer.mjs"), "utf8");
const SYSTEM_BLOCK = writerSrc.slice(0, writerSrc.indexOf("const TYPES"));
check("🔴🔴 the writer prompt no longer offers \"fans were quick to notice\" as idiom",
  !/fans were quick to notice"\)/.test(SYSTEM_BLOCK));
check("🔴🔴 the writer prompt no longer contains real outlet call signs as examples",
  !/\bWABI\b|\bWMUR\b/.test(writerSrc));
check("the prompt bans describing what we did not see", /NEVER DESCRIBE WHAT YOU DID NOT SEE/.test(writerSrc));
check("the prompt bans inventing an audience", /NEVER INVENT AN AUDIENCE/.test(writerSrc));
check("the prompt bans naming an outlet outside the bundle", /NEVER NAME AN OUTLET THAT IS NOT IN THE BUNDLE/.test(writerSrc));
check("the prompt warns that its OWN words are not story facts", /never copy an example name, phrase, or outlet from this prompt/i.test(writerSrc));
check("the SCENE lede no longer invites invented imagery", /you did NOT watch this/i.test(writerSrc));
check("subheads: 4–6 required once the piece runs long", /4–6 once it runs past/.test(writerSrc));

// ── 6. SEMANTIC AUDIT PLUMBING (the "treatment" → "therapy" class) ────────────────────────────────
const body = `She's in school. She's in therapy. She's in music.\n\n## What Was Said\n\nShe told People she was diagnosed with CML in early 2026.`;
const sents = auditableSentences(body);
check("auditable sentences skip headings", !sents.some((s) => s.startsWith("##")));
check("auditable sentences drop tiny fragments", sents.every((s) => s.split(" ").filter(Boolean).length >= 3));
check("audit findings become surgical-fix instructions",
  auditFixIssues({ unsupported: [{ sentence: "She's in therapy.", why: "source says treatment, not therapy" }] })[0].includes("UNSUPPORTED CLAIM"));
check("audit fix instruction forbids inventing a replacement",
  /Do not invent a replacement fact/.test(auditFixIssues({ unsupported: [{ sentence: "x y z", why: "w" }] })[0]));
check("an empty audit produces no issues", auditFixIssues({ unsupported: [] }).length === 0);
check("a failed audit is treated as no findings (fail soft)", auditFixIssues(null).length === 0);

// ── 7. GROUNDING HELPER ───────────────────────────────────────────────────────────────────────────
check("grounded: a phrase from the source passes", groundedPhrase("diagnosed with CML in early 2026", corpus));
check("ungrounded: an invented phrase fails", !groundedPhrase("the camera panned in as she sat", corpus));
check("very short phrases are not judged (no false cuts)", groundedPhrase("she said", corpus));

// ── 8. THE WHOLE LIVE LEDE+PARAGRAPH, END TO END ──────────────────────────────────────────────────
const FULL = `${LEDE}\n\n${CROWD} ${PHANTOM}\n\n${ABSENCE_LIVE[0]} She told People she was diagnosed with CML in early 2026.`;
let out = cutUngroundedClaims(FULL, bundle).body;
out = cutAbsenceClaims(out).body;
out = cutInventedObservation(out, bundle).body;
check("🔴 END-TO-END: every fabrication from the live article is gone",
  !/camera panned|eyes clear|leaned forward|quick to notice|WABI|No other outlets/i.test(out), out.slice(0, 90));
check("🔴 END-TO-END: the one REAL sourced sentence survives",
  /diagnosed with CML in early 2026/.test(out), out.slice(0, 90));

console.log(`\n── RESULT: ${pass} passed${fails.length ? `, ${fails.length} FAILED` : ""} ──`);
if (fails.length) { console.log("FAILED: " + fails.join("; ")); process.exit(1); }
console.log("Unquoted prose is now guarded — and the prompt no longer supplies the fabrications. ✅");
assert.ok(true);
