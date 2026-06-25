import SectionHeader from "./SectionHeader";
import PlaceholderImage from "./PlaceholderImage";

// Placeholder podcast content (none yet) — shows THR's "Podcasts" block design.
const EPISODES = [
  { slug: "pod-awards-race", title: "The Awards Race, Decoded: Who's Really Winning", show: "The Screen Report Podcast" },
  { slug: "pod-streaming-wars", title: "Streaming Wars: What the Mergers Mean for You", show: "The Screen Report Podcast" },
  { slug: "pod-breakout-stars", title: "Breakout Stars of the Year, Ranked", show: "The Screen Report Podcast" },
];

export default function PodcastsBlock() {
  return (
    <section>
      <SectionHeader title="Podcasts" />
      <div className="grid gap-6 sm:grid-cols-3">
        {EPISODES.map((e) => (
          <article key={e.slug} className="group">
            <PlaceholderImage
              slug={e.slug}
              category="celebrity"
              title={e.title}
              className="aspect-square w-full rounded ring-1 ring-navy/10"
            />
            <p className="mt-3 font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-gold-600">
              {e.show}
            </p>
            <h3 className="mt-1 font-display text-base font-semibold leading-snug text-navy">
              {e.title}
            </h3>
          </article>
        ))}
      </div>
    </section>
  );
}
