// VISION QC — looks at the RENDERED JPEG the way a scroller will (the reels lane's
// watchqc doctrine). TWO dedicated hard fails (owner rules 2026-07-17):
//   faceCut    — a face amputated by any edge/seam ("should not be repeated")
//   outletMark — ANY visible source/photo credit, outlet name, watermark or channel bug
//                on the image (reads as reposted content to IG's originality ranking;
//                our own wordmark + category tab are the ONLY permitted marks)
// Either one fails the card regardless of score; the orchestrator retries with the next
// candidate photo.
import { vision } from "../models.mjs";

const SYS = `You are quality control for a news image card (1080-wide, viewed at ~400px in a phone feed). Return STRICT JSON:
{"score":0-100,"pass":boolean,"faceCut":boolean,"outletMark":boolean,"problems":[string]}
Answer these two LITERALLY and first:
faceCut — is ANY person's face partially cut off / amputated by ANY edge of the photo area or by a visible seam (half a face at the left/right/top edge, eyes or mouth sliced)? true even if another face in the frame is complete. A face naturally in profile or partly turned is NOT cut; a face bisected by the frame IS.
outletMark — is there ANY visible text or logo on the image that credits or names a source: "via …", "Photo: …", "courtesy …", a news outlet's name or logo (Variety, Deadline, Getty, etc.), a TV channel bug, or any watermark? The ONLY permitted marks are the card's own "The Screen Report" wordmark, the @THESCREENREPORT handle, and the red/charcoal category tab. Anything else = true.
THEN CHECK: (1) headline fully readable, no clipped/overlapping text anywhere; (2) the photo plausibly shows the story's subject (person/film named in the headline) and is not a logo, ad, or unrelated stock shot; (3) for wide scene shots (sets, events, landscapes): the composition reads intact — do not demand a face; (4) overall: would this pass as a professional news page's card?
pass=true only if score>=75 AND faceCut=false AND outletMark=false AND no hard problem (clipped text, wrong subject).`;

export async function visionQC({ jpeg, card, story }) {
  const out = await vision({
    system: SYS,
    user: `HEADLINE ON CARD: ${card.headline}\nSTORY SUBJECT(S): ${(story.entities || []).join(", ") || story.title}`,
    jpegBuffer: jpeg,
  });
  const faceCut = Boolean(out?.faceCut);
  const outletMark = Boolean(out?.outletMark);
  const score = Number(out?.score ?? 0);
  return {
    score,
    faceCut,
    outletMark,
    pass: Boolean(out?.pass) && !faceCut && !outletMark && score >= 75,
    problems: [
      ...(faceCut ? ["face cut at frame edge/seam"] : []),
      ...(outletMark ? ["source credit/watermark visible on image"] : []),
      ...(out?.problems || []),
    ],
  };
}
