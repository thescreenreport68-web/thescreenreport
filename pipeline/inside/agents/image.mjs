// AGENT 6 — IMAGE. Its one job: the best RELEVANT featured image for THIS article (mandatory —
// no image, no publish) + its SEO alt text. The engine is the proven picker: candidates from
// source-page og:images (any owner) + TMDB stills, vision-RANKED for relevance, measured ≥1200px,
// Commons last resort. Vision calls run on the registry's image model (flash-lite, temp 0).
import { pickInsideImage } from "../imagePicker.mjs";
import { AGENTS } from "../models.mjs";

// run(job) → job.image = { image, imageWidth, imageHeight, credit, alt } | null
export async function run(job, { pickImpl = pickInsideImage } = {}) {
  const pick = await pickImpl({
    trigger: job.story,
    angle: job.angle,
    article: job.article,
    bundle: job.bundle,
    visionModel: AGENTS.image.model,
  }).catch(() => null);
  if (!pick) { job.image = null; return job; }
  // SEO alt: subject + article context, deterministic (no LLM needed for a good alt).
  const alt = [job.story.work?.title || job.story.primaryEntity, job.article?.imageQuery]
    .filter(Boolean).join(" — ").slice(0, 120);
  job.image = { ...pick, alt: alt || job.story.primaryEntity };
  return job;
}
