import { getAllArticles } from "@/lib/articles";
import { SITE, getCategory } from "@/lib/site";

export const dynamic = "force-static";

// RSS 2.0 feed — latest 50 stories. The site is still noindex + robots-blocked
// pre-launch, so this exposes nothing to Google; at launch it becomes the feed
// for aggregators (and our own downstream automations).
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export async function GET() {
  const items = getAllArticles()
    .slice(0, 50)
    .map((a) => {
      const url = `${SITE.url}/${a.category}/${a.slug}/`;
      const img =
        a.image && a.image.startsWith("http") ? a.image : a.image ? `${SITE.url}${a.image}` : null;
      return `    <item>
      <title>${esc(a.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(a.date).toUTCString()}</pubDate>
      <category>${esc(getCategory(a.category)?.name ?? a.category)}</category>
      <description>${esc(a.dek || a.metaDescription)}</description>${
        img ? `\n      <enclosure url="${esc(img)}" type="image/jpeg" />` : ""
      }
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE.name)}</title>
    <link>${SITE.url}</link>
    <atom:link href="${SITE.url}/feed.xml" rel="self" type="application/rss+xml" />
    <description>${esc(SITE.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
