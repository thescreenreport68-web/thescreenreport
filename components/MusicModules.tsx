import type { Article } from "@/lib/articles";
import YouTubeEmbed from "@/components/embed/YouTubeEmbed";
import { SectionLabel } from "@/components/NicheModules";

/* Music silo UI (decided 2026-06-28). Renders the music structured fields on the shared article base.
   Embed-only + legal: official streaming players via lazy iframes (never re-hosted audio); cover art is
   surfaced by the player itself. Facts-only — no taste verdicts. Dispatched by formatTag from NicheModules. */

/* ---------- Unified streaming embed (lazy, embed-only) ---------- */
function youTubeId(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(url) ? url : null;
}
// Normalize a public track URL to its official EMBED player src (never re-hosts media).
function embedSrc(platform?: string, url?: string): string | null {
  if (!url) return null;
  const p = (platform || "").toLowerCase();
  if (p.includes("spotify") || url.includes("spotify.com")) {
    return url.includes("/embed/") ? url : url.replace("open.spotify.com/", "open.spotify.com/embed/");
  }
  if (p.includes("apple") || url.includes("music.apple.com")) {
    return url.replace("music.apple.com", "embed.music.apple.com");
  }
  if (p.includes("soundcloud") || url.includes("soundcloud.com")) {
    return url.includes("w.soundcloud.com") ? url : `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23d92128`;
  }
  if (p.includes("bandcamp") || url.includes("bandcamp.com")) return url; // artist-provided embed url
  return null;
}
function EmbedPlayer({ platform, url, title }: { platform?: string; url?: string; title?: string }) {
  const yt = youTubeId(url);
  if (yt || (platform || "").toLowerCase().includes("youtube")) {
    return yt ? <YouTubeEmbed id={yt} title={title || "Official video"} /> : null;
  }
  const src = embedSrc(platform, url);
  if (!src) return null;
  const tall = src.includes("apple") || src.includes("bandcamp");
  return (
    <iframe
      src={src}
      title={title || "Official player"}
      loading="lazy"
      allow="encrypted-media; clipboard-write; fullscreen; picture-in-picture"
      className="w-full border border-hair"
      style={{ height: tall ? 175 : 152 }}
    />
  );
}

/* ---------- music-news: release callout + tracklist + tour table ---------- */
function ReleaseInfoBox({ article }: { article: Article }) {
  const r = article.release;
  const t = article.ticketInfo;
  const rows = r
    ? ([
        ["Title", r.title],
        ["Type", r.type],
        ["Release", r.date],
        ["Label", r.label],
        ["On sale", t?.onSale],
        ["Presale", t?.presale],
        ["Listen on", t?.streamOn],
      ].filter(([, v]) => v) as [string, string][])
    : [];
  const post = article.officialPost;
  if (!rows.length && !post?.url) return null;
  return (
    <div className="my-6 not-prose border border-hair p-5">
      {rows.length ? (
        <>
          <SectionLabel>The Drop</SectionLabel>
          <dl className="divide-y divide-hair">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-3 py-1.5">
                <dt className="w-28 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{k}</dt>
                <dd className="font-body text-[1.02rem] text-navy">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {post?.url ? (
        <div className={rows.length ? "mt-4" : ""}>
          <EmbedPlayer platform={post.platform} url={post.url} title={article.title} />
        </div>
      ) : null}
    </div>
  );
}

function Tracklist({ tracklist }: { tracklist: NonNullable<Article["tracklist"]> }) {
  if (!tracklist?.length) return null;
  return (
    <aside className="my-6 not-prose border border-hair p-5">
      <SectionLabel>Tracklist</SectionLabel>
      <ol className="space-y-1">
        {tracklist.map((t, i) => (
          <li key={i} className="flex gap-3 font-body text-[1.02rem] leading-snug text-navy">
            <span className="w-6 flex-none font-sans text-sm font-bold text-breaking">{i + 1}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function TourDateTable({ tourDates }: { tourDates: NonNullable<Article["tourDates"]> }) {
  if (!tourDates?.length) return null;
  return (
    <section className="mt-10 not-prose">
      <div className="mb-3 border-b-2 border-navy pb-1">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy">Tour Dates</h2>
      </div>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-hair font-sans text-[11px] uppercase tracking-[0.06em] text-slate">
            <th className="py-2 pr-3">Date</th>
            <th className="py-2 pr-3">City</th>
            <th className="py-2 pr-3">Venue</th>
            <th className="py-2">Support</th>
          </tr>
        </thead>
        <tbody>
          {tourDates.map((d, i) => (
            <tr key={i} className="border-b border-dotted border-slate/40 align-top">
              <td className="py-2 pr-3 font-sans text-sm text-slate">{d.date || "—"}</td>
              <td className="py-2 pr-3 font-body text-[1.02rem] font-semibold text-navy">{d.city || "—"}</td>
              <td className="py-2 pr-3 font-body text-[1.02rem] text-navy">{d.venue || "—"}</td>
              <td className="py-2 font-body text-[1.02rem] text-slate">{d.support || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ---------- music-profile: fact panel + career arc ---------- */
function MusicFactPanel({ article }: { article: Article }) {
  const f = article.factPanel as { realName?: string; origin?: string; activeYears?: string; knownFor?: string[] } | undefined;
  if (!f) return null;
  const rows: [string, string | undefined][] = [
    ["Name", f.realName],
    ["From", f.origin],
    ["Active", f.activeYears],
    ["Known For", f.knownFor?.join(", ")],
  ].filter(([, v]) => v) as [string, string][];
  if (!rows.length) return null;
  return (
    <div className="my-6 not-prose border border-hair p-5">
      <SectionLabel>At a Glance</SectionLabel>
      <dl className="divide-y divide-hair">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 py-1.5">
            <dt className="w-28 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{k}</dt>
            <dd className="font-body text-[1.02rem] text-navy">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CareerArc({ article }: { article: Article }) {
  const arc = article.careerArc;
  const tracks = article.keyTracks || [];
  if (!arc?.length && !tracks.length) return null;
  return (
    <section className="mt-10 not-prose">
      {arc?.length ? (
        <>
          <div className="mb-3 border-b-2 border-navy pb-1">
            <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy">The Career, Era by Era</h2>
          </div>
          <ol className="space-y-3">
            {arc.map((e, i) => (
              <li key={i} className="border-l-4 border-breaking pl-4">
                <div className="font-sans text-xs font-bold uppercase tracking-[0.08em] text-breaking">{e.era}</div>
                <div className="font-body text-[1.05rem] leading-snug text-navy">{e.beat}</div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {tracks.length ? (
        <div className="mt-6">
          <SectionLabel>Key Tracks</SectionLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            {tracks.map((t, i) => (
              <div key={i}>
                <div className="mb-1 font-body text-[1.02rem] font-semibold text-navy">{t.title}</div>
                <EmbedPlayer platform={t.platform} url={t.embedUrl} title={t.title} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {article.peerLine ? (
        <p className="mt-5 border-t border-hair pt-4 font-body text-[1.05rem] italic leading-snug text-slate">{article.peerLine}</p>
      ) : null}
    </section>
  );
}

/* ---------- screen-music: song spotlight + soundtrack guide + indie discovery ---------- */
function SongSpotlight({ article }: { article: Article }) {
  const s = article.songSpotlight;
  if (!s?.embedUrl && !youTubeId(s?.embedUrl)) return null;
  return (
    <div className="my-6 not-prose border border-hair p-5">
      <SectionLabel>{s?.song ? `Listen: "${s.song}"${s.artist ? ` — ${s.artist}` : ""}` : "Listen"}</SectionLabel>
      <EmbedPlayer platform={s?.platform} url={s?.embedUrl} title={s?.song || article.title} />
    </div>
  );
}

function DiscoveryArtistBox({ article }: { article: Article }) {
  const d = article.discoveryArtist;
  if (!d?.name) return null;
  return (
    <aside className="my-6 not-prose border-l-4 border-breaking bg-mist/30 p-5">
      <SectionLabel>Who Is {d.name}?</SectionLabel>
      {d.blurb ? <p className="font-body text-[1.05rem] leading-snug text-navy">{d.blurb}</p> : null}
      {d.embedUrl ? <div className="mt-3"><EmbedPlayer url={d.embedUrl} title={d.name} /></div> : null}
    </aside>
  );
}

function SoundtrackModule({ article }: { article: Article }) {
  const songs = article.soundtrack;
  if (!songs?.length) return null;
  return (
    <section className="mt-10 not-prose">
      <div className="mb-3 border-b-2 border-navy pb-1">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy">
          Every Song{article.screenWork?.title ? ` in ${article.screenWork.title}` : ""}
        </h2>
      </div>
      <div className="space-y-5">
        {songs.map((s, i) => (
          <div key={i} className="border-b border-dotted border-slate/40 pb-5 last:border-0">
            <div className="font-body text-[1.1rem] font-semibold text-navy">
              &ldquo;{s.song}&rdquo;{s.artist ? <span className="font-normal text-slate"> — {s.artist}</span> : null}
            </div>
            {s.scene ? <div className="mt-0.5 font-body text-[1.02rem] leading-snug text-navy">{s.scene}</div> : null}
            {s.significance ? <div className="mt-0.5 font-body text-[1.02rem] leading-snug text-slate">{s.significance}</div> : null}
            {s.chartContext ? (
              <div className="mt-1 inline-block bg-mist px-2 py-0.5 font-sans text-[11px] uppercase tracking-[0.06em] text-slate">{s.chartContext}</div>
            ) : null}
            {s.embedUrl ? <div className="mt-2"><EmbedPlayer url={s.embedUrl} title={s.song} /></div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- dispatchers (called from NicheModules) ---------- */
export function MusicTop({ article }: { article: Article }) {
  const ft = article.formatTag;
  return (
    <>
      {ft === "music-news" ? <ReleaseInfoBox article={article} /> : null}
      {ft === "music-profile" ? <MusicFactPanel article={article} /> : null}
      {ft === "screen-music" ? <SongSpotlight article={article} /> : null}
      {ft === "screen-music" ? <DiscoveryArtistBox article={article} /> : null}
    </>
  );
}
export function MusicBottom({ article }: { article: Article }) {
  const ft = article.formatTag;
  return (
    <>
      {ft === "music-news" ? <Tracklist tracklist={article.tracklist || []} /> : null}
      {ft === "music-news" ? <TourDateTable tourDates={article.tourDates || []} /> : null}
      {ft === "music-profile" ? <CareerArc article={article} /> : null}
      {ft === "screen-music" ? <SoundtrackModule article={article} /> : null}
    </>
  );
}
