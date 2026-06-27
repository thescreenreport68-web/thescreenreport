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

// Fetch specific named SECTIONS (e.g. "Box office", "Reception") as clean text — used to deeply
// ground data-heavy niches whose figures/records live in a section past the 4000-word extract cap.
export async function wikiSection(title, wanted = ["Box office", "Reception"]) {
  try {
    const base = "https://en.wikipedia.org/w/api.php";
    const h = { headers: { "User-Agent": UA, accept: "application/json" } };
    const sj = await fetch(`${base}?action=parse&page=${encodeURIComponent(title)}&prop=sections&redirects=1&format=json`, h).then((r) => r.json()).catch(() => null);
    const secs = sj?.parse?.sections || [];
    const out = [];
    for (const name of wanted) {
      const sec =
        secs.find((x) => (x.line || "").toLowerCase() === name.toLowerCase()) ||
        secs.find((x) => (x.line || "").toLowerCase().includes(name.toLowerCase()));
      if (!sec) continue;
      const tj = await fetch(`${base}?action=parse&page=${encodeURIComponent(title)}&section=${sec.index}&prop=text&redirects=1&format=json`, h).then((r) => r.json()).catch(() => null);
      const html = tj?.parse?.text?.["*"] || "";
      const text = html
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<sup[\s\S]*?<\/sup>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&#?\w+;/g, " ")
        .replace(/\[\d+\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (text && text.length > 80) out.push(`${sec.line}: ${text.slice(0, 3500)}`);
      await sleep(120);
    }
    return out.join("\n\n");
  } catch (e) {
    return "";
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
