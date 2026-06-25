import PlaceholderImage from "./PlaceholderImage";
import SectionHeader from "./SectionHeader";

// Placeholder video content (we have no video yet) — shows THR's "Featured Videos"
// block design: one big player + a side list of smaller thumbnails, with play overlays.
const VIDEOS = [
  { slug: "vid-actors-roundtable", title: "The Drama Actors Roundtable: Six Stars, One Table", cat: "celebrity" },
  { slug: "vid-directors-craft", title: "Directors on Craft: Building the Year's Biggest Scenes", cat: "movies" },
  { slug: "vid-breakout-interview", title: "The Breakout Interview: A Star on the Rise", cat: "celebrity" },
  { slug: "vid-on-set-streaming", title: "On Set: Inside the Next Big Streaming Hit", cat: "streaming" },
  { slug: "vid-trailer-breakdown", title: "Trailer Breakdown: Every Detail You Missed", cat: "movies" },
];

function Play({ large = false }: { large?: boolean }) {
  const size = large ? "h-16 w-16" : "h-8 w-8";
  return (
    <span
      className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/90 bg-black/30 ${size}`}
    >
      <span
        className={`ml-0.5 border-y-transparent border-l-white ${
          large ? "border-y-[9px] border-l-[15px]" : "border-y-[5px] border-l-[8px]"
        }`}
        style={{ borderStyle: "solid", borderRightWidth: 0 }}
      />
    </span>
  );
}

export default function FeaturedVideos() {
  const [lead, ...rest] = VIDEOS;
  return (
    <section>
      <SectionHeader title="Featured Videos" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="relative">
            <PlaceholderImage slug={lead.slug} category={lead.cat} title={lead.title} className="aspect-video w-full rounded ring-1 ring-navy/10" />
            <Play large />
          </div>
          <h3 className="mt-3 font-body text-2xl font-normal leading-tight text-navy">
            {lead.title}
          </h3>
        </div>
        <div className="space-y-4">
          {rest.map((v) => (
            <div key={v.slug} className="flex gap-3">
              <div className="relative shrink-0">
                <PlaceholderImage slug={v.slug} category={v.cat} title={v.title} className="aspect-video w-28 rounded ring-1 ring-navy/10" />
                <Play />
              </div>
              <h4 className="font-body text-sm font-normal leading-snug text-navy">
                {v.title}
              </h4>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
