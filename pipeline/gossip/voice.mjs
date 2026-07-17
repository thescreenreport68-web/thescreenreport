// GOSSIP — VOICE PASS (Phase 4, flagged). A native-register line edit over the finished body so the prose
// reads like a human gossip desk, not a model — using the inside lane's proven QUOTE-MASKING mechanism:
// every quoted span becomes a ⟦Vn⟧ token before the editor sees the text, so the model PHYSICALLY cannot
// touch a quote; unmasking rejects any dropped/duplicated/invented token and auto-reverts.
//
// DETERMINISTIC REVERT GUARDS (cosmetic can never cost accuracy — any violation reverts to the input):
//   • token multiset identical (no quote lost, duplicated, or invented)
//   • the NUMBER multiset is unchanged (a polish can never alter a date/age/amount)
//   • no NEW proper-name span appears that wasn't in the original body
//   • word count stays within ±25%; "## " subhead count unchanged
// OFF on the live path unless GOSSIP_VOICE=1; ON in review runs so the owner can evaluate it safely.
import { agentChat } from "./models.mjs";

const QUOTE_RE = /["“][^"“”]{4,400}["”]/g;

export function maskQuotes(body) {
  const map = [];
  const masked = String(body || "").replace(QUOTE_RE, (m) => { map.push(m); return `⟦V${map.length}⟧`; });
  return { masked, map };
}

export function unmaskQuotes(masked, map) {
  let out = String(masked || "");
  for (let i = 0; i < map.length; i++) {
    const tok = `⟦V${i + 1}⟧`;
    const first = out.indexOf(tok);
    if (first === -1) return null;                     // token dropped → reject
    if (out.indexOf(tok, first + tok.length) !== -1) return null; // duplicated → reject
    out = out.replace(tok, map[i]);
  }
  if (/⟦V\d+⟧/.test(out)) return null;                 // invented/unknown token → reject
  return out;
}

const nums = (s) => (String(s || "").match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, "")).sort();
const nameSpans = (s) => new Set((String(s || "").match(/[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+)+/gu) || []).map((x) => x.toLowerCase()));
const words = (s) => String(s || "").split(/\s+/).filter(Boolean).length;
const heads = (s) => (String(s || "").match(/^##\s/gm) || []).length;

// All-or-nothing safety: the polished body ships only if every deterministic guard passes.
export function voiceGuards(original, polished) {
  if (!polished) return "empty";
  if (JSON.stringify(nums(original)) !== JSON.stringify(nums(polished))) return "numbers-changed";
  const before = nameSpans(original);
  for (const n of nameSpans(polished)) if (!before.has(n)) return "new-name";
  const r = words(polished) / Math.max(1, words(original));
  if (r < 0.75 || r > 1.25) return "length-drift";
  if (heads(original) !== heads(polished)) return "subheads-changed";
  return null;
}

const SYS = `You are a line editor on a celebrity-gossip desk (Page Six register: punchy, wry, human). Rewrite the article body for rhythm, flow and native voice — tighten flab, vary sentence length, kill AI-tells ("it's worth noting", "in a surprising turn", stiff transitions).
HARD RULES:
- ⟦Vn⟧ tokens are LOCKED quotes — keep every one exactly where it makes sense, never edit, drop, duplicate or invent one.
- Do NOT add or remove any fact, name, number, date, place, or attribution. Same story, better prose.
- Keep every "## " subhead line as-is. Keep paragraph breaks sensible. Keep roughly the same length.
Return STRICT JSON: { "body": "the polished markdown body" }`;

export async function voicePass({ body, chatImpl } = {}) {
  try {
    const { masked, map } = maskQuotes(body);
    const { data } = await agentChat("voice", { system: SYS, user: `BODY:\n${masked}`, json: true }, chatImpl ? { chatImpl } : {});
    const polishedMasked = data?.body;
    if (!polishedMasked) return { body, applied: false, reason: "no-output" };
    const unmasked = unmaskQuotes(polishedMasked, map);
    if (unmasked == null) return { body, applied: false, reason: "token-integrity" };
    const bad = voiceGuards(body, unmasked);
    if (bad) return { body, applied: false, reason: bad };
    return { body: unmasked, applied: true, reason: null };
  } catch {
    return { body, applied: false, reason: "error" }; // fail-open: original prose stands
  }
}
