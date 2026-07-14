// IMAGE HUNTER — get the most relevant photo for the story and vision-verify it depicts the subject.
// Primary source: the article's own hero image (the outlet's photo for THIS story = relevant by construction);
// a vision gate rejects logos / text-graphics / wrong-subject so the card never ships a bad image.
import { chat } from "../lib/openrouter.mjs";
import { PIN } from "./config.mjs";

async function toDataUri(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error("img http " + r.status);
  const ct = r.headers.get("content-type") || "";
  if (!/image\//.test(ct)) throw new Error("not an image: " + ct);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 6000) throw new Error("image too small");
  if (buf.length > 4_000_000) throw new Error("image too large"); // guard against absurd files
  return `data:${ct.split(";")[0]};base64,${buf.toString("base64")}`;
}

const GATE = `You are checking an image for a Hollywood-news Pinterest card. Editorial imagery is fine — real photos AND film/TV stills (live-action OR animated) AND clean promotional shots all count. Return STRICT JSON only:
{"usable": true if it clearly shows the story's subject as a photo, a film/TV still, or a clean promo image; set FALSE only for junk: a bare logo, a text-only / title / big-caption graphic, a busy multi-image collage, a tweet/screenshot, a watermarked stock placeholder, or something clearly unrelated,
 "relevant": true if it depicts the people, film, or show in the headline,
 "reason":"<=8 words"}`;

// returns { ok, imgDataUri, reason } — ok=false means find another story
export async function pickImage(article) {
  if (!article.image) return { ok: false, reason: "no article image" };
  let uri;
  try { uri = await toDataUri(article.image); }
  catch (e) { return { ok: false, reason: "download: " + String(e.message).slice(0, 40) }; }
  // vision gate (fail-OPEN on API error — the outlet image is usually fine)
  try {
    const { data } = await chat({
      model: PIN.visionModel, json: true, maxTokens: 120, temperature: 0,
      system: GATE, user: `Headline: "${article.title}". Category: ${article.category}. Judge the image.`,
      images: [uri],
    });
    if (data && data.usable === false) return { ok: false, reason: "junk image: " + (data.reason || "") };
    if (data && data.relevant === false) return { ok: false, reason: "off-topic: " + (data.reason || "") };
  } catch { /* fail-open */ }
  return { ok: true, imgDataUri: uri };
}
