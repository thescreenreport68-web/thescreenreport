import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const DIR = "content/articles";
const OUT = "public/images/articles";
fs.mkdirSync(OUT, { recursive: true });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const extMap = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md"));
let ok = 0, bad = 0;
for (const f of files) {
  const p = path.join(DIR, f);
  const { data, content } = matter(fs.readFileSync(p, "utf8"));
  const slug = f.replace(/\.md$/, "");
  if (!data.image || !/^https?:/.test(data.image)) { console.log("  skip", slug); continue; }
  let done = false;
  for (let attempt = 0; attempt < 5 && !done; attempt++) {
    try {
      const r = await fetch(data.image, { headers: { "user-agent": UA, accept: "image/*" } });
      if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (!r.ok) { console.log("  ✗", slug, r.status); bad++; break; }
      const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
      const ext = extMap[ct] || ".jpg";
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) { console.log("  ✗", slug, "tiny", buf.length); bad++; break; }
      const fname = slug + ext;
      fs.writeFileSync(path.join(OUT, fname), buf);
      data.image = `/images/articles/${fname}`;
      fs.writeFileSync(p, matter.stringify("\n" + content.trim() + "\n", data), "utf8");
      console.log(`  + ${slug} -> ${fname} ${(buf.length / 1024) | 0}KB`);
      ok++; done = true;
    } catch (e) {
      await sleep(1200);
      if (attempt === 4) { console.log("  ✗", slug, "ERR", String(e).slice(0, 40)); bad++; }
    }
  }
  await sleep(400);
}
console.log(`\ndownloaded ${ok} | failed ${bad}`);
