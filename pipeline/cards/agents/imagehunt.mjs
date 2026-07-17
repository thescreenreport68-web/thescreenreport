// IMAGE HUNTER — Tier-A-only sourcing (research §7: composing paparazzi/agency photos
// into native Meta cards is account-fatal; official studio stills/posters/EPK via trade
// CDNs are the safe class). Extracts og:image/twitter:image from the story's OWN source
// articles on whitelisted carriers, validates bytes+width with sharp, and writes a
// provenance record. FAIL CLOSED: no Tier-A image → the story is dropped, never padded.
import sharp from "sharp";
import { CARDS } from "../config.mjs";
import { fetchWithTimeout } from "../lib/util.mjs";
import { dom, MAJORS, isAggregator } from "../../lib/outlets.mjs";

const OG_RE = /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image)["'][^>]+content=["']([^"']+)["']/gi;
const OG_RE_REV = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image)["']/gi;
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };

function carrierAllowed(url) {
  try {
    const h = dom(new URL(url).hostname);
    // any MAJOR outlet's article og:image is a studio press asset (same class as the trade
    // CDNs) — the hand-picked carrier list alone starved legit stories (live drop 2026-07-16)
    if (MAJORS.has(h) && !isAggregator(h)) return true;
    return CARDS.imageTiers.tierACarriers.some((c) => h === c || h.endsWith(`.${c}`));
  } catch { return false; }
}

async function candidatesFrom(articleUrl) {
  if (!carrierAllowed(articleUrl)) return [];
  try {
    const r = await fetchWithTimeout(articleUrl, { headers: UA }, 12000);
    if (!r.ok) return [];
    const html = (await r.text()).slice(0, 400_000);
    const urls = new Set();
    for (const re of [OG_RE, OG_RE_REV]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(html))) urls.add(m[1].replace(/&amp;/g, "&"));
    }
    return [...urls];
  } catch { return []; }
}

async function validate(url) {
  try {
    const r = await fetchWithTimeout(url, { headers: UA }, 15000);
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "";
    if (!/^image\//.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 20_000 || buf.length > 15_000_000) return null;
    const meta = await sharp(buf).metadata();
    if (!meta.width || meta.width < CARDS.imageTiers.minWidth) return null;
    return { buf, width: meta.width, height: meta.height, format: meta.format };
  } catch { return null; }
}

// Collect up to 3 validated candidates — the framing/QC stage rejects composites and
// face-cut crops and moves to the NEXT candidate (owner mandate 2026-07-17: placement
// must be perfect; one bad source image must never ship a bad card).
export async function huntImages(story, pack, { max = 3 } = {}) {
  const found = [];
  const seen = new Set();
  const push = (buf, provenance) => { if (!seen.has(provenance.imageUrl)) { seen.add(provenance.imageUrl); found.push({ buf, provenance }); } };
  // our own published article's hero image first — its lane already vetted it (Tier A-own)
  if (pack.ownHeroUrl) {
    const v = await validate(pack.ownHeroUrl);
    if (v) {
      push(v.buf, {
        imageUrl: pack.ownHeroUrl, articleUrl: `https://thescreenreport.com/${pack.ownSlug}/`, carrier: "thescreenreport.com",
        tier: "A-own", width: v.width, height: v.height, format: v.format,
        fetchedAt: new Date().toISOString(),
        creditLine: pack.ownHeroCredit || "Photo: press asset",
      });
    }
  }
  const articleUrls = [...new Set([...(pack.sourceUrls || []), ...(story.sourceLinks || [])])].slice(0, 4);
  for (const articleUrl of articleUrls) {
    if (found.length >= max) break;
    for (const imgUrl of (await candidatesFrom(articleUrl)).slice(0, 3)) {
      if (found.length >= max) break;
      const v = await validate(imgUrl);
      if (!v) continue;
      const carrier = dom(new URL(articleUrl).hostname);
      push(v.buf, {
        imageUrl: imgUrl, articleUrl, carrier,
        tier: "A", // whitelisted press-asset carrier (og:image of the covering trade article)
        width: v.width, height: v.height, format: v.format,
        fetchedAt: new Date().toISOString(),
        creditLine: `Photo via ${carrier.replace(/\.(com|net|org)$/, "")}`,
      });
    }
  }
  return found; // [] = fail closed — imageless stories don't become cards
}
