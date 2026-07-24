#!/usr/bin/env python3
"""Kokoro fallback voice (plan §5.5): $0 local synthesis with the proven af_heart+af_bella
blend, per-sentence speed contour for energy. Fresh minimal implementation for the IG lane."""
import argparse, os, re

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--models", required=True)
    args = ap.parse_args()

    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(os.path.join(args.models, "kokoro-v1.0.onnx"),
                    os.path.join(args.models, "voices-v1.0.bin"))
    blend = kokoro.get_voice_style("af_heart") * 0.55 + kokoro.get_voice_style("af_bella") * 0.45

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", args.text) if s.strip()]
    chunks, sr = [], 24000
    for i, sent in enumerate(sentences):
        speed = 1.08 if i == 0 else (0.97 if i == len(sentences) - 1 else 1.02)
        samples, sr = kokoro.create(sent, voice=blend, speed=speed, lang="en-us")
        # trim leading/trailing silence, then a varied inter-sentence gap
        idx = np.where(np.abs(samples) > 0.01)[0]
        if len(idx):
            samples = samples[max(0, idx[0] - 240): idx[-1] + 240]
        chunks.append(samples)
        chunks.append(np.zeros(int(sr * (0.15 + 0.05 * (i % 3))), dtype=samples.dtype))
    sf.write(args.out, np.concatenate(chunks), sr)

if __name__ == "__main__":
    main()
