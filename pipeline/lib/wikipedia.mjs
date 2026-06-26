// Grounding facts from Wikipedia/Wikidata (free, no key). Used to anchor generation so the model
// writes from real facts, not memory — the anti-hallucination layer.
const UA = "The Screen Report/1.0 (https://thescreenreport.com; editor@thescreenreport.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function wikiSummary(title) {
  try {
    const r = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(title.replace(/ /g, "_")),
      { headers: { "User-Agent": UA, accept: "application/json" } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (j.type === "disambiguation" || !j.extract) return null;
    return {
      title: j.title,
      extract: j.extract,
      url: j.content_urls?.desktop?.page,
      wikidata: j.wikibase_item || null,
      type: j.description || "",
    };
  } catch (e) {
    return null;
  }
}

// Full plain-text article extract (Plot, Themes, Reception, Cast…) for deep grounding on
// the primary subject — this is what stops models inventing plot/dialogue from memory.
export async function wikiFullExtract(title) {
  try {
    const u =
      "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=" +
      encodeURIComponent(title);
    const r = await fetch(u, { headers: { "User-Agent": UA, accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const p = Object.values(j.query?.pages || {})[0];
    if (!p || !p.extract) return null;
    let text = p.extract;
    const words = text.split(/\s+/);
    if (words.length > 4000) text = words.slice(0, 4000).join(" ") + " …";
    return {
      title: p.title,
      extract: text,
      url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")),
    };
  } catch (e) {
    return null;
  }
}

// Gather grounded facts: FULL article for the primary subject (entities[0]), summaries for the rest.
export async function gatherFacts(entities) {
  const out = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e) continue;
    const s = i === 0 ? (await wikiFullExtract(e)) || (await wikiSummary(e)) : await wikiSummary(e);
    if (s?.extract) out.push(s);
    await sleep(150);
  }
  return out;
}
