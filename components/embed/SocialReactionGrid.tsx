import TweetEmbed from "./TweetEmbed";
import InstagramEmbed from "./InstagramEmbed";

/* The embedded "what people are saying" wall: real public X posts (lead) + optional IG.
   CSS columns give a light masonry feel; each post stays whole (break-inside-avoid). */
export default function SocialReactionGrid({
  tweetIds = [],
  instagramUrls = [],
}: {
  tweetIds?: string[];
  instagramUrls?: string[];
}) {
  if (!tweetIds.length && !instagramUrls.length) return null;
  return (
    <div className="mt-4 gap-5 [column-gap:1.25rem] sm:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
      {tweetIds.map((id) => (
        <TweetEmbed key={id} id={id} />
      ))}
      {instagramUrls.map((u) => (
        <InstagramEmbed key={u} url={u} />
      ))}
    </div>
  );
}
