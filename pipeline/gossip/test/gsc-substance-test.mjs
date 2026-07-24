// GSC STEP 1 (connection, log-only) + RECOVERY-MODE SUBSTANCE GATE (Option A).
// Owner-approved 2026-07-24. Hermetic: no network, no writes outside temp dirs.
//   node pipeline/gossip/test/gsc-substance-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSearchSignals, buildDemandMap, demandBonus, phrasingsFor, strikingDistance, EMPTY } from "../gscSignals.mjs";
import { substanceCheck, SUBSTANCE_MIN_WORDS } from "../qualityGate.mjs";
import { runGossip } from "../run.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-"));
const tmpCache = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gsc-")), "cache.json");

console.log("\n=== GSC STEP 1 + SUBSTANCE GATE ===\n");

// ── GSC must FAIL SOFT in every failure mode: the lane keeps running, always ──
{
  const noKey = await getSearchSignals({ key: null, cachePath: tmpCache(), fetchImpl: async () => { throw new Error("should not be called"); } });
  check("no key ⇒ empty signals, never throws", noKey.ok === false && Array.isArray(noKey.queries) && noKey.queries.length === 0, JSON.stringify(noKey).slice(0, 90));

  const fakeKey = { client_email: "x@y.iam", private_key: "not-a-real-key" };
  const netDead = await getSearchSignals({ key: fakeKey, cachePath: tmpCache(), fetchImpl: async () => { throw new Error("ENOTFOUND"); } });
  check("dead network ⇒ empty signals, never throws", netDead.ok === false && /unavailable/.test(netDead.reason), netDead.reason);

  const http500 = await getSearchSignals({ key: fakeKey, cachePath: tmpCache(), fetchImpl: async () => ({ ok: false, status: 500 }) });
  check("HTTP error ⇒ empty signals, never throws", http500.ok === false);

  // a signing failure must also be swallowed
  const badPem = await getSearchSignals({ key: { client_email: "a@b", private_key: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" }, cachePath: tmpCache(), fetchImpl: async () => ({ ok: true, json: async () => ({ access_token: "t" }) }) });
  check("bad private key ⇒ empty signals, never throws", badPem.ok === false);
  check("EMPTY shape is safe for every consumer", EMPTY.queries.length === 0 && EMPTY.pages.length === 0 && EMPTY.ok === false);
}
// ── ONE call per tick: a warm cache must not hit the network ──
{
  const cache = tmpCache();
  let calls = 0;
  const key = { client_email: "x@y.iam", private_key: "k" };
  const fetchImpl = async (url) => {
    calls++;
    if (String(url).includes("oauth2")) return { ok: true, json: async () => ({ access_token: "tok" }) };
    return { ok: true, json: async () => ({ rows: [
      { keys: ["ariana grande new single", "https://thescreenreport.com/celebrity/ariana-grande-drops-single/"], impressions: 40, clicks: 3, position: 12.5 },
      { keys: ["jelly roll and bunnie xo divorce", "https://thescreenreport.com/celebrity/jelly-roll-divorce/"], impressions: 12, clicks: 1, position: 9.2 },
      { keys: ["what happened to star a", "https://thescreenreport.com/celebrity/star-a-news/"], impressions: 5, clicks: 0, position: 44 },
    ] }) };
  };
  const signKey = { ...key, private_key: null };
  // stub the token step by pre-seeding the cache instead of real signing
  const seeded = { ok: true, fetchedAt: new Date().toISOString(), queries: [{ query: "ariana grande new single", impressions: 40, clicks: 3, position: 12.5 }], pages: [] };
  fs.writeFileSync(cache, JSON.stringify(seeded));
  const warm = await getSearchSignals({ cachePath: cache, fetchImpl: async () => { calls++; throw new Error("network must not be touched"); } });
  check("warm cache ⇒ ZERO network calls (one call per tick honoured)", calls === 0 && warm.cached === true && warm.queries.length === 1, `calls=${calls}`);

  const stale = { ...seeded, fetchedAt: new Date(Date.now() - 48 * 3600e3).toISOString() };
  fs.writeFileSync(cache, JSON.stringify(stale));
  const afterStale = await getSearchSignals({ key: null, cachePath: cache, fetchImpl: async () => { throw new Error("no key path"); } });
  check("stale cache is still used when the key is gone (better than blind)", afterStale.queries.length === 1 && /stale/.test(afterStale.reason), afterStale.reason);
}
// ── demand map + the two owner limits ──
{
  const signals = { queries: [
    { query: "ariana grande new single", impressions: 40, clicks: 3, position: 12 },
    { query: "ariana grande boyfriend", impressions: 20, clicks: 1, position: 15 },
    { query: "jelly roll and bunnie xo divorce", impressions: 12, clicks: 1, position: 9 },
    { query: "what happened to sydney sweeney", impressions: 4, clicks: 0, position: 30 },
  ] };
  const dm = buildDemandMap(signals);
  check("demand map extracts NAMES from real queries", dm.size >= 3 && [...dm.keys()].some((k) => /ariana grande/.test(k)), JSON.stringify([...dm.keys()]));
  check("impressions accumulate across a name's queries", (dm.get("ariana grande")?.impressions || 0) === 60, String(dm.get("ariana grande")?.impressions));

  // LIMIT 1 — never a takeover: the bonus is bounded
  const huge = buildDemandMap({ queries: [{ query: "mega famous person", impressions: 999999, clicks: 5000, position: 1 }] });
  check("LIMIT 1 — bonus is bounded, can never dominate the queue", demandBonus("mega famous person", huge) <= 15, String(demandBonus("mega famous person", huge)));
  check("a bigger name still outranks a smaller one", demandBonus("ariana grande", dm) > demandBonus("sydney sweeney", dm));

  // LIMIT 2 — no data never counts against a story
  check("LIMIT 2 — unknown name scores 0, NEVER negative", demandBonus("Completely Unknown Person", dm) === 0);
  check("LIMIT 2 — empty demand map scores 0 for everyone", demandBonus("Ariana Grande", new Map()) === 0);
  check("accent/case variants resolve to the same demand", demandBonus("ARIANA GRANDE", dm) === demandBonus("ariana grande", dm));

  const ph = phrasingsFor("ariana grande", dm);
  check("real query phrasings available for the headline agent", ph.length >= 2 && ph.some((p) => /new single|boyfriend/.test(p)), JSON.stringify(ph));
}
// ── striking distance ──
{
  const signals = { pages: [
    { page: "https://thescreenreport.com/celebrity/close-one/", impressions: 30, clicks: 0, position: 12 },
    { page: "https://thescreenreport.com/celebrity/page-one-already/", impressions: 90, clicks: 9, position: 3 },
    { page: "https://thescreenreport.com/celebrity/miles-away/", impressions: 2, clicks: 0, position: 70 },
  ] };
  const sd = strikingDistance(signals);
  check("only pos 8–30 pages are candidates", sd.length === 1 && sd[0].slug === "close-one", JSON.stringify(sd.map((x) => x.slug)));
}

// ── SUBSTANCE GATE (Option A) — judges the FINISHED article, never the writer ──
{
  const rich = "Star A confirmed the split on July 3, People reports. " + '"It was the hardest decision," she said. ' + "More verified detail sentence goes right here. ".repeat(50);
  const twoOutlets = { sources: [{ outlet: "People", text: "x" }], corroboratingOutlets: [{ outlet: "Page Six" }] };
  const ok = substanceCheck({ body: rich }, twoOutlets);
  check("a substantial, multi-source, quoted piece PASSES", ok.pass, JSON.stringify(ok.reasons));

  const thin = substanceCheck({ body: "Star A confirmed the split on July 3, People reports. Short piece." }, twoOutlets);
  check("a thin piece is HELD", !thin.pass && thin.reasons.some((r) => /substance floor/.test(r)), JSON.stringify(thin.reasons));

  const single = substanceCheck({ body: rich }, { sources: [{ outlet: "People", text: "x" }], corroboratingOutlets: [] });
  check("a single-source piece is HELD", !single.pass && single.reasons.some((r) => /single-source/.test(r)), JSON.stringify(single.reasons));

  const noSubstance = substanceCheck({ body: "Star A and Star B are reportedly in a good place, a source says. " + "Vague filler sentence with nothing concrete at all in it. ".repeat(50) }, twoOutlets);
  check("no quote AND no concrete date/number is HELD", !noSubstance.pass && noSubstance.reasons.some((r) => /no verbatim quote/.test(r)), JSON.stringify(noSubstance.reasons));

  const quoteOnly = substanceCheck({ body: '"This is a real verbatim quote from the source," she said. ' + "Filler sentence with no numbers at all in here. ".repeat(50) }, twoOutlets);
  check("a quote alone satisfies the substance requirement", quoteOnly.pass, JSON.stringify(quoteOnly.reasons));
  check("floor default is 250 words", SUBSTANCE_MIN_WORDS === 250);
}
// ── the gate must NOT leak a word target into the writer ──
{
  const { buildGossipPrompt } = await import("../writer.mjs");
  const bundle = { sources: [{ outlet: "People", tier: 6, text: "Star A wed on July 3. ".repeat(30), quotes: [] }] };
  const { user } = buildGossipPrompt(bundle, { writerDirective: "d", uiLabel: "Reported" }, { primaryEntity: "Star A", title: "t" });
  check("writer prompt contains NO 250-word instruction (no-padding rule intact)", !/250/.test(user), (user.match(/\d{3}[–-]\d{3} words/) || ["?"])[0]);
  check("writer target is still the bundle-derived range", /\d{3}–\d{3} words/.test(user));
}
// ── end-to-end: a thin article is HELD, a substantial one PUBLISHES ──
{
  const SRC = "Star Alpha, 34, wed Star Beta on July 3 at a Malibu estate with 40 guests, People reports. ".repeat(8);
  const mk = (body) => async () => ({
    title: "Star Alpha and Star Beta Wed in Malibu", dek: "The couple kept the ceremony small and private.",
    body, keyTakeaways: ["k"], faq: [{ q: "Q?", a: "A real answer here." }], whatWeKnow: ["Star Alpha wed Star Beta"], whatWeDont: [], claims: [],
  });
  const common = {
    editorialImpl: async () => ({ isStory: true, category: "celebrity", primaryEntity: "Star Alpha", confirmed: true, official: false, denied: false, angle: "wedding" }),
    verify: false, judge: false, corroborate: false, substance: true,
  };
  const topic = { primaryEntity: "Star Alpha", title: "t", claim: "wedding", subjectType: "actor", sources: [{ outlet: "People", tier: 6, text: SRC }] };

  // >80w (so the pre-existing nothing-publishable gate does NOT fire) but under the 250w substance floor
  const thinBody = 'Star Alpha wed Star Beta on July 3, People reports. "It was perfect," she said.\n\n' +
    'A short account of the day followed in the same report. '.repeat(12);
  const rThin = await runGossip(topic, { ...common, writeImpl: mk(thinBody) });
  check("E2E: a thin article is HELD, not published", rThin.status === "HELD" && rThin.stage === "thin", `${rThin.status}/${rThin.stage}`);

  const richBody = 'Star Alpha wed Star Beta on July 3, People reports. "It was the best day of my life," she said.\n\n' +
    ["The ceremony took place under an olive grove at the property's edge.", "Guests arrived by shuttle from a hotel in Santa Monica that afternoon.", "The bride wore a silk gown with a cathedral train and no veil.", "Dinner was served family style on long wooden tables lit by lamps.", "A string quartet played during the vows before a soul band took over.", "The couple met on a film set in Atlanta and dated privately for years.", "Security collected phones at the gate to keep images off social media.", "Fireworks closed the night just after midnight over the Pacific.", "Their families gathered for a rehearsal lunch the previous day.", "Vows were written separately and read without notes to the crowd.", "Catering came from a Venice restaurant the pair visited on date one.", "The officiant was a college friend who introduced them years earlier.", "Flowers were grown on a farm twenty minutes north of the property.", "An after-party ran until sunrise in a converted barn behind the house.", "Only immediate family stayed on site for brunch the following morning.", "Neither had spoken publicly about the engagement before this week.", "A representative declined to describe the guest list in any detail.", "Photographs will not be released, two people familiar with the plans said.", "The pair are expected to travel abroad later in the summer months.", "Both have kept their relationship largely out of public view until now.",
     "The venue had hosted only a handful of private events before this one.",
     "Planning took roughly nine months from the engagement announcement.",
     "A small team handled the arrangements without an outside coordinator.",
     "Guests were asked to keep the date and location to themselves entirely.",
     "The couple wrote thank-you notes by hand in the week that followed."].join(" ");
  const rRich = await runGossip({ ...topic, sources: [{ outlet: "People", tier: 6, text: SRC }] }, {
    ...common,
    writeImpl: mk(richBody),
    corroborateImpl: async (t, b) => ({ ...b, corroboratingOutlets: [{ outlet: "Page Six" }] }),
  });
  // gatherBundle builds the bundle from the topic's own sources; add the 2nd outlet via the topic itself
  const rRich2 = rRich.status === "PUBLISH" ? rRich : await runGossip({ ...topic, sources: [{ outlet: "People", tier: 6, text: SRC }, { outlet: "Page Six", tier: 6, text: SRC }] }, { ...common, writeImpl: mk(richBody) });
  check("E2E: a substantial multi-source article PUBLISHES", rRich2.status === "PUBLISH", `${rRich2.status}${rRich2.reason ? " — " + rRich2.reason : ""}`);
  check("E2E: the substance verdict is reported", !!rRich2.substance && typeof rRich2.substance.words === "number", JSON.stringify(rRich2.substance || {}).slice(0, 90));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("GSC connection safe + substance gate live. ✅\n");
