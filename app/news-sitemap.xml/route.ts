import { getAllArticles } from "@/lib/articles";
import { SITE } from "@/lib/site";

// Google News sitemap: per Google's spec it must list ONLY articles created in the
// last 48 hours, max 1,000 URLs, with the <news:news> block. It is regenerated on
// every deploy (the site rebuilds on each publish), so "now" = build time keeps the
// window fresh. Static-exported to /news-sitemap.xml and declared in robots.txt.
export const dynamic = "force-static";

const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const now = Date.now();
  const recent = getAllArticles()
    .filter((a) => a.robots !== "noindex")
    .filter((a) => {
      const t = new Date(a.date).getTime();
      return Number.isFinite(t) && now - t <= TWO_DAYS_MS;
    })
    .slice(0, 1000);

  const urls = recent
    .map(
      (a) => `  <url>
    <loc>${SITE.url}/${a.category}/${a.slug}/</loc>
    <news:news>
      <news:publication>
        <news:name>${esc(SITE.name)}</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${new Date(a.date).toISOString()}</news:publication_date>
      <news:title>${esc(a.title)}</news:title>
    </news:news>
  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
