// PHASE 4 — voice pass (quote-masked + deterministic revert guards) + branded-card hero fallback + linker.
//   node pipeline/gossip/test/voice-card-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { maskQuotes, unmaskQuotes, voiceGuards, voicePass } from "../voice.mjs";
import { wrapTitle, cardSvg, brandCardHero } from "../brandCard.mjs";
import { runGossip } from "../run.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-"));

console.log("\n=== PHASE 4: VOICE + BRAND CARD ===\n");

const BODY = 'Star Alpha, 34, wed on July 3. "It was the best day," she said. The crowd cheered loudly for the couple.\n\n## The details\n\nGuests numbered 40 at the estate, People reports. "We kept it private," her rep added.';

// ── 1) mask/unmask roundtrip ──
{
  const { masked, map } = maskQuotes(BODY);
  check("quotes masked to tokens", map.length === 2 && masked.includes("⟦V1⟧") && !masked.includes("best day"));
  check("unmask restores the exact body", unmaskQuotes(masked, map) === BODY);
}
// ── 2) token integrity rejections ──
{
  const { masked, map } = maskQuotes(BODY);
  check("dropped token → reject", unmaskQuotes(masked.replace("⟦V2⟧", ""), map) === null);
  check("duplicated token → reject", unmaskQuotes(masked + " ⟦V1⟧", map) === null);
  check("invented token → reject", unmaskQuotes(masked.replace("⟦V1⟧", "⟦V1⟧ ⟦V9⟧"), map) === null);
}
// ── 3) deterministic guards ──
{
  check("clean light polish passes", voiceGuards(BODY, BODY.replace("cheered loudly for", "roared for")) === null);
  check("changed number → revert", voiceGuards(BODY, BODY.replace("40", "400")) === "numbers-changed");
  check("new proper name → revert", voiceGuards(BODY, BODY.replace("The crowd", "Taylor Swift and the crowd")) === "new-name");
  check("length collapse → revert", voiceGuards(BODY, "Star Alpha wed. 34 July 3 40.") === "length-drift");
  check("subhead removed → revert", voiceGuards(BODY, BODY.replace("## The details", "The details")) === "subheads-changed");
}
// ── 4) voicePass end-to-end ──
{
  const good = await voicePass({ body: BODY, chatImpl: async ({ user }) => {
    const masked = user.replace(/^BODY:\n/, "");
    return { data: { body: masked.replace("cheered loudly for", "roared for") }, usage: {} };
  } });
  check("good polish adopted (quotes restored)", good.applied === true && good.body.includes("roared for") && good.body.includes('"It was the best day,"'));
  const bad = await voicePass({ body: BODY, chatImpl: async ({ user }) => {
    const masked = user.replace(/^BODY:\n/, "");
    return { data: { body: masked.replace("40", "400") }, usage: {} };
  } });
  check("guard-violating polish reverted", bad.applied === false && bad.reason === "numbers-changed" && bad.body === BODY);
  const dead = await voicePass({ body: BODY, chatImpl: async () => { throw new Error("down"); } });
  check("voice outage → fail-open original", dead.applied === false && dead.body === BODY);
}
// ── 5) card: title wrap + svg ──
{
  const lines = wrapTitle("Star Alpha and Star Beta Say I Do at a Private Malibu Estate Wedding Bash With Every Famous Friend They Have");
  check("title wraps to ≤4 lines w/ ellipsis", lines.length <= 4 && /…$/.test(lines[lines.length - 1]));
  const svg = cardSvg({ title: "Star Alpha & Star Beta's Quiet 'I Do'", category: "celebrity" });
  check("svg carries title + kicker + brand + escaping", svg.includes("CELEBRITY") && svg.includes("THE SCREEN REPORT") && svg.includes("&amp;") && !svg.includes("&&"));
}
// ── 6) brandCardHero: renders via sharp impl; static fallback on failure ──
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cards-"));
  let wrotePng = null;
  const sharpImpl = () => ({ png: () => ({ toFile: async (fp) => { fs.writeFileSync(fp, "PNG"); wrotePng = fp; } }) });
  const hero = await brandCardHero({ title: "Star Alpha Weds", category: "celebrity", slug: "star-alpha-weds", dir, sharpImpl });
  check("card rendered + hero shape correct", wrotePng?.endsWith("star-alpha-weds.png") && hero.kind === "image" && hero.src === "/gossip-cards/star-alpha-weds.png" && hero.width === 1200 && hero.credit === "The Screen Report");
  const fb = await brandCardHero({ title: "X", category: "celebrity", slug: "x", dir, sharpImpl: () => { throw new Error("no sharp"); } });
  check("sharp failure → static brand fallback", fb.src === "/og.png" && fb.source === "brand-static");
}
// ── 7) run.mjs voice wiring: polish applied on PUBLISH; quote-wall guards it ──
{
  let voiceCalled = 0;
  // the publishable floor is >=80 words — pad with neutral filler (no new names/numbers, so guards stay honest)
  const BODY7 = BODY + "\n\n" + "The report described the day in detail and the mood among those present, which several attendees echoed afterward in conversations with the outlet. ".repeat(4);
  const r = await runGossip({ primaryEntity: "Star Alpha", title: "t", claim: "wedding", subjectType: "actor", sources: [{ outlet: "People", text: "Star Alpha, 34, wed on July 3 at a Malibu estate with 40 guests. ".repeat(6) + ' She said "It was the best day," according to People. Her rep added "We kept it private," in a statement.' }] }, {
    writeImpl: async () => ({ title: "Star Alpha Weds", dek: "A wedding to remember for everyone there.", body: BODY7, keyTakeaways: ["k"], faq: [{ q: "Q?", a: "A real answer here." }], whatWeKnow: ["Star Alpha wed July 3"], whatWeDont: [], claims: [] }),
    editorialImpl: async () => ({ isStory: true, category: "celebrity", primaryEntity: "Star Alpha", confirmed: true, official: false, denied: false, angle: "wedding" }),
    voice: true, voiceImpl: async ({ body }) => { voiceCalled++; return { body: body.replace("cheered loudly for", "roared for"), applied: true, reason: null }; },
    verify: false, judge: false, corroborate: false,
  });
  check("voice stage ran + polished body shipped", r.status === "PUBLISH" && voiceCalled === 1 && r.article.body.includes("roared for") && r.voice?.applied === true, JSON.stringify(r.voice));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Voice + brand card green. ✅\n");
