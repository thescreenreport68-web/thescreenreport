// QC — vision-check the FINISHED card: text fully visible (not cut off), photo clear + well-cropped (no
// half-face), professional + on-brand. Downscales the PNG via PIL for a cheap vision call; fails OPEN if
// PIL/Python isn't available so the pipeline still runs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chat } from "../lib/openrouter.mjs";
import { PIN } from "./config.mjs";

const QC_SYS = `You are the final art-director QC for a Pinterest news card (1000x1500). Return STRICT JSON only:
{"ok": true if the card is publish-ready,
 "issue":"if not ok, the single biggest problem in <=8 words (e.g. 'headline text cut off', 'face cropped out', 'photo blurry/low-res')"}
Fail it ONLY for real defects: text running off the card or overlapping, a person's face awkwardly cropped, an unreadable/blurry/tiny photo, or an obviously broken layout. Minor taste is fine.`;

// returns { ok, issue }
export async function qcCard(pngFile) {
  let small;
  try {
    small = path.join(os.tmpdir(), "qc-" + path.basename(pngFile).replace(".png", ".jpg"));
    execFileSync(PIN.python, ["-c",
      `from PIL import Image;i=Image.open('${pngFile}').convert('RGB');i.thumbnail((560,840));i.save('${small}','JPEG',quality=82)`],
      { stdio: "ignore", timeout: 20000 });
  } catch { return { ok: true, issue: "" }; } // no PIL → skip QC (fail-open)
  try {
    const uri = "data:image/jpeg;base64," + fs.readFileSync(small).toString("base64");
    const { data } = await chat({ model: PIN.visionModel, json: true, maxTokens: 80, temperature: 0, system: QC_SYS, user: "Review this card.", images: [uri] });
    try { fs.unlinkSync(small); } catch {}
    if (data && data.ok === false) return { ok: false, issue: data.issue || "qc failed" };
    return { ok: true, issue: "" };
  } catch { return { ok: true, issue: "" }; } // vision error → fail-open
}
