// NAME → AMERICAN IPA (owner 2026-07-03: any name, pronounced right, no matter what — research
// wf_eedf150f verified live: Wikipedia lead wikitext {{IPAc-en}} covers 5/6 Hollywood names incl.
// Corenswet /ˈkɔːrənswɛt/; REST/extract endpoints STRIP pronunciation — wikitext is the only route;
// template params are diaphoneme KEYS and must be expanded via action=parse&text=).
const UA = { headers: { "user-agent": "TheScreenReport/1.0 (editor@thescreenreport.com)" } };
const getJ = async (u) => {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(u, { ...UA, signal: AbortSignal.timeout(12000) }); if (r.ok) { const t = await r.json(); if (t) return t; } } catch {}
    await new Promise((r) => setTimeout(r, 1500)); // ~5% of MW API calls transiently return empty
  }
  return null;
};

// Wikipedia lead IPA for a person/character name → raw diaphonemic IPA string (or null)
export async function wikiIPA(name) {
  const search = async (q) => (await getJ(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json&origin=*`))?.query?.search || [];
  let hits = await search(`intitle:"${name}"`);
  let title = hits[0]?.title;
  if (!title) return null;
  const sum = await getJ(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  if (sum?.type === "disambiguation") { hits = await search(`intitle:"${name}" actor`); title = hits[0]?.title || title; }
  else if (sum?.description && !/actor|actress|singer|film|television|character|director|musician|rapper|comedian|host|model|author|producer/i.test(sum.description)) return null;
  const wt = (await getJ(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&section=0&prop=wikitext&redirects=1&format=json&origin=*`))?.parse?.wikitext?.["*"];
  if (!wt) return null;
  let tmpl = (wt.match(/\{\{IPAc-en\s*\|[^}]*\}\}/) || [])[0];
  if (!tmpl) return null;
  tmpl = tmpl.replace(/\|\s*audio\s*=\s*[^|}]+/g, ""); // strip audio param before expansion
  const ex = await getJ(`https://en.wikipedia.org/w/api.php?action=parse&text=${encodeURIComponent(tmpl)}&contentmodel=wikitext&prop=text&format=json&origin=*`);
  const plain = String(ex?.parse?.text?.["*"] || "").replace(/<[^>]+>/g, "").replace(/&#\d+;|&\w+;/g, " ");
  const m = plain.match(/\/(?=[^/]*[ˈˌːəɪʊɛɔæŋʃʒθðɜɑɒ])[^/]{2,80}\//);
  return m ? m[0].slice(1, -1).trim() : null;
}

// Wikipedia lead image for ANY person/topic (owner 2026-07-03: directors/showrunners aren't in TMDB —
// Wikipedia has them). Free, no key. Returns a high-res image URL or null. Identity-gated by the caller.
export async function wikiImage(name) {
  const search = async (q) => (await getJ(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=3&format=json&origin=*`))?.query?.search || [];
  let title = (await search(`intitle:"${name}"`))[0]?.title;
  if (!title) return null;
  const sum = await getJ(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  if (sum?.type === "disambiguation") { title = (await search(`${name} film television`))[0]?.title || title; }
  const s2 = await getJ(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  return s2?.originalimage?.source || s2?.thumbnail?.source?.replace(/\/\d+px-/, "/1024px-") || null;
}

// Wikipedia's BrE-leaning diaphonemes → espeak/Kokoro General-American symbols (research step 4)
export function toEspeak(ipa) {
  let t = String(ipa).replace(/\./g, ""); // syllable dots are not in the Kokoro vocab
  t = t.replace(/ɔːr/g, "ɔːɹ").replace(/ɑːr/g, "ɑːɹ").replace(/ɜːr/g, "ɝ").replace(/ɛər/g, "ɛɹ")
    .replace(/ɪər/g, "ɪɹ").replace(/ʊər/g, "ʊɹ").replace(/ər/g, "ɚ")
    .replace(/r/g, "ɹ").replace(/ɒ/g, "ɑː").replace(/g/g, "ɡ").replace(/\s+/g, " ");
  return t.trim();
}
