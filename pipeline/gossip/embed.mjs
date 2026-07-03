// GOSSIP — EMBEDDINGS (Step 1 infra). embed(text) -> a normalized Float32Array(384), shared by dedup (Step 2)
// and internal-links (Step 7). DEFAULT = FREE LOCAL bge-small-en-v1.5 via @xenova/transformers (ONNX, no key,
// no rate limit, runs on Apple Silicon). The EMBED_PROVIDER env switch makes a hosted upgrade a one-liner.
// Proven: reworded-same-story cosine ~0.89 vs different-story ~0.53 — the separation dedup needs.
const PROVIDER = process.env.EMBED_PROVIDER || "local";

let _pipe = null;
async function localEmbed(text) {
  if (!_pipe) {
    const { pipeline } = await import("@xenova/transformers");
    _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
  }
  const out = await _pipe(text, { pooling: "mean", normalize: true });
  return Float32Array.from(out.data);
}

// Hosted upgrade path (set EMBED_PROVIDER=openai + OPENAI_API_KEY). Returns 384-dim to match the local model.
async function openaiEmbed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text, dimensions: 384 }),
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}`);
  return Float32Array.from((await r.json()).data[0].embedding);
}

export async function embed(text) {
  const t = (text || "").replace(/\s+/g, " ").trim().slice(0, 2000) || "empty";
  return PROVIDER === "openai" ? openaiEmbed(t) : localEmbed(t);
}

// Cosine similarity. (Local embeddings are normalized so this equals the dot product, but we compute the full
// form so it's correct regardless of the provider/normalization.)
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
