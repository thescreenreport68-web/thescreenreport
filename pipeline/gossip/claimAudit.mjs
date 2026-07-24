// GOSSIP — CLAIM AUDIT (2026-07-25). The semantic half of the unquoted-prose problem.
//
// claimGuard.mjs catches the SHAPES of invention (a described face, a crowd reaction, a phantom outlet).
// It cannot catch a swap of one true-sounding word for another. The live review found exactly that:
// the subject said she was in TREATMENT; the article said "She's in therapy." Same register, different
// claim, on a cancer story. No regex will ever see it — but a model reading both texts side by side will.
//
// So this is a reader, not a writer: it gets the gathered source text and the article's UNQUOTED
// sentences, and returns the ones the source does not support. It may only ever REMOVE trust from a
// sentence; it cannot add a fact, rewrite a line, or approve anything. Its output becomes surgical-fix
// instructions, which the writer repairs using bundle material only.
//
// 🔴 FAIL SOFT. Any error, any malformed reply → no findings, and the article proceeds exactly as it
// would have without this stage. A guard that can block the lane on its own bad day is a worse guard.
// 🔴 QUOTES ARE OUT OF SCOPE. quoteGuard already proves those verbatim; re-judging them here could only
// produce false positives against text we have already verified character-for-character.
import { agentChat } from "./models.mjs";
import { splitSentences } from "./proseGuards.mjs";

const MAX_SENTENCES = 40;

/** Article sentences that are plain prose — quotes masked, headings and short fragments dropped. */
export function auditableSentences(body) {
  const out = [];
  for (const para of String(body || "").split(/\n{2,}/)) {
    if (/^#{1,6}\s/.test(para.trim())) continue;
    for (const unit of splitSentences(para)) {
      for (const s of unit.split(/(?<=[.!?]["”']?)\s+/)) {
        const bare = s.replace(/["“][^"”]*["”]/g, " ").replace(/\s+/g, " ").trim();
        // a sentence that is essentially all quote carries no unverified prose claim of its own
        if (bare.split(" ").filter(Boolean).length < 6) continue;
        out.push(s.trim());
        if (out.length >= MAX_SENTENCES) return out;
      }
    }
  }
  return out;
}

/**
 * Returns { unsupported: [{ sentence, why }], checked, reason }.
 * `unsupported` is always an array; on any failure it is empty.
 */
export async function auditClaims({ bundle, article, chatImpl } = {}) {
  const src = (bundle?.sources || []).map((s) => s.text || "").join("\n\n").slice(0, 13000);
  const sentences = auditableSentences(article?.body);
  if (src.length < 400 || !sentences.length) return { unsupported: [], checked: 0, reason: "nothing to audit" };
  try {
    const { data } = await agentChat("claimAudit", {
      system: "You are a fact-checker. You compare an article's sentences against the ONLY source material that was available to its writer. You never rewrite anything and you never add information. Output strict JSON only.",
      user: `SOURCE MATERIAL (everything the writer had):
${src}

ARTICLE SENTENCES (numbered):
${sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}

For each sentence, decide whether the SOURCE MATERIAL supports what it asserts.

SUPPORTED means the source states it, or the sentence is a fair paraphrase of something the source states.
UNSUPPORTED means the sentence asserts something the source does not establish — including:
 • a detail about how someone looked, sounded, moved, or felt that the source never describes
 • a claim about what fans, viewers, or the public did, noticed, or believed
 • naming an outlet, person, place, date or number the source does not contain
 • a word swapped for one that means something different ("in therapy" when the source says "in treatment")
 • a cause, motive, or consequence the source does not state

Do NOT flag: opinion or interpretation that is clearly framed as such ("it seems", "appears to", "fans wonder"),
general framing that adds no new fact, or anything inside quotation marks.
Be strict about facts and generous about voice. When genuinely unsure, do NOT flag it.

Return JSON:
{"unsupported":[{"n":<sentence number>,"why":"<what the source does not support, in one short clause>"}]}
An empty array is a valid and common answer.`,
      json: true,
    }, chatImpl ? { chatImpl } : {});
    const rows = Array.isArray(data?.unsupported) ? data.unsupported : [];
    const unsupported = rows
      .map((r) => ({ sentence: sentences[Number(r?.n) - 1], why: String(r?.why || "not supported by the sources").slice(0, 120) }))
      .filter((r) => r.sentence);
    return { unsupported, checked: sentences.length, reason: "" };
  } catch (e) {
    return { unsupported: [], checked: 0, reason: `claim audit unavailable: ${String(e?.message || e).slice(0, 60)}` };
  }
}

/** Turn audit findings into surgical-fix instructions (same path as every other deterministic trigger). */
export function auditFixIssues(audit, { max = 5 } = {}) {
  return (audit?.unsupported || []).slice(0, max).map(({ sentence, why }) =>
    `UNSUPPORTED CLAIM — ${why}. The sentence is: "${String(sentence).slice(0, 180)}". Fix it using ONLY the source material: state what the sources actually say, or cut the sentence. Do not invent a replacement fact.`);
}
