import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "About The Screen Report — who we are and what we cover.",
};

export default function AboutPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-serif text-4xl font-bold text-navy">
        About The Screen Report
      </h1>
      <div className="prose prose-screen mt-6 max-w-none">
        <p>
          The Screen Report is a digital publication covering Hollywood and
          English-language movies, television and celebrity culture. We track the
          stories that matter — from tentpole blockbusters and prestige TV to the
          rising stars and streaming releases shaping what audiences watch next.
        </p>
        <p>
          Our goal is simple: get you the answer fast, then give you the depth.
          Every story is built to be accurate, useful and genuinely worth your
          time — whether that&apos;s a watch order, an ending explained, a ranking,
          or breaking news.
        </p>
        <h2>What we cover</h2>
        <ul>
          <li>Movies — reviews, rankings, explainers and release news</li>
          <li>TV — what to watch, recaps and the shows everyone&apos;s talking about</li>
          <li>Streaming — where to watch it and what&apos;s new across platforms</li>
          <li>Celebrity — the stars, their work and the culture around them</li>
        </ul>
        <h2>How we work</h2>
        <p>
          The Screen Report runs an AI-assisted newsroom with human editorial
          oversight. You can read exactly how we research, write, source images and
          handle sensitive claims in our{" "}
          <a href="/editorial-standards/">Editorial Standards</a>.
        </p>
      </div>
    </div>
  );
}
