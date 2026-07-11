#!/usr/bin/env python3
"""AGENT 12 — FRAMING (plan §2.2 #12): faces fully in frame, full-bleed crop to the
target canvas, luminance auto-correct. Fresh implementation for the IG lane (cv2 + PIL).
Reads a JSON job list: [{"src":..., "dst":..., "w":2700, "h":4800}] — batch = one process."""
import json, sys

import numpy as np
from PIL import Image, ImageEnhance, ImageOps

# cv2 is used ONLY for face detection (a framing ENHANCEMENT). On some CI runners the
# opencv-python-headless native extension half-loads against a mismatched numpy ABI — cv2
# imports but `cv2.CascadeClassifier` is missing, which used to crash this whole script at
# module load and HOLD the video. Face detection is optional: if cv2 or the cascades are
# unavailable, degrade to a center/upper-third crop (best_face → None) and still ship. (2026-07-11)
FACE_OK = False
cv2 = None
CASCADE = PROFILE = None
try:
    import cv2 as _cv2
    CASCADE = _cv2.CascadeClassifier(_cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    PROFILE = _cv2.CascadeClassifier(_cv2.data.haarcascades + "haarcascade_profileface.xml")
    if CASCADE.empty() or PROFILE.empty():
        raise RuntimeError("haar cascade failed to load")
    cv2 = _cv2
    FACE_OK = True
except Exception as e:
    sys.stderr.write(f"face_crop: face detection disabled ({type(e).__name__}: {e}) — center-crop fallback\n")


def detect_faces(gray):
    """Frontal first; angled celebrity shots need the profile cascade (both directions)."""
    faces = CASCADE.detectMultiScale(gray, 1.1, 5, minSize=(36, 36))
    if len(faces):
        return faces
    faces = PROFILE.detectMultiScale(gray, 1.1, 4, minSize=(36, 36))
    if len(faces):
        return faces
    import numpy as _np
    flipped = PROFILE.detectMultiScale(_np.ascontiguousarray(gray[:, ::-1]), 1.1, 4, minSize=(36, 36))
    if len(flipped):
        return [(gray.shape[1] - x - w, y, w, h) for (x, y, w, h) in flipped]
    return []

def best_face(pil_rgb):
    if not FACE_OK:
        return None
    img_bgr = cv2.cvtColor(np.asarray(pil_rgb), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    faces = detect_faces(gray)
    if len(faces) == 0:
        return None
    return max(faces, key=lambda f: f[2] * f[3])  # largest

def luminance_fix(pil):
    g = np.asarray(pil.convert("L"), dtype=np.float32)
    mean = g.mean()
    if mean < 70:      # too dark → gentle lift
        pil = ImageEnhance.Brightness(pil).enhance(min(1.45, 100.0 / max(mean, 1)))
        pil = ImageEnhance.Contrast(pil).enhance(1.08)
    elif mean > 195:   # blown out → tone down
        pil = ImageEnhance.Brightness(pil).enhance(0.88)
    if mean < 12 or mean > 243:
        return None    # uncorrectable
    return pil

def process(src, dst, tw, th):
    pil = Image.open(src)
    pil = ImageOps.exif_transpose(pil).convert("RGB")
    pil = luminance_fix(pil)
    if pil is None:
        return {"src": src, "ok": False, "reason": "uncorrectable-luminance"}
    w, h = pil.size
    if w < 450:
        return {"src": src, "ok": False, "reason": f"too-small-{w}px"}
    # crop-vs-target gate, calibrated to the DISPLAY size (1080x1920 — the 2700x4800
    # canvas is downscaled for output, so a ~500px crop is a fine ~2x upscale; the gate
    # exists only to reject landscape slivers that would blow up 4x+ into mush)
    target_ratio = tw / th
    eff_cw = min(w, int(h * target_ratio))
    eff_ch = min(h, int(w / target_ratio))
    if eff_cw < 420 or eff_ch < 760:
        return {"src": src, "ok": False, "reason": f"crop-too-small-{eff_cw}x{eff_ch}"}

    face = best_face(pil)  # None when cv2 face detection is unavailable → center-crop below

    # cover-fill crop of tw:th with the face kept in the upper-center third
    target_ratio = tw / th
    if w / h > target_ratio:
        ch, cw = h, int(h * target_ratio)
    else:
        cw, ch = w, int(w / target_ratio)
    if face is not None:
        fx, fy, fw, fh = face
        cx = int(fx + fw / 2)
        cy_target = int(fy + fh / 2 - ch * 0.12)  # face slightly above center
        left = min(max(0, cx - cw // 2), w - cw)
        top = min(max(0, cy_target - ch // 3), h - ch)
        # never crop the face out
        top = min(top, max(0, fy - int(0.15 * fh)))
        left = max(0, min(left, w - cw))
        top = max(0, min(top, h - ch))
    else:
        left, top = (w - cw) // 2, max(0, (h - ch) // 4)

    crop = pil.crop((left, top, left + cw, top + ch)).resize((tw, th), Image.LANCZOS)
    crop.save(dst, "JPEG", quality=90)
    return {"src": src, "ok": True, "face": face is not None}

def safe_process(j):
    try:
        return process(j["src"], j["dst"], j.get("w", 2700), j.get("h", 4800))
    except Exception as e:  # one undecodable image must not kill the whole batch
        return {"src": j.get("src"), "ok": False, "reason": f"error:{type(e).__name__}:{e}"}

def main():
    jobs = json.load(open(sys.argv[1]))
    print(json.dumps([safe_process(j) for j in jobs]))

if __name__ == "__main__":
    main()
