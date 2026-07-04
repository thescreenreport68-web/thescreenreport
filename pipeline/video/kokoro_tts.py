# Kokoro-82M TTS v2 — PHONEME-SPLICE synthesis (verified recipe, PRONUNCIATION_RESEARCH.json).
# The normalized SAY text is phonemized sentence-by-sentence with the engine's own G2P; any word in
# the curated phoneme lexicon is spliced in as exact espeak-IPA; synthesis runs is_phonemes=True.
# Entries are validated against the model vocab (unknown chars are silently dropped by the engine).
# Usage: kokoro_tts.py --text-file t.txt --out vo.wav --voice af_heart --speed 1.0 --model-dir <dir> [--lexicon lex.json]
import argparse, json, os, re, sys

p = argparse.ArgumentParser()
p.add_argument("--text-file", required=True)
p.add_argument("--out", required=True)
p.add_argument("--voice", default="af_heart")
p.add_argument("--speed", type=float, default=1.0)
p.add_argument("--model-dir", required=True)
p.add_argument("--lexicon", default=None)  # JSON {word: espeak-IPA}
a = p.parse_args()

import soundfile as sf
from kokoro_onnx import Kokoro

model = os.path.join(a.model_dir, "kokoro-v1.0.onnx")
voices = os.path.join(a.model_dir, "voices-v1.0.bin")
kokoro = None
try:
    from kokoro_onnx.config import EspeakConfig
    for lib, data in [
        ("/opt/homebrew/lib/libespeak-ng.dylib", "/opt/homebrew/share/espeak-ng-data"),
        ("/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1", "/usr/lib/x86_64-linux-gnu/espeak-ng-data"),
        ("/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1", "/usr/share/espeak-ng-data"),
    ]:
        if os.path.exists(lib):
            kokoro = Kokoro(model, voices, espeak_config=EspeakConfig(lib_path=lib, data_path=data))
            break
except Exception:
    kokoro = None
if kokoro is None:
    kokoro = Kokoro(model, voices)

text = open(a.text_file, encoding="utf-8").read().strip()
LEX = {}
if a.lexicon and os.path.exists(a.lexicon):
    LEX = json.load(open(a.lexicon, encoding="utf-8"))

# validate lexicon entries against the model vocab (engine drops unknown chars SILENTLY)
vocab = set(kokoro.tokenizer.get_vocab() if hasattr(kokoro.tokenizer, "get_vocab") else [])
if not vocab:
    try:
        cfg = json.load(open(os.path.join(os.path.dirname(model), "config.json")))
        vocab = set(cfg.get("vocab", {}).keys())
    except Exception:
        vocab = set()
dropped = {w: [c for c in ipa if vocab and c not in vocab] for w, ipa in LEX.items()}
LEX = {w: ipa for w, ipa in LEX.items() if not dropped.get(w) or not any(dropped[w])}

# VOICE (fix K, owner 2026-07-03): support a BLEND spec "af_heart:55,af_bella:45" — af_heart is one of
# the flatter voices; blending in af_bella (highest measured pitch/energy variance) adds dynamics while
# keeping af_heart's warmth. kokoro-onnx get_voice_style() returns the (510,1,256) style vector.
def resolve_voice(spec):
    import numpy as np
    if "," not in spec and ":" not in spec:
        return spec  # a plain voice name
    parts = []
    for chunk in spec.split(","):
        name, _, w = chunk.strip().partition(":")
        parts.append((name.strip(), float(w) if w else 1.0))
    total = sum(w for _, w in parts) or 1.0
    try:
        vec = None
        for name, w in parts:
            sv = np.array(kokoro.get_voice_style(name))
            vec = sv * (w / total) if vec is None else vec + sv * (w / total)
        return vec
    except Exception:
        return parts[0][0]  # blend unsupported → fall back to the first named voice

VOICE = resolve_voice(a.voice)

def phonemize_sentence(s):
    """Splice: lexicon words become exact IPA; everything else goes through the engine's own G2P."""
    if not LEX:
        return kokoro.tokenizer.phonemize(s, "en-us").strip()
    pat = re.compile(r"(\b(?:%s)\b)" % "|".join(re.escape(w) for w in sorted(LEX, key=len, reverse=True)))
    parts = [q for q in pat.split(s) if q and q.strip()]
    out = []
    for q in parts:
        out.append(LEX[q] if q in LEX else kokoro.tokenizer.phonemize(q, "en-us").strip())
    return " ".join(out)

# PER-SENTENCE synthesis (fix K): each sentence gets its own prosody contour + a slight speed contour
# (hook push-in, body neutral, payoff punch) + inserted inter-sentence silence — measured +25.6% dynamics
# vs a single flat call. Concatenate with 160ms pauses so the delivery breathes.
import numpy as np
sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
nS = len(sentences)
segs, sr = [], 24000
for i, s in enumerate(sentences):
    if nS >= 3 and i == 0:      spd = a.speed + 0.05   # HOOK — push in
    elif nS >= 3 and i >= nS-2: spd = a.speed + 0.04   # PAYOFF/TURN — punch
    else:                       spd = a.speed          # body — neutral
    smp, sr = kokoro.create(phonemize_sentence(s), voice=VOICE, speed=spd, is_phonemes=True, trim=True)
    if len(smp):
        segs.append(np.asarray(smp, dtype="float32"))
        if i < nS - 1: segs.append(np.zeros(int(sr * 0.16), dtype="float32"))  # 160ms breath
samples = np.concatenate(segs) if segs else np.zeros(0, dtype="float32")
if len(samples) == 0:
    print(json.dumps({"error": "empty audio"})); sys.exit(1)
sf.write(a.out, samples, sr)
step = max(1, len(samples) // 20000)
sub = samples[::step]
rms = float((sum(float(x) * float(x) for x in sub) / max(1, len(sub))) ** 0.5)
print(json.dumps({"duration": round(len(samples) / sr, 3), "sample_rate": sr, "rms": round(rms, 4), "lexHits": [w for w in LEX if re.search(r"\b%s\b" % re.escape(w), text)]}))
