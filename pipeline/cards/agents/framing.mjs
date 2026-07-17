// FRAMING — looks at the actual photo BEFORE cropping (owner mandate 2026-07-17 after a
// side-by-side composite got a face sliced at the seam). Classifies the image and returns
// the focal point the crop must center on:
//   people    → center of the LEAD subject's face (all faces kept in frame when possible)
//   scene     → wide set/event/landscape shots: compositional center, NO fake face focus —
//               the crop must not "interfere" with wide frames (owner rule)
//   poster    → title/key-art center
//   composite → 2+ separate photos stitched side-by-side: REJECTED (cropping one always
//               slices the other; the hunter's next candidate is used instead)
import sharp from "sharp";
import { vision } from "../models.mjs";

const SYS = `You position a news photo inside a fixed landscape crop frame for a social card. Look at the image and return STRICT JSON:
{"type":"people"|"scene"|"poster"|"composite","focusX":0.0-1.0,"focusY":0.0-1.0,"faces":number,"note":string}
RULES:
- "composite": the image is 2+ SEPARATE photos joined side-by-side or in a grid (split-screen diptych, collage, before/after). Any visible hard seam/border between different photos means composite.
- "people": one real photo with people. focusX/focusY = the center of the LEAD SUBJECT'S FACE (the lead is named in the prompt; if absent, the most prominent face). If several faces share one photo, pick the point that keeps ALL faces inside a crop centered there, favoring the lead. focusY sits ON the face, not the body.
- "scene": a wide shot (film set, event stage, landscape, crowd, building) with no dominant close face. focusX/focusY = the compositional center of interest. Never invent a face focus here.
- "poster": official poster/key art/title card. focus = the title block or central art.
- Coordinates are fractions of image width/height (0,0 = top-left).`;

export async function frame(photoBuf, story) {
  // downscale for the vision call — coordinates are fractional, so precision survives
  const small = await sharp(photoBuf).resize(512, 512, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
  const out = await vision({
    system: SYS,
    user: `Story: ${story.title}\nLead subject: ${(story.entities || [])[0] || "unknown"}\nOther subjects: ${(story.entities || []).slice(1, 4).join(", ") || "none"}`,
    jpegBuffer: small,
  });
  const clamp = (v, d) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);
  return {
    type: ["people", "scene", "poster", "composite"].includes(out?.type) ? out.type : "scene",
    focusX: clamp(out?.focusX, 0.5),
    focusY: clamp(out?.focusY, 0.42),
    faces: Number(out?.faces) || 0,
    note: String(out?.note || "").slice(0, 160),
  };
}
