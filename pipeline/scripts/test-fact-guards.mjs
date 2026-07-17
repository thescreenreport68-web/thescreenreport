// DEV-ONLY unit test (no network): the 2026-07-17 12h-audit root-cause fixes, each proven against the
// ACTUAL live defect that shipped. Suites: 1 fabricated-quote/date anchors · 2 Sources hygiene ·
// 3 placeholder URLs · 4 the "Power:: Origins" entityFidelity bug · 5 the 7 short/fragment metaTitles ·
// 6 the "No. 2" metaDescription split · 7 outlet-name anchor hijack · 8 dangling-corp truncation.
import { quoteAnchored, datesAnchored, anchorGuards, cleanSourcesSection, sanitizeBareUrls } from "../lib/factGuards.mjs";
import { entityFidelity, finishMetaTitle, finishMetaDescription } from "../lib/seoFinish.mjs";
import { isBadAnchor } from "../lib/internalLinks.mjs";
import { trimIncomplete } from "../lib/polish.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };

console.log("=== 1. anchor guards — the fabricated Jagger quote + invented Oct-25 date ===");
{
  const bundle = "Mick Jagger told Billboard: “We had, from Hackney Diamonds, three songs we didn't put on purposely, because we knew we wanted to save them.” The band spoke at length about the new record and the sessions that produced it, including the material held back from the previous album cycle. Ariana Grande's casting was announced on October 31, 2025 by FX during its Halloween presentation, alongside the rest of the ensemble for the new season. The premiere is September 24, 2026, the network confirmed, with production already underway in Los Angeles and additional casting news expected in the coming weeks as the marketing campaign begins.";
  const art = {
    body: "Jagger explained the delay. “We finished it last year, but the record company wasn't ready to get into promotion mode for the new album,” he said.\nHe added: “We had, from Hackney Diamonds, three songs we didn't put on purposely, because we knew we wanted to save them.”\nThe casting was announced on October 25, 2025. The premiere is September 24, 2026.",
    keyTakeaways: ["The casting was announced on October 25, 2025.", "The premiere is set for September 24, 2026."],
    faq: [{ q: "When was it announced?", a: "It was announced on October 25, 2025. The premiere is September 24, 2026." }],
    pullQuote: { text: "It's not a new thing to be using technology in the studio. The studio is technology." },
  };
  const { article: a, cuts } = anchorGuards(art, bundle);
  ok(!/promotion mode/.test(a.body), "fabricated quote CUT from body");
  ok(/wanted to save them/.test(a.body), "REAL sourced quote kept");
  ok(!/October 25/.test(a.body) && /September 24, 2026/.test(a.body), "invented date cut, sourced date kept");
  ok(a.keyTakeaways.length === 1 && /September 24/.test(a.keyTakeaways[0]), "invented-date takeaway dropped");
  ok(!/October 25/.test(a.faq[0]?.a || ""), "invented date cut from FAQ answer");
  ok(a.pullQuote === undefined, "unanchored pullQuote dropped");
  ok(cuts.length >= 3, `cuts logged (${cuts.length})`);
  const same = anchorGuards(art, "too thin");
  ok(same.article.body === art.body, "fail-open: no bundle text → no cuts");
}

console.log("=== 2. Sources hygiene — internal links are fabricated attribution ===");
{
  const body = "Real prose here.\n\n## Sources\n- [Billboard](/music/clave-especial-discuss-american-and-mexican-music-influence-on-their-work/)\n- [Variety](https://variety.com/2026/real-story/)\n- Billboard";
  const out = cleanSourcesSection(body);
  ok(!/clave-especial/.test(out), "internal-link bullet dropped");
  ok(/variety\.com\/2026/.test(out), "real external bullet kept");
  ok(!/^\s*-\s*Billboard\s*$/m.test(out), "linkless bullet dropped");
  const out2 = cleanSourcesSection("Prose.\n\n## Sources\n- [Billboard](/music/x/)");
  ok(!/## Sources/.test(out2), "fully-emptied Sources section removed");
  ok(cleanSourcesSection("No sources section here.") === "No sources section here.", "no section → untouched");
}

console.log("=== 3. placeholder URLs — bare instagram.com homepage is not a source ===");
{
  const v = sanitizeBareUrls({ officialPost: { platform: "Instagram", url: "https://www.instagram.com/" }, sourceUrl: "https://variety.com/2026/tv/news/real/", nested: [{ link: "https://x.com" }] });
  ok(v.officialPost.url === undefined, "bare homepage url dropped");
  ok(v.sourceUrl === "https://variety.com/2026/tv/news/real/", "real deep url kept");
  ok(v.nested[0].link === undefined, "nested bare url dropped");
}

console.log("=== 4. entityFidelity — the LIVE 'Power:: Origins' corruption can never recur ===");
{
  const art = { title: "Power: Origins Drops First Look at Young Ghost and Tommy", body: "Power: Origins premieres on Starz. The Power: Origins cast spoke." };
  const out = entityFidelity(art, "Power: Origins");
  ok(!/::/.test(JSON.stringify(out)), "no double colon introduced (colon-token bug fixed)");
  ok(out.title === art.title, "title byte-identical");
  const out2 = entityFidelity({ title: "The Proud Family: Louder and Prouder Drops Trailer", body: "The Proud Family: Louder and Prouder returns." }, "The Proud Family: Louder and Prouder");
  ok(!/::/.test(JSON.stringify(out2)), "Proud Family case clean too");
}

console.log("=== 5. finishMetaTitle — the 7 LIVE short/fragment metaTitles ===");
{
  const cases = [
    ["Netflix's First New Zealand Series", "Netflix Unveils Queenstown, Its First Original Series Commissioned in New Zealand"],
    ["'Heartstopper Forever' Movie Releases on", "Heartstopper Finale Premieres, Ending Netflix's Groundbreaking YA Series"],
    ["Lorde Criticizes Spotify AI Feature", "Lorde Criticizes Spotify's AI 'About the Song' Feature Over Inaccuracy"],
    ["Anthony Ippolito Signs With CAA", "Anthony Ippolito Signs With CAA Following 'I Play Rocky' Trailer"],
    ["Ava DuVernay's New Documentary", "Ava DuVernay Returns to Documentaries with Netflix's '14th"],
    ["Carly Rae Jepsen Releases New Single", "Carly Rae Jepsen Drops New Single 'After All' Ahead of Double Album"],
    ["Ryan Reynolds & Kenneth Branagh", "Ryan Reynolds & Kenneth Branagh Team Up in Apple's 'Mayday' Trailer"],
  ];
  const FRAG = /\b(the|a|an|in|on|of|for|with|and|to|at|by|from|releases|joins?|casts|sets|says|reveals|new)$|['’]s$|[,;:&–—-]$/i;
  for (const [model, title] of cases) {
    const t = finishMetaTitle({ model, title });
    ok(t.length >= 45 && t.length <= 65 && !FRAG.test(t), `45-65 + clean (${t.length}): "${t}"`);
  }
}

console.log("=== 6. metaDescription — 'No. 2 on the Billboard 200' never splits into an orphan ===");
{
  const d = finishMetaDescription({
    model: "Post Malone shared a new music clip on Instagram that signals a return to his rap roots for his next album, 'The Eternal Buzz.'",
    dek: "His last hip-hop album Twelve Carat Toothache debuted at No. 2 on the Billboard 200 and fans have wanted a return ever since that release.",
    bodyText: "",
  });
  // the LIVE bug: the orphan "2 on the Billboard 200." glued after the model's closing quote — legitimate
  // in-sentence "No. 2 on the Billboard 200" must still be allowed.
  ok(!/Buzz\.['’]?\s+\d+ on the Billboard/.test(d) && !/^\d+ on the/.test(d), `no orphan number fragment: "${d.slice(-60)}"`);
  ok(d.length <= 160 && /[.!?…]$/.test(d), `in range + complete sentence (${d.length})`);
}

console.log("=== 7. internal-link anchors — outlets/platforms/generics can never be anchors ===");
{
  for (const bad of ["Billboard", "Variety", "Deadline", "The Hollywood Reporter", "Disney Plus", "Netflix", "Season 3", "Instagram", "Billboard 200", "AOL"]) ok(isBadAnchor(bad), `"${bad}" rejected`);
  for (const good of ["Zendaya", "The Odyssey", "Christopher Nolan", "Dexter: Resurrection"]) ok(!isBadAnchor(good), `"${good}" allowed`);
}

console.log("=== 8. dangling-corp truncation — the LIVE Brian Tyler cut-off clause ===");
{
  const body = "Brian Tyler sold his rights.\n\nThe deal is large. The company, which also owns rights to music catalogs from Warner Bros.\n\n## Sources\n- [x](https://example.com/a)";
  const out = trimIncomplete(body);
  ok(!/which also owns rights to music catalogs from Warner Bros\.\s*$/m.test(out.split("\n\n")[1] || ""), "cut-off relative clause trimmed");
  ok(/The deal is large\./.test(out), "complete sentence before it kept");
  const keep = trimIncomplete("The company acquired catalogs from Warner Bros. The deal closed Tuesday.");
  ok(/Warner Bros\./.test(keep) && /closed Tuesday/.test(keep), "legitimate 'Warner Bros.' mid-paragraph untouched");
}

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
