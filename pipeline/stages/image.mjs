// Legal image sourcing: find a >=1200px, free-licensed Wikimedia Commons photo of the subject,
// download it to public/images/articles, return path + dims + credit. The quality gate is the
// >=1200px + free-license requirement; tiny/low-res candidates are rejected.
import fs from "node:fs";
import path from "node:path";

const UA = "The Screen Report/1.0 (https://thescreenreport.com; editor@thescreenreport.com)";
const FREE = /CC0|CC BY|CC-BY|public domain/i;
// Reject photos from clearly off-topic contexts (the "DiCaprio at a NASA climate event" problem).
const OFFCTX = /(nasa|climate|summit|congress|senate|parliament|united nations|\bu\.?n\.?\b|military|army|navy|air ?force|olympic|fifa|world cup|nato|davos|economic forum|protest|rally|campaign rally|memorial|funeral|wikimania|hackathon)/i;
// Prefer photos from film/entertainment contexts.
const FILMCTX = /(premiere|festival|cannes|venice|berlinale|sundance|tiff|comic.?con|red.?carpet|photo.?call|screening|portrait|gala|oscars|emmys|golden globes|sxsw|gage skidmore|paley|hollywood|deauville)/i;
const OUTDIR = "/Users/sivajithcu/Movie News site/site/public/images/articles";
const extMap = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jpegSize(b) {
  let o = 2;
  while (o < b.length - 8) {
    if (b[o] !== 0xff) { o++; continue; }
    const m = b[o + 1];
    if (m === 0xd8 || m === 0xd9 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    const len = b.readUInt16BE(o + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m))
      return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
    o += 2 + len;
  }
  return null;
}
const sizeOf = (b) =>
  b[0] === 0x89 && b[1] === 0x50 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : b[0] === 0xff && b[1] === 0xd8 ? jpegSize(b) : null;

// Find the best >=1200px free-licensed Commons image matching the query (a person/subject name).
export async function sourceImage(query) {
  try {
    const api =
      "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url|size|extmetadata&format=json&gsrsearch=" +
      encodeURIComponent(query);
    const r = await fetch(api, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const cands = Object.values(j.query?.pages || {})
      .map((p) => {
        const ii = p.imageinfo?.[0] || {};
        return {
          title: p.title,
          w: ii.width || 0,
          h: ii.height || 0,
          lic: ii.extmetadata?.LicenseShortName?.value || "",
          artist: (ii.extmetadata?.Artist?.value || "").replace(/<[^>]+>/g, "").trim().slice(0, 80),
        };
      })
      .filter(
        (c) =>
          c.w >= 1200 &&
          FREE.test(c.lic) &&
          !/\.svg$/i.test(c.title) &&
          q.some((t) => c.title.toLowerCase().includes(t)) &&
          !OFFCTX.test(c.title) // reject off-context photos
      )
      .map((c) => ({
        ...c,
        // relevance score: film/entertainment context + portrait orientation + reasonable size
        score:
          (FILMCTX.test(c.title) || FILMCTX.test(c.artist) ? 3 : 0) +
          (c.h >= c.w ? 1 : 0) +
          Math.min(2, c.w / 2000),
      }))
      .sort((a, b) => b.score - a.score || b.w - a.w);
    const pick = cands[0];
    if (!pick) return null;
    const file = pick.title.replace(/^File:/, "");
    return {
      downloadUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file) + "?width=1600",
      credit: (pick.artist || "Wikimedia Commons") + " / Wikimedia Commons / " + pick.lic,
      origW: pick.w,
      origH: pick.h,
    };
  } catch (e) {
    return null;
  }
}

export async function downloadImage({ url, slug }) {
  fs.mkdirSync(OUTDIR, { recursive: true });
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "image/*" } });
      if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
      if (!r.ok) return null;
      const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 5000) return null;
      const dim = sizeOf(buf);
      if (!dim || dim.w < 1200) return null;
      const ext = extMap[ct] || ".jpg";
      for (const e of [".jpg", ".png", ".webp", ".gif"]) {
        const old = path.join(OUTDIR, slug + e);
        if (e !== ext && fs.existsSync(old)) fs.rmSync(old);
      }
      fs.writeFileSync(path.join(OUTDIR, slug + ext), buf);
      return { image: `/images/articles/${slug}${ext}`, imageWidth: dim.w, imageHeight: dim.h };
    } catch (e) {
      await sleep(1000);
    }
  }
  return null;
}
