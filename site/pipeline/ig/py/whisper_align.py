#!/usr/bin/env python3
"""Verbatim wall + forced alignment (plan agent 14): transcribe the voiceover with
faster-whisper and emit word-level timestamps as JSON. Local, free, CPU."""
import argparse, json, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--model", default="small.en")
    args = ap.parse_args()

    from faster_whisper import WhisperModel
    # explicit cache dir so CI can cache the ~490MB model (env WHISPER_CACHE)
    cache = os.environ.get("WHISPER_CACHE")
    model = WhisperModel(args.model, device="cpu", compute_type="int8",
                         download_root=cache if cache else None)
    segments, info = model.transcribe(args.audio, word_timestamps=True, beam_size=5, language="en")

    words, text_parts = [], []
    for seg in segments:
        text_parts.append(seg.text)
        for w in seg.words or []:
            words.append({"w": w.word.strip(), "t0": round(w.start, 3), "t1": round(w.end, 3)})

    json.dump({"text": " ".join(t.strip() for t in text_parts).strip(),
               "words": words,
               "duration": round(info.duration, 3)}, sys.stdout)

if __name__ == "__main__":
    main()
