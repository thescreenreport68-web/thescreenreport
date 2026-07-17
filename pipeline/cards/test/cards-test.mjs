// CARDS lane offline test suite — zero network, zero API keys. Mock LLM via
// globalThis.__cardsMockLLM. Run: node pipeline/cards/test/cards-test.mjs
import assert from "node:assert";
import sharp from "sharp";
import { CARDS } from "../config.mjs";
import { parseFeed, laParts, slugify } from "../lib/util.mjs";
import { classify } from "../agents/classify.mjs";
import { writeHeadline } from "../agents/headline.mjs";
import { validateCaptions, writeCaptions } from "../agents/captions.mjs";
import { factGate } from "../agents/factgate.mjs";
import { huntImages } from "../agents/imagehunt.mjs";
import { visionQC } from "../agents/visionqc.mjs";
import { renderCard, coverCrop } from "../render.mjs";
import { quotaGate, igPublishes24h, breakingBudget } from "../publish.mjs";

let n = 0, pass = 0;
const t = async (name, fn) => {
  n++;
  try { await fn(); pass++; console.log(`  ok ${n}. ${name}`); }
  catch (e) { console.error(`FAIL ${n}. ${name}: ${e.message}`); }
};
const mock = (impl) => { globalThis.__cardsMockLLM = impl; };
const packOf = (over = {}) => ({ facts: [{ claim: "x", source: "variety.com" }], quotes: [], numbers: [], entities: [], storyOneLine: "", released: null, sources: ["variety.com", "deadline.com"], sourceUrls: [], ownSlug: null, corroboration: 2, ...over });

// ── util ─────────────────────────────────────────────────────────────────────
await t("parseFeed reads RSS items", () => {
  const xml = `<rss><channel><item><title><![CDATA[Big News]]></title><link>https://variety.com/x</link><pubDate>Wed, 15 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Big News");
  assert.ok(items[0].publishedAt > 0);
});
await t("parseFeed reads Atom entries with href links", () => {
  const xml = `<feed><entry><title>Atom Item</title><link href="https://deadline.com/y"/><updated>2026-07-15T10:00:00Z</updated></entry></feed>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://deadline.com/y");
});
await t("laParts returns LA date + hour", () => {
  const p = laParts(new Date("2026-07-16T20:30:00Z")); // 13:30 LA (PDT)
  assert.equal(p.dateKey, "2026-07-16");
  assert.equal(p.hour, 13);
});
await t("slugify strips accents and punctuation", () => {
  assert.equal(slugify("Zendaya’s ‘Athéna’ Gown!"), "zendaya-s-athena-gown"); // é → e via NFKD + mark strip
});
await t("slugify never returns empty — non-Latin titles get a stable hash slug", () => {
  const a = slugify("映画『君の名は。』続編発表！");
  const b = slugify("映画『君の名は。』続編発表！");
  const c = slugify("Фильм отложен на 2028 год");
  assert.match(a, /^card-[0-9a-f]{10}$/);
  assert.equal(a, b); // deterministic
  assert.notEqual(a, c); // distinct titles → distinct slugs
});

// ── classifier hard rules (owner 2026-07-16) ─────────────────────────────────
await t("presale story: model says box-office → hard rule flips to NEWS", async () => {
  mock(async () => ({ category: "box-office", why: "money talk" }));
  const cls = await classify({ title: "IMAX 70mm presale tickets sold out a year early", hint: "box-office" }, packOf({ released: false, facts: [{ claim: "Advance ticket sales crashed sites", source: "variety.com" }] }));
  assert.equal(cls.category, "news");
});
await t("earned grosses on a released film stay BOX OFFICE", async () => {
  mock(async () => ({ category: "box-office", why: "" }));
  const cls = await classify({ title: "Film crossed $500M worldwide" }, packOf({ released: true, facts: [{ claim: "The film grossed $500M worldwide in week 3", source: "variety.com" }] }));
  assert.equal(cls.category, "box-office");
});
await t("death story forces IN MEMORIAM (somber) over model output", async () => {
  mock(async () => ({ category: "celebrity", why: "" }));
  const cls = await classify({ title: "Beloved actor dies at 87" }, packOf({ facts: [{ claim: "The actor died at 87 on July 15", source: "deadline.com" }] }));
  assert.equal(cls.category, "memoriam");
  assert.equal(cls.somber, true);
});
await t("quote category without a verbatim quote demotes to news", async () => {
  mock(async () => ({ category: "quote", why: "" }));
  const cls = await classify({ title: "Director speaks" }, packOf({ quotes: [] }));
  assert.equal(cls.category, "news");
});
await t("model claiming 'breaking' is demoted — the sentinel alone escalates", async () => {
  mock(async () => ({ category: "breaking", why: "huge!" }));
  const cls = await classify({ title: "Studio announces a sequel" }, packOf());
  assert.equal(cls.category, "news");
});

// ── headline contract ────────────────────────────────────────────────────────
await t("headline persistently over the relaxed cap is rejected (null)", async () => {
  mock(async () => ({ headline: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen", redSpan: "", sub: "s" }));
  const out = await writeHeadline({ title: "t" }, packOf(), { category: "news", somber: false });
  assert.equal(out, null);
});
await t("13-word headline passes on the feedback retry (relaxed cap 14)", async () => {
  let calls = 0;
  mock(async ({ user }) => {
    calls++;
    if (calls === 2) assert.ok(/REJECTED: your previous headline had 13 words/.test(user), "retry must carry feedback");
    return { headline: "one two three four five six seven eight nine ten eleven twelve thirteen", redSpan: "", sub: "s" };
  });
  const out = await writeHeadline({ title: "t" }, packOf(), { category: "news", somber: false });
  assert.ok(out && out.headline.split(/\s+/).length === 13);
  assert.equal(calls, 2);
});
await t("redSpan not present verbatim in headline is stripped", async () => {
  mock(async () => ({ headline: "Film delayed to February 2028", redSpan: "March 2028", sub: "s" }));
  const out = await writeHeadline({ title: "t" }, packOf(), { category: "news", somber: false });
  assert.equal(out.redSpan, "");
});
await t("somber headline never carries a red span", async () => {
  mock(async () => ({ headline: "Actor, sitcom favorite, dies at 87", redSpan: "dies at 87", sub: "A five-decade career." }));
  const out = await writeHeadline({ title: "t" }, packOf(), { category: "memoriam", somber: true });
  assert.equal(out.redSpan, "");
});
await t("quote mode passes the verbatim quote through with speaker attribution", async () => {
  mock(async () => { throw new Error("must not call LLM for short verbatim quotes"); });
  const q = { text: "It comes with the territory.", speaker: "Christopher Nolan", source: "deadline.com" };
  const out = await writeHeadline({ title: "t" }, packOf({ quotes: [q] }), { category: "quote", somber: false });
  assert.equal(out.headline, "“It comes with the territory.”");
  assert.ok(out.sub.includes("Christopher Nolan"));
});

// ── caption rules ────────────────────────────────────────────────────────────
await t("caption validator rejects URLs, bait, hashtag piles", () => {
  assert.equal(validateCaptions({ ig: "See https://x.com now", fb: "ok" }, false), "url-in-caption");
  assert.equal(validateCaptions({ ig: "Tag a friend who loves this", fb: "ok" }, false), "engagement-bait");
  assert.equal(validateCaptions({ ig: "#a #b #c #d #e #f six tags", fb: "ok" }, false), "too-many-hashtags");
});
await t("somber captions may not carry emoji or questions", () => {
  assert.equal(validateCaptions({ ig: "Rest in peace 🕊️", fb: "A sad day." }, true), "emoji-on-somber");
  assert.equal(validateCaptions({ ig: "He was 87.", fb: "What is your favorite role?" }, true), "question-on-somber");
});
await t("writeCaptions drops after two rule-breaking attempts", async () => {
  mock(async () => ({ ig: "Tag a friend!", fb: "share if you agree" }));
  const out = await writeCaptions({ title: "t" }, packOf(), { category: "news", somber: false }, { headline: "h", sub: "s" });
  assert.equal(out, null);
});
await t("valid captions pass and NEVER carry a first comment (owner directive 2026-07-17)", async () => {
  mock(async () => ({ ig: "#Zendaya stuns at the premiere. Full story at the link in bio.", fb: "Zendaya wore angel wings to the premiere. Best look of the year so far?" }));
  const out = await writeCaptions({ title: "t" }, packOf({ ownSlug: "zendaya-athena" }), { category: "celebrity", somber: false }, { headline: "h", sub: "s" });
  assert.ok(out.ig.includes("#Zendaya"));
  assert.equal(out.firstComment, undefined);
  assert.deepEqual(Object.keys(out).sort(), ["fb", "ig"]);
});
await t("publisher source contains no firstComment path at all", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../publish.mjs", import.meta.url), "utf8");
  assert.ok(!/platformSpecificData|firstComment\s*[:?]/.test(src.replace(/\/\/[^\n]*/g, "")), "publish.mjs must not send comments");
});

// ── fact gate ────────────────────────────────────────────────────────────────
await t("factgate hard-fails an empty fact pack before any model call", async () => {
  mock(async () => { throw new Error("must not reach the model"); });
  const out = await factGate({ card: { headline: "h", sub: "s" }, captions: { ig: "i", fb: "f" }, cls: { category: "news", somber: false }, pack: packOf({ facts: [] }) });
  assert.equal(out.verdict, "fail");
});
await t("factgate deterministic quote check fails a quote missing from the pack", async () => {
  mock(async () => ({ verdict: "pass", problems: [] })); // model is fooled — code is not
  const out = await factGate({
    card: { headline: "“I never said this sentence.”", sub: "s" },
    captions: { ig: "i", fb: "f" },
    cls: { category: "quote", somber: false },
    pack: packOf({ quotes: [{ text: "Something else entirely.", speaker: "X", source: "s" }] }),
  });
  assert.equal(out.verdict, "fail");
});
await t("factgate passes when the model passes and quotes check out", async () => {
  mock(async () => ({ verdict: "pass", problems: [] }));
  const out = await factGate({ card: { headline: "Plain factual headline", sub: "s" }, captions: { ig: "i", fb: "f" }, cls: { category: "news", somber: false }, pack: packOf() });
  assert.equal(out.verdict, "pass");
});
await t("factgate deterministic quote check covers CAPTIONS too", async () => {
  mock(async () => ({ verdict: "pass", problems: [] }));
  const out = await factGate({
    card: { headline: "Plain headline", sub: "s" },
    captions: { ig: 'He said “this quote was never in any source article” today.', fb: "f" },
    cls: { category: "news", somber: false },
    pack: packOf({ quotes: [] }),
  });
  assert.equal(out.verdict, "fail");
});

// ── image hunter fail-closed ─────────────────────────────────────────────────
await t("huntImages returns [] when no whitelisted carrier is among sources", async () => {
  const out = await huntImages({ sourceLinks: ["https://evil-fanblog.example/post"] }, packOf({ sourceUrls: ["https://another-blog.example/x"] }));
  assert.deepEqual(out, []);
});

// ── focal crop + face-cut hard fail (owner 2026-07-17) ───────────────────────
await t("coverCrop centers the window on the focal point", async () => {
  // 2000×900 source: left half red, right half blue; focus far right → crop mostly blue
  const src = await sharp({ create: { width: 1000, height: 900, channels: 3, background: { r: 200, g: 20, b: 20 } } })
    .extend({ right: 1000, background: { r: 20, g: 20, b: 200 } }).jpeg().toBuffer();
  const out = await coverCrop(src, 1080, 796, { x: 0.9, y: 0.5 });
  const { data } = await sharp(out).resize(4, 4, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let blue = 0;
  for (let i = 0; i < data.length; i += 3) if (data[i + 2] > data[i]) blue++;
  assert.ok(blue >= 12, `expected right-side (blue) dominance, got ${blue}/16 blue pixels`);
});
await t("visionQC hard-fails a cut face even when the model passes on score", async () => {
  mock(async () => ({ score: 88, pass: true, faceCut: true, problems: [] }));
  const out = await visionQC({ jpeg: Buffer.from("x"), card: { headline: "h" }, story: { entities: [] } });
  assert.equal(out.pass, false);
  assert.ok(out.problems[0].includes("face cut"));
});

// ── renderer ─────────────────────────────────────────────────────────────────
const fakePhoto = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 90, g: 110, b: 140 } } }).jpeg().toBuffer();
await t("renderCard is deterministic (identical bytes on re-render)", async () => {
  const job = { category: "news", headline: "Determinism test headline here", redSpan: "test", sub: "Stable sub-line.", creditLine: "Photo: Fixture", photo: fakePhoto };
  const a = await renderCard(job);
  const b = await renderCard(job);
  assert.ok(a.jpeg.equals(b.jpeg));
});
await t("news tab region renders brand red; memoriam renders charcoal", async () => {
  const { photoH } = CARDS.canvas[CARDS.aspect];
  const probe = async (category) => {
    const { jpeg } = await renderCard({ category, headline: "Tab color probe headline", sub: "s", creditLine: "c", photo: fakePhoto });
    const { data } = await sharp(jpeg).extract({ left: 90, top: photoH - 20, width: 8, height: 8 }).raw().toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2]];
  };
  const [rN, gN] = await probe("news");
  assert.ok(rN > 150 && gN < 90, `news tab not red: got r=${rN},g=${gN}`);
  const [rM, gM, bM] = await probe("memoriam");
  assert.ok(Math.abs(rM - 51) < 25 && Math.abs(gM - 51) < 25 && Math.abs(bM - 51) < 25, `memoriam tab not charcoal: ${rM},${gM},${bM}`);
});
await t("renderCard fails closed on an unfittable headline (never clips)", async () => {
  const long = Array(28).fill("EXTRAORDINARILY LONG WORDS").join(" ");
  await assert.rejects(() => renderCard({ category: "news", headline: long, sub: "s", creditLine: "c", photo: fakePhoto }));
});
await t("breaking flag renders the BREAKING tab regardless of category", async () => {
  const { meta } = await renderCard({ category: "tv", breaking: true, headline: "Show canceled after one season", sub: "s", creditLine: "c", photo: fakePhoto });
  assert.equal(meta.category, "breaking");
});

// ── quota + budgets ──────────────────────────────────────────────────────────
await t("quota gate blocks when local model hits the conservative cap", async () => {
  const now = Date.now();
  const posted = Array.from({ length: 16 }, () => ({ at: now - 1000, platforms: [{ platform: "instagram", ok: true }] }));
  const gate = await quotaGate({ posted }, { now });
  assert.equal(gate.ok, false); // 16 + 7 reels = 23 ≥ cap(23) - reserve
  assert.equal(igPublishes24h({ posted }, now), 16);
});
await t("quota gate passes with normal daily volume", async () => {
  const now = Date.now();
  const posted = Array.from({ length: 5 }, () => ({ at: now - 1000, platforms: [{ platform: "instagram", ok: true }] }));
  const gate = await quotaGate({ posted }, { now });
  assert.equal(gate.ok, true);
});
await t("breaking budget exhausts at maxPerDay and maxBursts", () => {
  const now = Date.now();
  const ledger = {
    posted: Array.from({ length: CARDS.breaking.maxPerDay }, () => ({ at: now - 1000, breaking: true })),
    bursts: [now - 1000, now - 2000],
  };
  const b = breakingBudget(ledger, now);
  assert.equal(b.breakingLeft, 0);
  assert.equal(b.burstsLeft, 0);
});
await t("old breaking posts fall out of the 24h budget window", () => {
  const now = Date.now();
  const ledger = { posted: [{ at: now - 25 * 3600_000, breaking: true }], bursts: [] };
  assert.equal(breakingBudget(ledger, now).breakingLeft, CARDS.breaking.maxPerDay);
});
await t("drafts never count against the modeled IG publish quota", () => {
  const now = Date.now();
  const posted = Array.from({ length: 16 }, () => ({ at: now - 1000, mode: "draft", platforms: [{ platform: "instagram", ok: true }] }));
  assert.equal(igPublishes24h({ posted }, now), 0);
});
await t("corrupt ledger fails CLOSED (throws) instead of resetting the guards", async () => {
  const fs = await import("node:fs");
  fs.mkdirSync(CARDS.dataDir, { recursive: true });
  const existed = fs.existsSync(CARDS.ledgerPath) ? fs.readFileSync(CARDS.ledgerPath) : null;
  fs.writeFileSync(CARDS.ledgerPath, "{corrupt json!!");
  try {
    const { loadLedger } = await import("../publish.mjs");
    assert.throws(() => loadLedger(), /corrupt/);
  } finally {
    if (existed) fs.writeFileSync(CARDS.ledgerPath, existed); else fs.rmSync(CARDS.ledgerPath, { force: true });
  }
});

console.log(`\n${pass}/${n} passed`);
if (pass !== n) process.exit(1);
