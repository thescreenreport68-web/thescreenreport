// GOSSIP — BRANDED TYPOGRAPHIC CARD (Phase 4). The hero fallback of last resort: when no og:image, no TMDB
// still, and no embed exists, we previously shipped hero=null — no og:image, no NewsArticle image, and NO
// Google Discover card ("no image = no card"). Now we render a deterministic branded typographic card
// (1200×675, site tokens: paper/ink/red from DESIGN_UPGRADE_SPEC §A1) unique to the article (its own title),
// written to public/gossip-cards/<slug>.png and referenced site-relative (the renderer prefixes SITE.url).
// sharp is a lockfile transitive dep — if it's ever missing, we fall back to the static brand /og.png
// (reused-image penalty accepted over no card at all). No LLM, no network. Fail-soft everywhere.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(__dirname, "../../public/gossip-cards");

const INK = "#101010", RED = "#D92128", PAPER = "#FFFFFF", SLATE = "#5A5A5A";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Greedy word-wrap the title into ≤4 lines that fit the card column.
export function wrapTitle(title, { maxChars = 24, maxLines = 4 } = {}) {
  const words = String(title || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= maxChars || !cur) cur = cand;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[\s,;:—–-]+$/u, "") + "…";
    return kept;
  }
  return lines;
}

export function cardSvg({ title, category = "celebrity" }) {
  const lines = wrapTitle(title);
  const fontSize = lines.length >= 4 ? 72 : lines.length === 3 ? 82 : 92;
  const lineH = Math.round(fontSize * 1.14);
  const startY = 260;
  const titleSpans = lines.map((l, i) => `<text x="90" y="${startY + i * lineH}" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${fontSize}" fill="${INK}">${esc(l)}</text>`).join("");
  return `<svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="675" fill="${PAPER}"/>
  <rect x="0" y="0" width="1200" height="14" fill="${RED}"/>
  <text x="90" y="150" font-family="Georgia, serif" font-weight="700" font-size="30" letter-spacing="6" fill="${RED}">${esc(String(category).toUpperCase())}</text>
  ${titleSpans}
  <rect x="90" y="565" width="72" height="6" fill="${RED}"/>
  <text x="90" y="618" font-family="Georgia, serif" font-weight="700" font-size="34" letter-spacing="3" fill="${INK}">THE SCREEN REPORT</text>
  <text x="1110" y="618" text-anchor="end" font-family="Georgia, serif" font-size="24" fill="${SLATE}">thescreenreport.com</text>
</svg>`;
}

/**
 * Render the card PNG for an article. Returns a hero object (same shape the hero picker emits) or the
 * static-brand fallback if sharp is unavailable, or null only if even that fails.
 */
export async function brandCardHero({ title, category = "celebrity", slug, dir = DEFAULT_DIR, sharpImpl } = {}) {
  try {
    let sharp = sharpImpl;
    if (!sharp) { try { sharp = (await import("sharp")).default; } catch { sharp = null; } }
    if (sharp && slug) {
      fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, `${slug}.png`);
      await sharp(Buffer.from(cardSvg({ title, category }))).png().toFile(fp);
      return {
        kind: "image", src: `/gossip-cards/${slug}.png`, width: 1200, height: 675, orientation: "landscape",
        alt: title, credit: "The Screen Report", caption: "", source: "brand-card", score: null,
        why: "no still/embed resolved — branded typographic card (Discover needs an image)",
      };
    }
  } catch { /* fall through to the static brand image */ }
  // last resort: the site's static brand og image (reused-image penalty < no-card penalty)
  return {
    kind: "image", src: "/og.png", width: 1200, height: 630, orientation: "landscape",
    alt: title, credit: "The Screen Report", caption: "", source: "brand-static", score: null,
    why: "no still/embed and no sharp — static brand image",
  };
}
