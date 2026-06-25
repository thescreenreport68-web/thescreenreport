import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "articles");

// Each post -> a relevant entity whose Wikipedia lead image is a FREE (CC/PD) photo,
// plus a JustWatch "where to watch" query.
const MAP = {
  "mcu-movies-in-order": { wiki: "Robert Downey Jr.", name: "Robert Downey Jr.", jw: "Marvel" },
  "oppenheimer-ending-explained": { wiki: "Cillian Murphy", name: "Cillian Murphy", jw: "Oppenheimer" },
  "christopher-nolan-movies-ranked": { wiki: "Christopher Nolan", name: "Christopher Nolan", jw: "Christopher Nolan" },
  "best-a24-movies-ranked": { wiki: "Florence Pugh", name: "Florence Pugh", jw: "A24" },
  "best-sci-fi-movies-streaming": { wiki: "Denis Villeneuve", name: "Denis Villeneuve", jw: "science fiction" },
  "best-limited-series-to-stream": { wiki: "Jodie Comer", name: "Jodie Comer", jw: "limited series" },
  "where-to-watch-harry-potter-movies": { wiki: "Daniel Radcliffe", name: "Daniel Radcliffe", jw: "Harry Potter" },
  "zendaya-movies-and-tv-shows": { wiki: "Zendaya", name: "Zendaya", jw: "Zendaya" },
  "timothee-chalamet-best-movies": { wiki: "Timothée Chalamet", name: "Timothée Chalamet", jw: "Timothee Chalamet" },
  "highest-grossing-movie-of-all-time": { wiki: "James Cameron", name: "James Cameron", jw: "Avatar" },
  "oppenheimer-review": { wiki: "Cillian Murphy", name: "Cillian Murphy", jw: "Oppenheimer" },
  "dune-part-two-review": { wiki: "Austin Butler", name: "Austin Butler", jw: "Dune Part Two" },
  "everything-everywhere-all-at-once-review": { wiki: "Michelle Yeoh", name: "Michelle Yeoh", jw: "Everything Everywhere All at Once" },
  "the-batman-review": { wiki: "Robert Pattinson", name: "Robert Pattinson", jw: "The Batman" },
  "the-bear-review": { wiki: "Jeremy Allen White", name: "Jeremy Allen White", jw: "The Bear" },
  "shogun-review": { wiki: "Hiroyuki Sanada", name: "Hiroyuki Sanada", jw: "Shogun" },
  "margot-robbie-best-movies": { wiki: "Margot Robbie", name: "Margot Robbie", jw: "Margot Robbie" },
  "ryan-gosling-best-movies": { wiki: "Ryan Gosling", name: "Ryan Gosling", jw: "Ryan Gosling" },
  "pedro-pascal-movies-and-tv": { wiki: "Pedro Pascal", name: "Pedro Pascal", jw: "Pedro Pascal" },
  "denis-villeneuve-movies-ranked": { wiki: "Denis Villeneuve", name: "Denis Villeneuve", jw: "Denis Villeneuve" },
  "best-movie-trilogies": { wiki: "Keanu Reeves", name: "Keanu Reeves", jw: "trilogy" },
  "best-heist-movies": { wiki: "George Clooney", name: "George Clooney", jw: "heist" },
  "best-sci-fi-movies-21st-century": { wiki: "Scarlett Johansson", name: "Scarlett Johansson", jw: "science fiction" },
  "best-hbo-shows": { wiki: "Kit Harington", name: "Kit Harington", jw: "HBO" },
  "best-sitcoms-of-all-time": { wiki: "Steve Carell", name: "Steve Carell", jw: "sitcom" },
  "best-true-crime-documentaries": { wiki: "Joe Berlinger", name: "Joe Berlinger", jw: "true crime" },
  "best-movies-on-prime-video": { wiki: "Rachel Brosnahan", name: "Rachel Brosnahan", jw: "Prime Video" },
  "best-shows-on-apple-tv": { wiki: "Jason Sudeikis", name: "Jason Sudeikis", jw: "Apple TV" },
};

async function summary(title) {
  const r = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")), { headers: { accept: "application/json", "user-agent": "TheScreenReport/1.0 (contact@thescreenreport.com)" } });
  if (!r.ok) return null;
  return r.json();
}

async function credit(imgUrl) {
  try {
    const m = imgUrl.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+\.(?:jpg|jpeg|png|gif|svg))/i);
    if (!m) return "Wikimedia Commons";
    const file = decodeURIComponent(m[1]);
    const r = await fetch("https://commons.wikimedia.org/w/api.php?action=query&titles=" + encodeURIComponent("File:" + file) + "&prop=imageinfo&iiprop=extmetadata&format=json&origin=*", { headers: { "user-agent": "TheScreenReport/1.0" } });
    if (!r.ok) return "Wikimedia Commons";
    const j = await r.json();
    const pages = j.query.pages;
    const ex = pages[Object.keys(pages)[0]]?.imageinfo?.[0]?.extmetadata || {};
    const artist = (ex.Artist?.value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const lic = (ex.LicenseShortName?.value || "").replace(/<[^>]+>/g, "").trim();
    let c = artist || "Wikimedia Commons";
    if (lic) c += " / " + lic;
    if (!/wikimedia/i.test(c)) c += " (Wikimedia Commons)";
    return c.slice(0, 150);
  } catch {
    return "Wikimedia Commons";
  }
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md"));
for (const f of files) {
  const slug = f.replace(/\.md$/, "");
  const map = MAP[slug];
  if (!map) { console.log("  ? no map:", slug); continue; }
  try {
    const { data, content } = matter(fs.readFileSync(path.join(DIR, f), "utf8"));
    const s = await summary(map.wiki);
    let img = s?.thumbnail?.source || null;
    if (img) img = img.replace(/\/\d+px-([^/]+)$/, "/1024px-$1");
    else img = s?.originalimage?.source || null;
    const wikiUrl = s?.content_urls?.desktop?.page || "https://en.wikipedia.org/wiki/" + encodeURIComponent(map.wiki.replace(/ /g, "_"));
    if (img) { data.image = img; data.imageCredit = await credit(img); }

    let body = content.trim();
    const intLinks = (body.match(/\]\(\//g) || []).length;
    const hasExt = /\]\(https?:\/\//.test(body);
    if (!hasExt) {
      const jw = "https://www.justwatch.com/us/search?q=" + encodeURIComponent(map.jw);
      body += `\n\n**Further reading:** [${map.name} on Wikipedia](${wikiUrl}) · [Where to watch on JustWatch](${jw}).`;
    }
    fs.writeFileSync(path.join(DIR, f), matter.stringify("\n" + body + "\n", data), "utf8");
    console.log(`  + ${slug}: img=${img ? "YES" : "no"} intLinks=${intLinks} ext=${hasExt ? "had" : "added"} credit="${(data.imageCredit || "").slice(0, 45)}"`);
  } catch (e) {
    console.log("  ! error", slug, String(e).slice(0, 80));
  }
}
console.log("done");
