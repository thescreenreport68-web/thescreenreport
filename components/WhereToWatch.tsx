import SectionHeader from "./SectionHeader";
import PlaceholderImage from "./PlaceholderImage";

// THR's "Shopping with THR" slot, reworked as our affiliate-ready "Where to Watch".
const PICKS = [
  { slug: "wtw-dune-two", title: "Dune: Part Two", where: "Stream on Max", cat: "streaming" },
  { slug: "wtw-oppenheimer", title: "Oppenheimer", where: "Rent on Prime Video", cat: "streaming" },
  { slug: "wtw-the-bear", title: "The Bear", where: "Stream on Hulu", cat: "tv" },
  { slug: "wtw-poor-things", title: "Poor Things", where: "Stream on Hulu", cat: "movies" },
];

export default function WhereToWatch() {
  return (
    <section className="rounded-lg border border-navy/15 p-5 sm:p-6">
      <SectionHeader title="Where to Watch" tagline="Stream it tonight" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PICKS.map((p) => (
          <article key={p.slug}>
            <PlaceholderImage
              slug={p.slug}
              category={p.cat}
              title={p.title}
              className="aspect-[2/3] w-full rounded ring-1 ring-navy/10"
            />
            <h3 className="mt-2 font-display text-base font-semibold leading-snug text-navy">
              {p.title}
            </h3>
            <p className="mt-1 font-sans text-xs font-semibold text-gold-600">
              {p.where}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
