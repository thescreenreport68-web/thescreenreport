// LEAN image helpers — a decoupled copy of the two functions the picker needs from the news lane's
// stages/image.mjs (measureRemote + sourceImage). Copied (not imported) so the box-office lane never
// reaches into another lane (owner isolation rule). Kept minimal: measure a remote image's real
// dimensions without re-hosting (hotlink policy), and a Commons last-resort search.
const UA = "The Screen Report/1.0 (https://thescreenreport.com; editor@thescreenreport.com)";
const FREE = /CC0|CC BY|CC-BY|public domain/i;
const OFFCTX = /(cosplay|costume|fan ?art|fanart|impersonat|look.?alike|waxwork|madame tussaud|action figure|figurine|statue|mural|graffiti|mascot|funko)/i;

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

// MEASURE a remote image WITHOUT re-hosting (hotlink policy) — fetch bytes, read dims, discard.
export async function measureRemote(url, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(url, { headers: { "user-agent": UA, accept: "image/*" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 3000) return null;
    const dim = sizeOf(buf);
    if (!dim || !dim.w || !dim.h) return null;
    return { imageWidth: dim.w, imageHeight: dim.h };
  } catch { return null; }
}

// Commons last resort — a >=1200px free-licensed photo of the subject/work.
export async function sourceImage(query, { fetchImpl = fetch } = {}) {
  try {
    const api = "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url|size|extmetadata&format=json&gsrsearch=" + encodeURIComponent(query);
    const r = await fetchImpl(api, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const cands = Object.values(j.query?.pages || {})
      .map((p) => { const ii = p.imageinfo?.[0] || {}; return { title: p.title, w: ii.width || 0, h: ii.height || 0, lic: ii.extmetadata?.LicenseShortName?.value || "", artist: (ii.extmetadata?.Artist?.value || "").replace(/<[^>]+>/g, "").trim().slice(0, 80) }; })
      .filter((c) => c.w >= 1200 && FREE.test(c.lic) && !/\.svg$/i.test(c.title) && q.some((t) => c.title.toLowerCase().includes(t)) && !OFFCTX.test(c.title))
      .sort((a, b) => b.w - a.w);
    const pick = cands[0];
    if (!pick) return null;
    const file = pick.title.replace(/^File:/, "");
    return { downloadUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file) + "?width=1600", credit: (pick.artist || "Wikimedia Commons") + " / Wikimedia Commons / " + pick.lic };
  } catch { return null; }
}
