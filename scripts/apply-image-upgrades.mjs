// Downloads the >=1200px images chosen by the image-upgrade workflow and updates frontmatter.
// Usage: node scripts/apply-image-upgrades.mjs <workflow-output.json>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const OUTPUT = process.argv[2];
const BASE = "/Users/sivajithcu/Movie News site/site";
const ART = path.join(BASE, "content/articles");
const OUTDIR = path.join(BASE, "public/images/articles");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const extMap = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

function jpegSize(buf) {
  let o = 2;
  while (o < buf.length - 8) {
    if (buf[o] !== 0xff) { o++; continue; }
    const m = buf[o + 1];
    if (m === 0xd8 || m === 0xd9 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    const len = buf.readUInt16BE(o + 2);
    const sof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];
    if (sof.includes(m)) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
    o += 2 + len;
  }
  return null;
}
function pngSize(buf) { return buf.length < 24 ? null : { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }
function sizeOf(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return pngSize(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf);
  return null;
}

const data = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
const results = data.result?.results || data.results || [];
let ok = 0, skip = 0;
for (const r of results) {
  if (!r || !r.found || !r.downloadUrl) { console.log("  - skip", r?.slug, "(not found)"); skip++; continue; }
  const mdPath = path.join(ART, r.slug + ".md");
  if (!fs.existsSync(mdPath)) { console.log("  ! no md", r.slug); skip++; continue; }
  let buf = null;
  for (let a = 0; a < 5 && !buf; a++) {
    try {
      const resp = await fetch(r.downloadUrl, { headers: { "user-agent": UA, accept: "image/*" } });
      if (resp.status === 429) { await sleep(2000 * (a + 1)); continue; }
      if (!resp.ok) { console.log("  x", r.slug, resp.status); break; }
      const ct = (resp.headers.get("content-type") || "").split(";")[0].trim();
      const b = Buffer.from(await resp.arrayBuffer());
      if (b.length < 5000) { console.log("  x", r.slug, "too small", b.length); break; }
      const dim = sizeOf(b);
      if (!dim || dim.w < 1200) { console.log("  x", r.slug, "still <1200px:", dim && dim.w); break; }
      const ext = extMap[ct] || ".jpg";
      buf = { b, ext, dim };
    } catch (e) { await sleep(1000); }
  }
  if (!buf) { skip++; continue; }
  // remove any prior file with a different extension
  for (const e of [".jpg", ".png", ".webp", ".gif"]) {
    const old = path.join(OUTDIR, r.slug + e);
    if (e !== buf.ext && fs.existsSync(old)) fs.rmSync(old);
  }
  fs.writeFileSync(path.join(OUTDIR, r.slug + buf.ext), buf.b);
  const ps = matter(fs.readFileSync(mdPath, "utf8"));
  ps.data.image = `/images/articles/${r.slug}${buf.ext}`;
  ps.data.imageWidth = buf.dim.w;
  ps.data.imageHeight = buf.dim.h;
  if (r.credit) ps.data.imageCredit = r.credit;
  fs.writeFileSync(mdPath, matter.stringify("\n" + ps.content.trim() + "\n", ps.data));
  console.log(`  + ${r.slug}: ${buf.dim.w}x${buf.dim.h} ${buf.ext} (${r.subject || ""})`);
  ok++;
  await sleep(300);
}
console.log(`\nupgraded ${ok} images; skipped ${skip}`);
