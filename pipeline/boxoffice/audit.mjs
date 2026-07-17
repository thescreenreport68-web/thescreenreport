// P5 — DAILY QUALITY SELF-AUDIT (BOX_OFFICE_UPGRADE_PLAN §4.2): once per LA day, sample up to 3 of
// YESTERDAY's live-published articles and score them against the per-article quality contract with ONE
// cheap flash-lite call (~$0.003/day). Failures land in the run report + a GitHub ::warning:: annotation,
// so quality drift is caught in hours — the lane grades its own homework before the owner ever sees it.
import fs from "node:fs";
import path from "node:path";
import { agentChat } from "./models.mjs";
import { CONTENT_DIR } from "./config.bo.mjs";

const laDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);

const AUDIT_SYS = `You audit BOX-OFFICE/STREAMING articles against a strict quality contract. For EACH numbered
article, check ONLY these, and report ONLY genuine failures:
1. HEADLINE FIGURE IN PROSE: the title's main number appears in the article body text.
2. SELF-CONSISTENT: no two surfaces state contradicting figures for the same metric.
3. NO INVENTED VERDICTS: no unattributed profit/loss talk ("faces a loss", "profitable") or audience
   verdicts ("franchise fatigue", "audiences hesitant") without a named source.
4. COMPLETE: a real lede paragraph (not a heading/label), no placeholder text, no literal '##' mid-paragraph.
5. HONEST TITLE: the title's claim matches what the body reports.
Output STRICT JSON only: {"issues":[{"i":1,"problem":"one sentence naming the exact failure"}]} — empty
issues array if all articles pass. Be precise, not trigger-happy.`;

// dailyAudit({ store, now, chatImpl, contentDir }) → { day, sampled, issues } | null (already audited / nothing to audit).
// The caller persists store (store.lastAuditDay is set here; borun's bumpDaySpend save carries it).
export async function dailyAudit({ store, now = new Date(), chatImpl = null, contentDir = CONTENT_DIR } = {}) {
  const today = laDay(now);
  if (!store || store.lastAuditDay === today) return null;
  const yday = laDay(new Date(now.getTime() - 24 * 3600e3));
  const picks = (store.published || [])
    .filter((r) => !r.review && r.slug && r.at && laDay(new Date(r.at)) === yday)
    .slice(-3);
  store.lastAuditDay = today; // mark even when empty — one attempt per day, never a retry loop
  if (!picks.length) return { day: yday, sampled: [], issues: [] };

  const bodies = [];
  for (const p of picks) {
    try {
      const md = fs.readFileSync(path.join(contentDir, `${p.slug}.md`), "utf8");
      bodies.push({ slug: p.slug, text: md.slice(0, 3500) });
    } catch { /* article file missing locally — skip */ }
  }
  if (!bodies.length) return { day: yday, sampled: [], issues: [] };

  const user = bodies.map((b, i) => `=== ARTICLE ${i + 1} (${b.slug}) ===\n${b.text}`).join("\n\n");
  let issues = [];
  try {
    const { data } = await agentChat("categorize", { system: AUDIT_SYS, user, maxTokens: 900 }, chatImpl ? { chatImpl } : {});
    issues = (Array.isArray(data?.issues) ? data.issues : [])
      .filter((x) => x && x.problem)
      .map((x) => ({ slug: bodies[Number(x.i) - 1]?.slug || "?", problem: String(x.problem).slice(0, 200) }));
  } catch { /* audit is best-effort — never blocks the tick */ }
  return { day: yday, sampled: bodies.map((b) => b.slug), issues };
}
