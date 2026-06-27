import fs from "node:fs";
import path from "node:path";
import { EmbeddedTweet } from "react-tweet";

/* Renders a public X post from its CACHED syndication JSON (written by the pipeline), so the
   static build never depends on a live X call. EMBED ONLY — react-tweet serves any media from
   X's own CDN; we never download or re-host it. Unresolvable posts render nothing. */
export default function TweetEmbed({ id }: { id: string }) {
  let tweet: Parameters<typeof EmbeddedTweet>[0]["tweet"] | null = null;
  try {
    const file = path.join(process.cwd(), "data", "tweets", `${id}.json`);
    tweet = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    tweet = null;
  }
  if (!tweet) return null;
  return <EmbeddedTweet tweet={tweet} />;
}
