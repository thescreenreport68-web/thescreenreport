// Interview niche: discover the OFFICIAL interview video (YouTube Data API), pull its caption
// track with yt-dlp (subtitles ONLY — no audio/video download), and ground an ORIGINAL summary
// on the real transcript. LEGAL: we summarize in our own words + embed the official video + cite
// the source channel; we never re-host the video and never reproduce the transcript wholesale.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const execFileP = promisify(execFile);

// Direct competitors we won't embed/credit (per the no-compete rule); we prefer real interview channels.
const COMPETITORS = /hollywood reporter|variety|deadline|screen ?rant|collider|\bign\b|hollywood insider/i;
const PREFERRED =
  /tonight show|jimmy kimmel|late show|late night|jimmy fallon|seth meyers|graham norton|hot ones|first we feast|vanity fair|\bgq\b|vogue|wired|\bbbc\b|associated press|entertainment tonight|kelly clarkson|the view|good morning america|today|buzzfeed|esquire|netflix|warner bros|marvel|\bhbo\b|searchlight|\ba24\b|focus features|sony pictures|universal pictures|prime video|apple tv/i;

// Discover candidate official interview videos (embeddable, English), competitors filtered out, trusted first.
export async function searchInterview(query, { max = 12 } = {}) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=${max}&relevanceLanguage=en&order=relevance&q=${encodeURIComponent(query)}&key=${key}`;
  const r = await fetch(u);
  if (!r.ok) return [];
  const j = await r.json();
  const items = (j.items || [])
    .map((it) => ({ id: it.id?.videoId, title: it.snippet?.title || "", channel: it.snippet?.channelTitle || "", published: it.snippet?.publishedAt, description: it.snippet?.description || "" }))
    .filter((v) => v.id && !COMPETITORS.test(v.channel));
  items.sort((a, b) => (PREFERRED.test(b.channel) ? 1 : 0) - (PREFERRED.test(a.channel) ? 1 : 0));
  return items;
}

// Keyless oEmbed → canonical title + channel (author_name).
export async function oEmbed(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Fetch the English caption track via yt-dlp (subtitles only). Returns clean transcript text or null.
export async function fetchTranscript(videoId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-"));
  try {
    await execFileP(
      "yt-dlp",
      ["--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "en.*", "--sub-format", "json3",
        "--no-warnings", "-o", path.join(dir, "%(id)s.%(ext)s"), `https://www.youtube.com/watch?v=${videoId}`],
      { timeout: 90000 }
    );
  } catch {
    // yt-dlp can exit non-zero (e.g. format warnings) but still write the subtitle file — fall through.
  }
  let text = "";
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json3"));
    // prefer a human/manual en track over the auto (en-orig) one
    const pick = files.find((f) => /\.en\.json3$/.test(f)) || files.find((f) => /\.en-orig\.json3$/.test(f)) || files[0];
    if (pick) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, pick), "utf8"));
      text = (j.events || [])
        .flatMap((e) => (e.segs || []).map((s) => s.utf8 || ""))
        .join("")
        .replace(/\[[^\]]*\]/g, " ") // [music], [laughter], [applause]
        .replace(/\s+/g, " ")
        .trim();
    }
  } catch {
    text = "";
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return text && text.length > 300 ? text : null;
}

// Grounding block for the writer: the source + the real transcript (capped to control tokens).
export function interviewFactBlock({ video, transcript }) {
  return (
    `INTERVIEW SOURCE: "${video.title}" on ${video.channel} — the OFFICIAL video, embedded in the article.\n\n` +
    `FULL TRANSCRIPT (auto-captioned). Build an ORIGINAL summary from this; paraphrase faithfully; only put a phrase in quotation marks if it appears here EXACTLY and is a clear, distinctive line (ignore obvious caption typos and filler):\n` +
    transcript.slice(0, 18000)
  );
}
