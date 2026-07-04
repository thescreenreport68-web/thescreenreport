# NAME PRONUNCIATION VERIFICATION LOOP (owner 2026-07-03: names must be HEARD correctly, not guessed).
# For each candidate pronunciation of each name: synthesize it with the production voice, transcribe it
# back with ASR, report what a listener hears. The JS side picks the candidate whose audio is heard as
# the real name — as-spelled is the default winner; a respelling must EARN its place by ear.
# Usage: name_test.py --model-dir DIR --json '{"Jason Momoa": ["Jason Momoa", "JAY-sun muh-MOH-uh"]}'
# Prints: {"Jason Momoa": {"Jason Momoa": "jason momoa", "JAY-sun muh-MOH-uh": "jason mimoa"}}
import argparse, json, tempfile, os

p = argparse.ArgumentParser()
p.add_argument("--model-dir", required=True)
p.add_argument("--json", required=True)
a = p.parse_args()

import soundfile as sf
from kokoro_onnx import Kokoro
from faster_whisper import WhisperModel

kokoro = None
try:
    from kokoro_onnx.config import EspeakConfig
    for lib, data in [("/opt/homebrew/lib/libespeak-ng.dylib", "/opt/homebrew/share/espeak-ng-data"),
                      ("/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1", "/usr/lib/x86_64-linux-gnu/espeak-ng-data")]:
        if os.path.exists(lib):
            kokoro = Kokoro(os.path.join(a.model_dir, "kokoro-v1.0.onnx"), os.path.join(a.model_dir, "voices-v1.0.bin"),
                            espeak_config=EspeakConfig(lib_path=lib, data_path=data))
            break
except Exception:
    kokoro = None
if kokoro is None:
    kokoro = Kokoro(os.path.join(a.model_dir, "kokoro-v1.0.onnx"), os.path.join(a.model_dir, "voices-v1.0.bin"))
asr = WhisperModel("tiny.en", device="cpu", compute_type="int8", cpu_threads=2)

out = {}
for name, cands in json.loads(a.json).items():
    out[name] = {}
    for c in cands:
        try:
            # a carrier sentence gives ASR context; the name is what we grade
            if c.startswith("ipa:"):
                pre = kokoro.tokenizer.phonemize("Tonight,", "en-us").strip()
                post = kokoro.tokenizer.phonemize("arrives in Hollywood.", "en-us").strip()
                samples, sr = kokoro.create(f"{pre} {c[4:]} {post}", voice="af_heart", speed=1.0, is_phonemes=True)
            else:
                samples, sr = kokoro.create(f"Tonight, {c} arrives in Hollywood.", voice="af_heart", speed=1.0, lang="en-us")
            tmp = tempfile.mktemp(suffix=".wav"); sf.write(tmp, samples, sr)
            segs, _ = asr.transcribe(tmp, language="en", beam_size=5, temperature=0.0, condition_on_previous_text=False)
            heard = " ".join(s.text for s in segs).lower()
            os.unlink(tmp)
            import re as _re
            out[name][c] = _re.sub(r"tonight,?|arriv\w* in hollywood\.?|would arrive in hollywood\.?", "", heard).strip(" .,")
        except Exception as e:
            out[name][c] = "__err__"
print(json.dumps(out))
