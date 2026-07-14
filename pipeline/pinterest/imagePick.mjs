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

// The image is the article's OWN editorial hero photo for THIS exact story, so it is on-topic by construction
// — a film/TV still (a character, a scene, live-action OR animated), a poster, a red-carpet photo, or a clean
// promo shot are ALL good. We do NOT require it to show the person named in the headline (a Gollum still for a
// "Hunt for Gollum" story is perfect). The gate only screens out genuinely UNUSABLE frames; qcCard re-checks
// the finished card as a second line of defense.
const GATE = `You are checking the hero image for a premium Hollywood-news Pinterest card. This is the article's own editorial photo for this exact story, so treat it as on-topic — a real photo, a film/TV still (live-action OR animated), a single character or scene shot, a movie poster, or a clean promotional image are ALL usable. Do NOT require the specific person named in the headline to appear; the film/show/scene itself is fine.
Return STRICT JSON only:
{"usable": set FALSE ONLY for a genuinely unusable frame — a bare logo, a text-only / title-card / big-caption graphic, a multi-image collage, a tweet or app screenshot, a watermarked stock placeholder, a corrupt/blank frame, or a photo that is clearly upside-down or rotated sideways; otherwise TRUE,
 "reason":"<=8 words"}`;

// returns { ok, imgDataUri, reason } — ok=false means find another story
export async function pickImage(article) {
  if (!article.image) return { ok: false, reason: "no article image" };
  let uri;
  try { uri = await toDataUri(article.image); }
  catch (e) { return { ok: false, reason: "download: " + String(e.message).slice(0, 40) }; }
  // vision gate (fail-OPEN on API error — the outlet image is on-topic by construction)
  try {
    const { data } = await chat({
      model: PIN.visionModel, json: true, maxTokens: 120, temperature: 0,
      system: GATE, user: `Headline: "${article.title}". Category: ${article.category}. Is this hero image usable for the card?`,
      images: [uri],
    });
    if (data && data.usable === false) return { ok: false, reason: "unusable image: " + (data.reason || "") };
  } catch { /* fail-open */ }
  return { ok: true, imgDataUri: uri };
}
