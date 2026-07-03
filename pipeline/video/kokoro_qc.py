# PRONUNCIATION QC — cold-pass ASR round-trip (faster-whisper tiny.en int8, CPU). Transcribes the
# finished voiceover WITHOUT name biasing (biasing masks failures) and diffs against the expected SAY
# text. Warn-only: flags feed the sidecar + logs; capitalized/name tokens classify SOFT (tiny.en often
# can't SPELL rare names even when the audio is fine), other mismatches HARD. Design per research.
# Usage: kokoro_qc.py --wav vo.wav --expected say.txt  → JSON {hard:[], soft:[], wer}
import argparse, json, re, subprocess, tempfile, os

p = argparse.ArgumentParser()
p.add_argument("--wav", required=True)
p.add_argument("--expected", required=True)
a = p.parse_args()

# 16k mono for whisper
tmp = tempfile.mktemp(suffix=".wav")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", a.wav, "-ar", "16000", "-ac", "1", tmp], check=True)

from faster_whisper import WhisperModel
m = WhisperModel("tiny.en", device="cpu", compute_type="int8", cpu_threads=2)
segs, _ = m.transcribe(tmp, language="en", beam_size=5, temperature=0.0,
                       condition_on_previous_text=False, vad_filter=True,
                       vad_parameters={"min_silence_duration_ms": 300})
hyp = " ".join(s.text for s in segs)
os.unlink(tmp)

ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"]
TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"]
def n2w(n):
    n = int(n)
    if n < 20: return ONES[n]
    if n < 100: return TENS[n//10] + ("-" + ONES[n%10] if n%10 else "")
    if n < 1000: return ONES[n//100] + " hundred" + (" " + n2w(n%100) if n%100 else "")
    return str(n)
def norm(t):
    t = re.sub(r"\b(\d{1,3})\b", lambda m: n2w(m.group(1)), t.lower())
    return [w.replace("'", "").rstrip("s") if w.endswith("'s") or w.endswith("s'") else w.replace("'", "") for w in re.sub(r"[^a-z0-9'\- ]", " ", t).replace("-", " ").split() if w]
exp_raw = open(a.expected, encoding="utf-8").read()
E, H = norm(exp_raw), norm(hyp)
cap_words = set(w.lower().strip(".,!?'\"") for w in exp_raw.split() if w[:1].isupper())

# token alignment (LCS) → expected words missing from the hypothesis
dp = [[0] * (len(H) + 1) for _ in range(len(E) + 1)]
for i in range(len(E) - 1, -1, -1):
    for j in range(len(H) - 1, -1, -1):
        dp[i][j] = dp[i + 1][j + 1] + 1 if E[i] == H[j] else max(dp[i + 1][j], dp[i][j + 1])
i = j = 0
missed = []
while i < len(E) and j < len(H):
    if E[i] == H[j]: i += 1; j += 1
    elif dp[i + 1][j] >= dp[i][j + 1]: missed.append(E[i]); i += 1
    else: j += 1
missed += E[i:]
hard = sorted(set(w for w in missed if w not in cap_words and len(w) > 2))
soft = sorted(set(w for w in missed if w in cap_words))
wer = round(len(missed) / max(1, len(E)), 3)
print(json.dumps({"hard": hard[:12], "soft": soft[:12], "wer": wer, "hyp": hyp[:400]}))
