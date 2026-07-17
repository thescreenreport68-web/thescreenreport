// VISION QC — looks at the RENDERED JPEG the way a scroller will (the reels lane's
// watchqc doctrine). Face amputation is a DEDICATED HARD FAIL (owner 2026-07-17: a
// composite crop shipped a half-face; "should not be repeated") — a face cut by any
// edge or seam fails the card regardless of score, and the orchestrator retries with
// the next candidate photo.
import { vision } from "../models.mjs";

const SYS = `You are quality control for a news image card (1080-wide, viewed at ~400px in a phone feed). Return STRICT JSON:
{"score":0-100,"pass":boolean,"faceCut":boolean,"problems":[string]}
faceCut — answer this FIRST and literally: is ANY person's face partially cut off / amputated by ANY edge of the photo area or by a visible seam (half a face at the left/right/top edge, eyes or mouth sliced)? true even if another face in the frame is complete. A face naturally in profile or partly turned is NOT cut; a face bisected by the frame IS.
THEN CHECK: (1) headline fully readable, no clipped/overlapping text anywhere; (2) the photo plausibly shows the story's subject (person/film named in the headline) and is not a logo, ad, or unrelated stock shot; (3) no watermark, credit bug, or channel logo burned into the PHOTO area (our own small credit pill and wordmark are expected and fine); (4) for wide scene shots (sets, events, landscapes): the composition reads intact — do not demand a face; (5) overall: would this pass as a professional news page's card?
pass=true only if score>=75 AND faceCut=false AND no hard problem (clipped text, wrong subject, watermark).`;

export async function visionQC({ jpeg, card, story }) {
  const out = await vision({
    system: SYS,
    user: `HEADLINE ON CARD: ${card.headline}\nSTORY SUBJECT(S): ${(story.entities || []).join(", ") || story.title}`,
    jpegBuffer: jpeg,
  });
  const faceCut = Boolean(out?.faceCut);
  const score = Number(out?.score ?? 0);
  return {
    score,
    faceCut,
    pass: Boolean(out?.pass) && !faceCut && score >= 75,
    problems: [...(faceCut ? ["face cut at frame edge/seam"] : []), ...(out?.problems || [])],
  };
}
