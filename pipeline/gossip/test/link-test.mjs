// STEP 7 — INTERNAL LINKS. Offline: mock embeddings + a mock contradiction firewall + a temp content dir.
// Proves: the shared-entity gate (hard), semantic ranking, the fail-CLOSED contradiction firewall (the
// "Selena married -> husband died" guard), self-exclusion, the max cap, and the index build/cache.
// Run: node pipeline/gossip/test/link-test.mjs
import fs from "node:fs";
import path from "node:path";
import { buildLinkIndex, titleNames, articleEntities } from "../linkIndex.mjs";
import { findRelatedLinks } from "../internalLinks.mjs";

let pass = 0, fail = 0;
const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== STEP 7 INTERNAL LINKS ===\n");

// ── titleNames + articleEntities (pure) ──
check("titleNames pulls multi-word proper names", JSON.stringify(titleNames("Selena Gomez spotted with Benny Blanco")) === JSON.stringify(["Selena Gomez", "Benny Blanco"]));
check("titleNames ignores single capitalized words", titleNames("She Left The Party").length === 0 ? true : titleNames("She Left The Party").every((n) => n.includes(" ")));
check("articleEntities merges primaryEntity + about + title names", (() => { const e = articleEntities({ title: "Taylor Swift news", provenance: { primaryEntity: "Taylor Swift" }, about: [{ name: "Travis Kelce" }] }); return e.includes("Taylor Swift") && e.includes("Travis Kelce"); })());

// ── buildLinkIndex over a TEMP content dir with a mock embedder ──
const TMP = path.join("/private/tmp/claude-501/-Users-sivajithcu-Movie-News-site/df5807d0-2263-4695-81bd-7e3f001e344f/scratchpad", "link-corpus");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const md = (fm, body = "x") => `---\n${fm}\n---\n${body}\n`;
fs.writeFileSync(path.join(TMP, "selena-romance.md"), md(`title: Selena Gomez sparks romance buzz\nslug: selena-romance\ncategory: celebrity\nformatTag: gossip\ndate: '2026-06-20'\nprovenance:\n  primaryEntity: Selena Gomez`));
fs.writeFileSync(path.join(TMP, "selena-profile.md"), md(`title: Selena Gomez career profile\nslug: selena-profile\ncategory: celebrity\nformatTag: profile\ndate: '2026-01-10'\nprovenance:\n  primaryEntity: Selena Gomez`));
fs.writeFileSync(path.join(TMP, "taylor-tour.md"), md(`title: Taylor Swift announces tour\nslug: taylor-tour\ncategory: music\nformatTag: news\ndate: '2026-05-01'\nprovenance:\n  primaryEntity: Taylor Swift`));
fs.writeFileSync(path.join(TMP, "draft.md"), md(`title: A draft about Selena Gomez\nslug: draft\ncategory: celebrity\ndraft: true\nprovenance:\n  primaryEntity: Selena Gomez`));

// deterministic mock embedder: a 4-dim vector keyed off which names appear (so cosine is meaningful + stable)
const mockEmbed = async (text) => { const t = text.toLowerCase(); return Float32Array.from([t.includes("selena") ? 1 : 0, t.includes("romance") || t.includes("dating") ? 1 : 0, t.includes("taylor") ? 1 : 0, t.includes("profile") || t.includes("career") ? 1 : 0]); };

{
  const index = await buildLinkIndex({ dir: TMP, embedImpl: mockEmbed, persist: false });
  check("index excludes drafts", !index.some((r) => r.slug === "draft"));
  check("index has the 3 published articles", index.length === 3, `got ${index.length}`);
  const sel = index.find((r) => r.slug === "selena-romance");
  check("entry carries url + entities + embedding", sel.url === "/celebrity/selena-romance/" && sel.entities.includes("Selena Gomez") && Array.isArray(sel.embedding));
}

// ── findRelatedLinks: shared-entity gate + ranking + firewall ──
const INDEX = [
  { slug: "selena-profile", title: "Selena Gomez career profile", url: "/celebrity/selena-profile/", entities: ["Selena Gomez"], date: "2026-01-10", claim: "career retrospective", embedding: [1, 0, 0, 1] },
  { slug: "selena-old-romance", title: "Selena Gomez was dating someone last year", url: "/celebrity/selena-old-romance/", entities: ["Selena Gomez"], date: "2025-06-01", claim: "past romance", embedding: [1, 1, 0, 0] },
  { slug: "taylor-tour", title: "Taylor Swift announces tour", url: "/music/taylor-tour/", entities: ["Taylor Swift"], date: "2026-05-01", claim: "tour news", embedding: [0, 0, 1, 0] },
];
const ARTICLE = { title: "Selena Gomez sparks new romance buzz", dek: "Fans are speculating about a new flame.", about: [] };
const TOPIC = { primaryEntity: "Selena Gomez", claim: "Selena Gomez is dating someone new", slug: "selena-new-romance" };
const allSafe = async () => ({ safe: true, reason: "related" });

{
  const links = await findRelatedLinks({ article: ARTICLE, topic: TOPIC, index: INDEX, embedImpl: mockEmbed, firewallImpl: allSafe, max: 3, minScore: 0.1 });
  check("shared-entity GATE excludes the Taylor Swift article", !links.some((l) => l.slug === "taylor-tour"));
  check("only same-entity articles are linked", links.every((l) => /selena/.test(l.slug)));
  check("ranked by semantic similarity (the romance article outranks the profile)", links[0].slug === "selena-old-romance", JSON.stringify(links));
}

// CONTRADICTION FIREWALL — the "Selena married -> husband died" guard: an unsafe candidate is dropped
{
  // firewall: mark the profile UNSAFE (pretend it contradicts), the romance SAFE
  const firewall = async (cur, cand) => ({ safe: !/profile/.test(cand.title), reason: "test" });
  const links = await findRelatedLinks({ article: ARTICLE, topic: TOPIC, index: INDEX, embedImpl: mockEmbed, firewallImpl: firewall, max: 3, minScore: 0.1 });
  check("firewall DROPS the contradictory/unsafe candidate", !links.some((l) => l.slug === "selena-profile"));
  check("firewall KEEPS the safe related candidate", links.some((l) => l.slug === "selena-old-romance"));
}

// firewall FAIL-CLOSED: a throwing firewall yields NO links (never crashes, never links on doubt)
{
  const boom = async () => { throw new Error("LLM down"); };
  const links = await findRelatedLinks({ article: ARTICLE, topic: TOPIC, index: INDEX, embedImpl: mockEmbed, firewallImpl: boom, max: 3, minScore: 0.1 });
  check("a throwing firewall fails CLOSED (zero links, no crash)", Array.isArray(links) && links.length === 0);
}

// self-exclusion + max cap + empty cases
{
  const links = await findRelatedLinks({ article: ARTICLE, topic: TOPIC, index: INDEX, embedImpl: mockEmbed, firewallImpl: allSafe, max: 1, minScore: 0.1, selfSlug: "selena-old-romance" });
  check("selfSlug is excluded", !links.some((l) => l.slug === "selena-old-romance"));
  check("max cap respected (1)", links.length <= 1);
}
{
  check("no entities → no links", (await findRelatedLinks({ article: { title: "lowercase only" }, topic: {}, index: INDEX, embedImpl: mockEmbed, firewallImpl: allSafe })).length === 0);
  check("empty index → no links", (await findRelatedLinks({ article: ARTICLE, topic: TOPIC, index: [], embedImpl: mockEmbed, firewallImpl: allSafe })).length === 0);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Step 7 internal links green. ✅\n");
