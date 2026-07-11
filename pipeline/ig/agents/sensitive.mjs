// AGENT 4 — SENSITIVITY GATE: kill/hold BEFORE any render spend (plan §2.2 #4).
// A video amplifies a mistake far more than a page. Deterministic keyword prescreen →
// cheap classifier only when the prescreen fires. Fail-closed.
import { llm } from "../models.mjs";

const TRIGGER_RE = /\b(dead|dies|died|death|killed|suicide|overdose|arrest(ed)?|charge[ds]|lawsuit|sues?|trial|verdict|assault|abuse|allegat\w*|accus\w*|harass\w*|misconduct|rape|dui|rehab|stalk\w*|restraining|racis\w*|scandal|cancer|diagnos\w*|minor|underage|child(ren)?|divorce|custody|hospitali[sz]ed|missing|shooting|election|president|congress|protest|war|gaza|ukraine)\b/i;

const SYS = `Classify a Hollywood story for a video automation. Return STRICT JSON {"decision":"ok"|"somber"|"block","reason":string}.
block: unverified death/suicide/overdose, anything involving minors as subjects, active criminal/legal proceedings where facts are contested, celebrity-x-politics (elections, war, activism controversies).
somber: confirmed deaths/tributes and serious-but-settled news — proceed with respectful tone, NO music.
ok: everything else (casting, box office, trailers, renewals, relationships, awards).`;

export async function sensitiveGate(article, facts) {
  const text = `${article.title}. ${facts.storyOneLine || ""} ${facts.facts.map((f) => f.claim).join(" ")}`;
  if (!TRIGGER_RE.test(text)) return { decision: "ok", reason: "no trigger terms" };
  try {
    const res = await llm({ role: "classify", system: SYS, user: text.slice(0, 1500), temp: 0, maxTokens: 150, json: true });
    if (["ok", "somber", "block"].includes(res.decision)) return res;
    return { decision: "block", reason: "classifier returned unknown decision (fail-closed)" };
  } catch (e) {
    return { decision: "block", reason: `classifier error (fail-closed): ${e.message}` };
  }
}
