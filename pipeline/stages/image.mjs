// Legal image sourcing: find a >=1200px, free-licensed Wikimedia Commons photo of the subject (hotlinked —
// the owner's 2026-07-01 policy forbids re-hosting), return url + dims + credit. The quality gate is the
// >=1200px + free-license requirement; tiny/low-res candidates are rejected.
const UA = "The Screen Report/1.0 (https://thescreenreport.com; editor@thescreenreport.com)";
const FREE = /CC0|CC BY|CC-BY|public domain/i;
// Reject photos from clearly off-topic contexts (the "DiCaprio at a NASA climate event" problem) AND photos that
// are NOT the real person — a fan COSPLAYER in the character's costume (the Kjell-Nilsson-as-Lord-Humungus Comic-Con
// cosplay bug, 2026-07-04), a waxwork, a statue/mural, an action figure, an impersonator/look-alike. Those are never
// an acceptable lead for a real news story about the actual person.
const OFFCTX = /(nasa|climate|summit|congress|senate|parliament|united nations|\bu\.?n\.?\b|military|army|navy|air ?force|olympic|fifa|world cup|nato|davos|economic forum|protest|rally|campaign rally|memorial|funeral|wikimania|hackathon|cosplay|costume|\bfan ?art\b|fanart|impersonat|look.?alike|waxwork|madame tussaud|wax museum|action figure|\bfigurine\b|\bstatue\b|\bmural\b|street art|graffiti|\bmascot\b|\bpop! ?vinyl|funko)/i;
// Prefer photos from film/entertainment contexts. (Bare "comic-con" was REMOVED 2026-07-04 — it boosted fan COSPLAY
// titled by the character; real celebrity con photos still match via red-carpet/panel/portrait/"gage skidmore".)
const FILMCTX = /(premiere|festival|cannes|venice|berlinale|sundance|tiff|red.?carpet|photo.?call|screening|\bpanel\b|portrait|gala|oscars|emmys|golden globes|sxsw|gage skidmore|paley|hollywood|deauville)/i;

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
// WebP dimensions (RIFF….WEBP → VP8 lossy / VP8L lossless / VP8X extended). Many 2024+ CDNs serve WebP; without this
// a valid WebP hero would decode to null and be rejected regardless of its true size.
function webpSize(b) {
  if (b.length < 30 || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const fmt = b.toString("ascii", 12, 16);
  if (fmt === "VP8 ") return { w: ((b[27] << 8) | b[26]) & 0x3fff, h: ((b[29] << 8) | b[28]) & 0x3fff };
  if (fmt === "VP8L") { const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }; }
  if (fmt === "VP8X") return { w: ((b[24] | (b[25] << 8) | (b[26] << 16)) & 0xffffff) + 1, h: ((b[27] | (b[28] << 8) | (b[29] << 16)) & 0xffffff) + 1 };
  return null;
}
const sizeOf = (b) =>
  b[0] === 0x89 && b[1] === 0x50 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  : b[0] === 0xff && b[1] === 0xd8 ? jpegSize(b)
  : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 ? webpSize(b)
  : null;

// Find the best >=1200px free-licensed Commons image matching the query (a person/subject name).
export async function sourceImage(query) {
  try {
    const api =
      "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url|size|extmetadata&format=json&gsrsearch=" +
      encodeURIComponent(query);
    const r = await fetch(api, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(10000) });
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

// MEASURE a remote image WITHOUT re-hosting it — fetch the bytes, read the dimensions, discard. Used by the hotlink
// hero path (owner 2026-07-01: source/paparazzi photos allowed site-wide pre-audience, but HOTLINKED like the gossip
// automation — bytes stay on the origin, the weaker copyright posture — so we measure here but never fs.write the file).
// Timeout-bounded so one slow/stalled outlet can't hang the article (the run loop is sequential).
export async function measureRemote(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "image/*" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 3000) return null;
    const dim = sizeOf(buf);
    if (!dim || !dim.w || !dim.h) return null;
    return { imageWidth: dim.w, imageHeight: dim.h };
  } catch {
    return null;
  }
}
// (downloadImage was removed 2026-07-03: the hotlink-only image policy left it with zero callers —
// heroes are measured remotely via measureRemote and referenced by their origin URL, never re-hosted.)
