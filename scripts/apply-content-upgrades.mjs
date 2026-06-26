// Applies the content-upgrade workflow output to the 28 article markdown files.
// Usage: node scripts/apply-content-upgrades.mjs <workflow-output.json>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const OUTPUT = process.argv[2];
const BASE = "/Users/sivajithcu/Movie News site/site";
const ART = path.join(BASE, "content/articles");
const PUB = path.join(BASE, "public");

// minimal intrinsic-size readers (JPEG SOF + PNG IHDR)
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
function dims(imgPath) {
  try {
    const f = path.join(PUB, imgPath.replace(/^\//, ""));
    const buf = fs.readFileSync(f);
    if (buf[0] === 0x89 && buf[1] === 0x50) return pngSize(buf);
    if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf);
  } catch (e) {}
  return null;
}

const data = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
const upgrades = data.result?.upgrades || data.upgrades || [];
let done = 0;
for (const u of upgrades) {
  const p = path.join(ART, u.slug + ".md");
  if (!fs.existsSync(p)) { console.log("  ! missing", u.slug); continue; }
  const parsed = matter(fs.readFileSync(p, "utf8"));
  const fm = parsed.data;
  let body = parsed.content;
  if (u.keyTakeaways?.length) fm.keyTakeaways = u.keyTakeaways;
  if (u.faq?.length) fm.faq = u.faq;
  if (u.about?.length) fm.about = u.about.filter((e) => e && e.name && e.type);
  if (fm.image) { const d = dims(fm.image); if (d) { fm.imageWidth = d.w; fm.imageHeight = d.h; } }
  for (const r of u.h2Rewrites || []) {
    if (!r.from || !r.to) continue;
    body = body.split("## " + r.from).join("## " + r.to).split("### " + r.from).join("### " + r.to);
  }
  body = body.replace(/\[([^\]]+)\]\((https?:\/\/[^)]*justwatch[^)]*)\)/gi, "$1");
  if (u.sources?.length && !/\n##\s+Sources/i.test(body)) {
    const lines = u.sources.filter((s) => s && s.url && s.label).map((s) => `- [${s.label}](${s.url})`);
    if (lines.length) body = body.trim() + "\n\n## Sources\n\n" + lines.join("\n") + "\n";
  }
  fs.writeFileSync(p, matter.stringify("\n" + body.trim() + "\n", fm));
  done++;
  console.log(`  + ${u.slug}: KT ${u.keyTakeaways?.length || 0}, FAQ ${u.faq?.length || 0}, about ${u.about?.length || 0}, sources ${u.sources?.length || 0}, h2 ${u.h2Rewrites?.length || 0}${fm.imageWidth ? `, ${fm.imageWidth}x${fm.imageHeight}` : ""}`);
}

// guarantee image dims on ALL articles (even any the content pass missed)
let dimFixed = 0;
for (const f of fs.readdirSync(ART).filter((x) => x.endsWith(".md"))) {
  const p = path.join(ART, f);
  const ps = matter(fs.readFileSync(p, "utf8"));
  if (ps.data.image && !ps.data.imageWidth) {
    const d = dims(ps.data.image);
    if (d) { ps.data.imageWidth = d.w; ps.data.imageHeight = d.h; fs.writeFileSync(p, matter.stringify("\n" + ps.content.trim() + "\n", ps.data)); dimFixed++; }
  }
}
console.log(`applied ${done}/${upgrades.length} upgrades; backfilled dims on ${dimFixed} more`);
