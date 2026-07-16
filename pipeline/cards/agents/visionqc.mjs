// VISION QC — looks at the RENDERED JPEG the way a scroller will (the reels lane's
// watchqc doctrine): right subject, legible at feed size, nothing clipped or overlapped,
// no visible watermark (a watermark = wrong image tier upstream — hard fail).
import { vision } from "../models.mjs";

const SYS = `You are quality control for a news image card (1080-wide, viewed at ~400px in a phone feed). Return STRICT JSON:
{"score":0-100,"pass":boolean,"problems":[string]}
CHECK: (1) headline fully readable, no clipped/overlapping text anywhere; (2) the photo plausibly shows the story's subject (person/film named in the headline) and is not a logo, ad, or unrelated stock shot; (3) no watermark, credit bug, or channel logo burned into the PHOTO area (our own small credit pill and wordmark are expected and fine); (4) the photo crop keeps the main face/subject visible (not amputated at the seam); (5) overall: would this pass as a professional news page's card? pass=true only if score>=75 AND no hard problem (clipped text, wrong subject, watermark).`;

export async function visionQC({ jpeg, card, story }) {
  const out = await vision({
    system: SYS,
    user: `HEADLINE ON CARD: ${card.headline}\nSTORY SUBJECT(S): ${(story.entities || []).join(", ") || story.title}`,
    jpegBuffer: jpeg,
  });
  return { score: Number(out?.score ?? 0), pass: Boolean(out?.pass) && Number(out?.score ?? 0) >= 75, problems: out?.problems || [] };
}
