// GOSSIP — INTEGRATION HARNESS (Stages 3→7, offline). Drives the whole orchestrator with a MOCK writer +
// MOCK fetch so it runs with no network/LLM, and asserts the end-to-end routing is correct.
// Run: node pipeline/gossip/test/integration.mjs   (exit 0 = green)
import { runGossip } from "../run.mjs";
import { gatherBundle } from "../contentFinder.mjs";
import { buildGossipPrompt } from "../writer.mjs";
import { frameTopic } from "../frame.mjs";

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}  ${detail}`); }
}

// A long, quote-bearing source body (clears the content-finder minimums, gives the writer a real quote).
const PEOPLE_TEXT = `People has learned that the two stars were spotted together at a Los Angeles restaurant over the weekend. A source close to the pair told People, "They looked very comfortable and were laughing all night." Reps for both did not immediately respond to a request for comment. The outing is the latest in a string of public appearances. `.repeat(3);

console.log(`\n=== GOSSIP INTEGRATION HARNESS (offline) ===\n`);

// A) no extractable sources → BLOCKED at the content finder
// (corroborate:false keeps every offline case off the live GDELT/extract network — they assert on inline text)
{
  const r = await runGossip({ primaryEntity: "Star Z", title: "Mystery", claim: "something", sources: [{ outlet: "Reddit" }] }, { corroborate: false });
  check("no sources → BLOCKED (content finder)", r.status === "BLOCKED" && r.stage === "content-finder", JSON.stringify(r).slice(0, 120));
}

// B) EXTREME w/o an established outlet → HELD (even though a bundle exists)
{
  const r = await runGossip({
    primaryEntity: "An Actor", title: "Assault rumor", claim: "accused of sexual assault",
    sources: [{ outlet: "DeuxMoi", text: "Anonymous tip alleges misconduct. " .repeat(20) }],
  }, { corroborate: false });
  check("EXTREME, no major → HELD", r.status === "HELD", JSON.stringify(r).slice(0, 120));
}

// C) normal dating, major outlet, clean attributed article → PUBLISH (+ provenance/byline/rumor fields)
{
  const mockWriter = async () => ({
    title: "Star A and Star B spark dating buzz, per People",
    dek: "The two were spotted together this weekend.",
    body: "According to People, Star A and Star B were spotted together at a restaurant this weekend, and the internet is already running with it.\n\nA source told People the pair 'looked very comfortable' over what was described as a long, laughter-filled dinner. Reps for both did not immediately comment, so nothing about the nature of their relationship has been confirmed. " + "For now, the sighting is the only concrete thread fans have to pull on, and the rest remains pure speculation. " + Array.from({ length: 12 }, (_, i) => `Fans online flagged observation number ${i + 1}, dissecting the timing and the body language for any hint of what might really be going on between the two stars.`).join(" "),
    claims: [], faq: [], keyTakeaways: [], whatWeKnow: ["Spotted together, per People"], whatWeDont: ["Whether they're officially together"], denial: null,
  });
  const r = await runGossip(
    { primaryEntity: "Star A", subjectType: "celebrity", title: "Star A dating", claim: "Star A and Star B are dating", sources: [{ outlet: "People", text: PEOPLE_TEXT }] },
    { writeImpl: mockWriter, corroborate: false }
  );
  check("normal+major+clean → PUBLISH", r.status === "PUBLISH", JSON.stringify(r.status));
  check("PUBLISH attaches Alicia byline", r.article?.author === "alicia-bernard");
  check("PUBLISH attaches rumor UI + provenance", !!r.article?.rumor?.statusLabel && r.provenance?.tier === "REPORTED_BY_MAJOR" && r.route?.category === "celebrity");
}

// D) writer emits an UNATTRIBUTED damaging claim → the gate CUTS it (never blocks). Here it's the whole article,
// so cutting the defamatory sentence leaves nothing publishable → HELD (the claim never reaches publish).
{
  const badWriter = async () => ({ title: "Star C news", dek: "x", body: "Star C has herpes and used cocaine before fame." });
  const r = await runGossip(
    { primaryEntity: "Star C", title: "Star C", claim: "health rumor", sources: [{ outlet: "Pop Crave", text: "buzz buzz ".repeat(30) }] },
    { writeImpl: badWriter, corroborate: false }
  );
  check("unattributed damaging is CUT → nothing publishable → HELD (never published)", r.status === "HELD" && !/herpes|cocaine/i.test(r.article?.body || ""), JSON.stringify(r.status) + " " + (r.article?.body || "").slice(0, 60));
}

// E) sensitive (death) rumor, writer omits the mandatory disclaimer → the gate ADDS it and PUBLISHES (never blocks).
{
  const noDisclaimer = async () => ({ title: "A Star health scare?", dek: "x", body: "Social media is buzzing that A Star has died after a cryptic post from a friend went viral overnight. " + Array.from({ length: 12 }, (_, i) => `Fans shared reaction number ${i + 1}, flooding the comments with tributes while others urged everyone to wait for something official before believing it.`).join(" ") });
  const r = await runGossip(
    { primaryEntity: "A Star", title: "Death rumor", claim: "A Star has died", sources: [{ outlet: "Reddit", text: "rip posts everywhere ".repeat(30) }] },
    { writeImpl: noDisclaimer, corroborate: false }
  );
  check("missing disclaimer is AUTO-ADDED → PUBLISH (not blocked)", r.status === "PUBLISH", JSON.stringify(r.status));
}

// F) content finder via a MOCK extractor — extracts CLEAN text + a verbatim quote
{
  const bundle = await gatherBundle(
    { primaryEntity: "Star A", sources: [{ outlet: "Variety", url: "https://variety.com/x" }] },
    { extractImpl: async () => ({ content: `<p>${PEOPLE_TEXT}</p>`, title: "Star A spotted" }) }
  );
  check("extraction path yields a source", bundle.ok && bundle.outletCount === 1);
  check("extraction yields a verbatim quote", bundle.quotes.some((q) => q.includes("looked very comfortable")), bundle.quotes.join("|").slice(0, 120));
}

// G) the writer is INSTRUCTED correctly (pure prompt build — no LLM spend)
{
  const topic = { primaryEntity: "A Star", title: "Death rumor", claim: "A Star has died", sources: [{ outlet: "Reddit" }] };
  const frame = frameTopic(topic);
  const bundle = { entity: "A Star", sources: [{ outlet: "Reddit", url: null, tier: 2, text: "rip", quotes: ["they were the best"] }], quotes: ["they were the best"] };
  const { system, user } = buildGossipPrompt(bundle, frame, topic);
  check("prompt forces ONLY-the-bundle", /ONLY from the VERIFIED BUNDLE/i.test(system));
  check("prompt injects the mandatory disclaimer", frame.disclaimerText.length > 0 && user.includes(frame.disclaimerText));
  check("prompt injects the framing directive", user.includes(frame.writerDirective.slice(0, 40)));
  check("prompt passes the bundle quote", user.includes("they were the best"));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Integration green. ✅\n");
