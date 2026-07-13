// AGENT 2.5 — ENRICHER (owner 2026-07-12): when OUR article alone is too thin to fill a reel,
// pull MORE facts about the SAME people/event from related news coverage, so the writer has enough
// REAL material for a proper-length video. It NEVER pads or invents — it only adds facts, and every
// added fact is re-run through the normal verify gate (entailment against the coverage it came from),
// so an unsupported "fact" is silently dropped. Fully best-effort: any failure returns nothing and
// the story proceeds exactly as before, so this can only ever help, never break the pipeline.
//
// Self-contained (IG-lane rule): the Google-News search is replicated here, not imported cross-lane.
import { IG } from "../config.mjs";
import { llm } from "../models.mjs";
import { stripMarkdown, fetchWithTimeout, normWords } from "../lib/util.mjs";

const UA = "Mozilla/5.0 (TSR enrich)";

const EXTRACT_SYS = `You extract NEW facts about ONE specific story from related news coverage, for a short news reel.
Return STRICT JSON: {"facts":[{"claim":string,"quote":boolean,"surprise":1-10}]}.
RULES: every claim MUST be literally supported by the coverage text below — never infer, guess, or embellish. Only facts about the GIVEN people/event; ignore anything about a different story. quote=true ONLY for verbatim quoted speech copied EXACTLY. Each claim = ONE concrete NEW detail (a date, a number, who said or did what, a place, a real reaction). surprise = how much a fan would care (1-10).`;

const strip = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

// free, keyless Google-News RSS search — returns [{title, url(redirect|null), summary}]
async function gnewsSearch(q) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 8000);
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12).map((m) => {
      const b = m[1];
      const rawLink = strip((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
      return {
        title: strip((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
        url: /^https?:\/\//.test(rawLink) ? rawLink : null,
        summary: strip((b.match(/<description>([\s\S]*?)<\/description>/) || [])[1]).slice(0, 300),
      };
    }).filter((x) => x.title);
  } catch {
    return [];
  }
}

// Mutates `pack`: appends related coverage text to pack.sourceText and merges new, relevance-locked
// facts into pack.facts. Returns { count, queries }. NEVER throws.
export async function enrich(pack) {
  try {
    const entities = pack.entities || [];
    const people = entities.filter((e) => e.kind !== "event").map((e) => e.name).filter(Boolean);
    if (!people.length) return { count: 0 };

    // focused queries: the core people together, and the lead person + the story angle
    const angle = (pack.storyOneLine || "").split(/\s+/).slice(0, 6).join(" ");
    const queries = [...new Set([people.slice(0, 3).join(" "), `${people[0]} ${angle}`].map((q) => q.trim()).filter(Boolean))];

    const seen = new Set();
    let related = "";
    let fullFetches = 0;
    const maxFull = IG.enrich?.maxFullFetches ?? 3;
    for (const q of queries) {
      const items = await gnewsSearch(q);
      for (const it of items.slice(0, 6)) {
        const key = it.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        related += `\n\n${it.title}. ${it.summary || ""}`; // the RSS snippet is always available
        // best-effort deeper fetch (Jina Reader follows the Google-News redirect to the real article)
        if (it.url && fullFetches < maxFull) {
          fullFetches++;
          try {
            const res = await fetchWithTimeout(`https://r.jina.ai/${it.url}`, { headers: { "User-Agent": UA } }, 9000);
            if (res.ok) related += "\n" + stripMarkdown(await res.text()).slice(0, 2500);
          } catch { /* snippet is enough */ }
        }
        if (related.length > 9000) break;
      }
      if (related.length > 9000) break;
    }
    related = related.trim();
    if (related.length < 400) return { count: 0 }; // nothing useful found → story stays as-is

    // extract candidate facts from the related coverage
    let ext;
    try {
      ext = await llm({
        role: "gather",
        system: EXTRACT_SYS,
        user: `STORY: ${pack.storyOneLine || ""}\nPEOPLE/EVENT: ${entities.map((e) => e.name).join(", ")}\nRELATED COVERAGE:\n${related.slice(0, 9000)}`,
        temp: 0,
        maxTokens: 1400,
        json: true,
      });
    } catch {
      return { count: 0 };
    }

    // relevance-lock (must be about OUR entities) + dedup against existing facts
    const entityTokens = new Set(entities.flatMap((e) => normWords(e.name)).filter((t) => t.length > 2));
    const existing = new Set((pack.facts || []).map((f) => normWords(f.claim).slice(0, 6).join(" ")));
    const fresh = (ext.facts || [])
      .filter((f) => {
        if (!f?.claim) return false;
        const toks = normWords(f.claim);
        if (!toks.some((t) => entityTokens.has(t))) return false; // relevance-lock
        const dk = toks.slice(0, 6).join(" ");
        if (existing.has(dk)) return false; // dedup
        existing.add(dk);
        return true;
      })
      // add only ENOUGH to lift a thin story to length — the most surprising few. Flooding the
      // writer with 10+ extra facts makes it cram + overshoot + repeat; a handful is plenty. (2026-07-12)
      .sort((a, b) => (b.surprise || 0) - (a.surprise || 0))
      .slice(0, IG.enrich?.maxAdd ?? 5);
    if (!fresh.length) return { count: 0 };

    // merge: append the coverage so the VERIFIER can entail these facts against it, then merge facts
    pack.facts = [...(pack.facts || []), ...fresh].slice(0, 16);
    pack.sourceText = ((pack.sourceText || "") + "\n\n[RELATED COVERAGE]\n" + related).slice(0, 14000);
    return { count: fresh.length, queries };
  } catch {
    return { count: 0 };
  }
}
