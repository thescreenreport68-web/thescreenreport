import {
  Fraunces,
  Playfair_Display,
  DM_Serif_Display,
  Libre_Caslon_Display,
  Source_Serif_4,
} from "next/font/google";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
  style: ["normal", "italic"],
  display: "swap",
});
const playfair = Playfair_Display({ subsets: ["latin"], style: ["normal", "italic"], display: "swap" });
const dmSerif = DM_Serif_Display({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap" });
const libreCaslon = Libre_Caslon_Display({ subsets: ["latin"], weight: "400", display: "swap" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], display: "swap" });

const BODY = sourceSerif.style.fontFamily;

const OPTIONS = [
  {
    id: "A",
    name: "Fraunces — tuned (NOW LIVE)",
    ff: fraunces.style.fontFamily,
    vs: '"SOFT" 0, "WONK" 0',
    note: "Warm + high-contrast, the free Kepler match. This is what's now applied across the whole site. My recommendation.",
  },
  {
    id: "B",
    name: "Playfair Display",
    ff: playfair.style.fontFamily,
    vs: undefined,
    note: "Classic high-contrast Didone. Elegant but cooler — trends closer to the Bodoni feel you didn't like.",
  },
  {
    id: "C",
    name: "DM Serif Display",
    ff: dmSerif.style.fontFamily,
    vs: undefined,
    note: "Refined high-contrast display serif. Tighter and a touch more generic; no matching body cut.",
  },
  {
    id: "D",
    name: "Libre Caslon Display",
    ff: libreCaslon.style.fontFamily,
    vs: undefined,
    note: "Warm newspaper Caslon. High contrast with old-style warmth — the closest runner-up to Fraunces-tuned.",
  },
];

export const metadata = { title: "Type Test" };

export default function TypePreview() {
  return (
    <div className="container-wide py-10">
      <header className="mb-10 max-w-2xl">
        <p className="kicker">The Screen Report · Type Test v2</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-navy">
          The premium serif options
        </h1>
        <p className="mt-3 font-sans text-navy/70">
          All four are warm, high-contrast editorial serifs (no more plain ones).
          Same layout each time — judge only the headline. <strong>Option A
          (Fraunces, tuned) is now live across the site</strong> and is my pick; the
          others are here so you can compare. Reply with the letter you want.
        </p>
      </header>

      <div className="space-y-16">
        {OPTIONS.map((o) => (
          <section key={o.id} className="border-t-2 border-navy pt-6">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
              <h2
                style={{ fontFamily: o.ff, fontVariationSettings: o.vs }}
                className="text-2xl font-semibold text-navy"
              >
                Option {o.id} — {o.name}
              </h2>
              <p className="max-w-md font-sans text-xs text-faint sm:text-right">
                {o.note}
              </p>
            </div>

            <div
              style={{ fontFamily: o.ff, fontVariationSettings: o.vs }}
              className="mb-7 text-2xl font-semibold italic text-navy"
            >
              The Screen Report<span className="not-italic text-gold">.</span>
            </div>

            <div className="grid gap-8 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="kicker">Movies</p>
                <h3
                  style={{ fontFamily: o.ff, fontVariationSettings: o.vs }}
                  className="mt-1.5 text-4xl font-semibold leading-[1.08] tracking-tight text-navy sm:text-5xl"
                >
                  Oppenheimer Ending Explained: The Quote That Haunts the Final
                  Scene
                </h3>
                <p
                  style={{ fontFamily: o.ff, fontVariationSettings: o.vs }}
                  className="mt-3 text-xl italic text-navy/70"
                >
                  Christopher Nolan&apos;s closing exchange reframes the entire film
                  — here&apos;s what it really means.
                </p>
                <p className="mt-3 font-sans text-xs uppercase tracking-wide text-faint">
                  By Jordan Hale · 6 min read
                </p>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="kicker">Celebrity</p>
                  <h4
                    style={{ fontFamily: o.ff, fontVariationSettings: o.vs }}
                    className="mt-1 text-xl font-semibold leading-tight text-navy"
                  >
                    Zendaya&apos;s Movies and TV Shows: The Complete Guide
                  </h4>
                </div>
                <div className="border-t border-hair pt-4">
                  <p className="kicker">TV</p>
                  <h4
                    style={{ fontFamily: o.ff, fontVariationSettings: o.vs }}
                    className="mt-1 text-xl font-semibold leading-tight text-navy"
                  >
                    The Best Limited Series to Stream Right Now
                  </h4>
                </div>
                <div className="border-t border-hair pt-4">
                  <p className="kicker">Reviews</p>
                  <h4
                    style={{ fontFamily: o.ff, fontVariationSettings: o.vs }}
                    className="mt-1 text-xl font-semibold leading-tight text-navy"
                  >
                    Dune: Part Two Review — A Blockbuster With a Soul
                  </h4>
                </div>
              </div>
            </div>

            <div className="mt-9 max-w-2xl">
              <h3
                style={{ fontFamily: o.ff, fontVariationSettings: o.vs }}
                className="border-b border-navy/15 pb-2 text-2xl font-semibold text-navy"
              >
                Reviews
              </h3>
              <p
                style={{ fontFamily: BODY }}
                className="mt-3 text-[1.05rem] leading-relaxed text-ink2"
              >
                This paragraph stays in the body serif so you only judge the headline
                font above it. The Hollywood Reporter pairs one warm, high-contrast
                serif (Kepler) with the Karla grotesque for labels — used sparingly,
                never flashy. Option A recreates that exact pairing with free,
                self-hosted fonts.
              </p>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
