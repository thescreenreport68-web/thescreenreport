// Generate public/_redirects from redirects.json (ONE STORY = ONE URL consolidation).
// Runs in prebuild; Next copies public/ into out/, and both deploy targets (Workers
// static assets + Cloudflare Pages) natively serve _redirects as real 301s.
// Guards: valid paths, no duplicate 'from', never shadow a live article file,
// and a loud warning near the platform's 2,000-static-rule ceiling.
import fs from "node:fs";
import path from "node:path";

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "redirects.json"), "utf8"));
const rules = manifest.redirects ?? [];
const seen = new Set();
const lines = [];
let fatal = false;

for (const r of rules) {
  const from = String(r.from ?? ""), to = String(r.to ?? "");
  if (!from.startsWith("/") || !to.startsWith("/") || from === to) {
    console.error(`redirects: INVALID entry ${JSON.stringify(r)}`); fatal = true; continue;
  }
  if (seen.has(from)) { console.error(`redirects: DUPLICATE from ${from}`); fatal = true; continue; }
  seen.add(from);
  // never shadow a URL that still has a real article file
  const slug = from.replace(/^\/[^/]+\//, "").replace(/\/$/, "");
  if (slug && (fs.existsSync(path.join("content", "articles", `${slug}.md`)) || fs.existsSync(path.join("content", "articles", `${slug}.mdx`)))) {
    console.error(`redirects: ${from} still has a live article file — remove the .md when retiring a URL`); fatal = true; continue;
  }
  lines.push(`${from} ${to} 301`);
}

if (fatal) process.exit(1);
if (lines.length > 1500) console.warn(`::warning::_redirects has ${lines.length} rules — platform static cap is 2,000; plan a consolidation of the manifest`);
fs.writeFileSync(path.join(process.cwd(), "public", "_redirects"), lines.join("\n") + "\n");
console.log(`_redirects: ${lines.length} rule(s) written`);
