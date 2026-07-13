// AGENT 6 — IMAGE. One job: the best RELEVANT featured image for THIS article (mandatory — no
// image, no publish) + its SEO alt text. Runs AFTER all content gates (never burns vision calls on
// a draft that won't pass). Vision on the registry's image model (flash-lite, temp 0).
import { pickBoxOfficeImage } from "../imagePicker.mjs";
import { AGENTS } from "../models.mjs";

// run(job) → job.image = { image, imageWidth, imageHeight, credit, alt } | null
export async function run(job, { pickImpl = pickBoxOfficeImage } = {}) {
  const pick = await pickImpl({
    trigger: job.trigger,
    angle: job.angle,
    film: job.film,
    article: job.article,
    bundle: job.bundle,
    visionModel: AGENTS.image.model,
  }).catch(() => null);
  if (!pick) { job.image = null; return job; }
  const alt = [job.film?.title, job.article?.imageQuery].filter(Boolean).join(" — ").slice(0, 120);
  job.image = { ...pick, alt: alt || job.film?.title };
  return job;
}
