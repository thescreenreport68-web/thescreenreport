// AGENT 2 — GATHERER: deep-collect the story into a strict fact pack (plan §2.2 #2).
// Source of truth = OUR OWN published article (it already passed the news lane's verify
// gates) + best-effort fetch of its source URLs for extra texture. Verbatim quotes only.
import fs from "node:fs";
import path from "node:path";
import { IG } from "../config.mjs";
import { llm } from "../models.mjs";
import { parseFrontmatter, stripMarkdown, fetchWithTimeout, OUTLET_RE } from "../lib/util.mjs";

const SYS = `You extract facts for a 30-second Instagram news reel. From the article (and optional source excerpts), return STRICT JSON:
{"facts":[{"claim":string,"quote":boolean,"surprise":1-10}],
 "entities":[{"name":string,"kind":"person"|"movie"|"tv"|"event"|"other","role":string,"searchTerms":string}],
 "numbers":[string], "storyOneLine":string, "mood":"celebratory"|"tense"|"somber"|"fun"|"epic"|"neutral"}
RULES: every claim must be literally supported by the given text — never infer, never embellish. quote=true ONLY for verbatim quoted speech, copied EXACTLY character-for-character. surprise = how much a fan would gasp. entities: only people/titles that MATTER to this story (max 6) — AND if the story centers on an EVENT (a wedding, premiere, award show, festival, set/filming, red carpet), include it as ONE entity with kind "event" and a short name people would say ("the wedding", "the premiere"). searchTerms: 3-6 words someone would type to find IMAGES of this exact entity/event ("Travis Kelce Taylor Swift wedding"). numbers: every figure with its unit exactly as written.`;

export async function gather(article) {
  const raw = fs.readFileSync(path.join(IG.articlesDir, `${article.slug}.md`), "utf8");
  const { data, body } = parseFrontmatter(raw);
  const text = stripMarkdown(body).slice(0, 9000);
  let sourceText = "";
  for (const url of (article.sourceUrls || []).slice(0, 2)) {
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0 (TSR fetch)" } }, 8000);
      if (res.ok) {
        const html = await res.text();
        sourceText += "\n\n" + stripMarkdown(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ")).slice(0, 3000);
      }
    } catch { /* best-effort — the article alone is sufficient */ }
  }
  const pack = await llm({
    role: "gather",
    system: SYS,
    user: `ARTICLE TITLE: ${data.title}\nARTICLE:\n${text}${sourceText ? `\n\nSOURCE EXCERPTS (secondary):${sourceText}` : ""}`,
    temp: 0,
    maxTokens: 2000,
    json: true,
  });
  pack.articleText = text; // kept in the job for the verifier's entailment pass
  pack.sourceText = sourceText.trim(); // quotes may come from here — verify against BOTH
  pack.facts = (pack.facts || []).slice(0, 14);
  // OUTLET GUARD (owner audit 2026-07-16): a news outlet must never become an entity — entity names
  // flow into hashtags (#ENews shipped), image searches, and the script's subject line. Drop any
  // entity whose name matches the shared outlet blocklist regardless of the kind the model gave it.
  pack.entities = (pack.entities || []).filter((e) => !OUTLET_RE.test(String(e?.name || ""))).slice(0, 6);
  return pack;
}
