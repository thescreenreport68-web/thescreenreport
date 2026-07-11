#!/usr/bin/env python3
"""N-ADAPTIVE FRAME COMPOSER (REV 3 — port of the owner-approved 2026-07-03 formula).
Not templates — a FORMULA for any N (1..6): N<=3 -> N stacked full-width bands;
N>3 -> rows of 2, odd remainder becomes one full-width row. Mode "hero": main panel
(~62% height) + an evenly split bottom strip of faces. Brand system on every frame:
ink background, red dividers, Anton name chips. Every cell is face-cropped.

Usage: compose.py --out o.jpg --mode grid|hero --cells "file|LABEL,file|LABEL,..."
       [--hero "file|LABEL"] --font Anton.ttf [--w 2700] [--h 4800]
"""
import argparse, sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

INK = (16, 16, 16)
RED = (217, 33, 40)
DIV = 12  # divider thickness

CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
PROFILE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")


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


def face_center(pil):
    img = cv2.cvtColor(np.asarray(pil.convert("RGB")), cv2.COLOR_RGB2BGR)
    faces = detect_faces(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    return (x + w / 2, y + h / 2)


def fill_cell(src_path, cw, ch):
    """Cover-fill crop of (cw,ch), keeping the largest face near the cell's upper-center."""
    pil = ImageOps.exif_transpose(Image.open(src_path)).convert("RGB")
    w, h = pil.size
    ratio = cw / ch
    if w / h > ratio:
        crop_h, crop_w = h, int(h * ratio)
    else:
        crop_w, crop_h = w, int(w / ratio)
    fc = face_center(pil)
    if fc:
        cx, cy = fc
        left = int(min(max(0, cx - crop_w / 2), w - crop_w))
        top = int(min(max(0, cy - crop_h * 0.38), h - crop_h))
    else:
        # no face found (angled profiles beat the Haar cascade) — bias to the TOP of the
        # source: portrait/editorial shots keep heads high, so this keeps faces in frame
        left, top = (w - crop_w) // 2, max(0, (h - crop_h) // 8)
    return pil.crop((left, top, left + crop_w, top + crop_h)).resize((cw, ch), Image.LANCZOS)


def boxes_for(n, x0, y0, w, h):
    """The formula: n<=3 -> n rows x 1 col; n>3 -> rows of 2, odd remainder = 1 full-width row."""
    rows = [1] * n if n <= 3 else [2] * (n // 2) + ([1] if n % 2 else [])
    out = []
    rh = (h - (len(rows) - 1) * DIV) // len(rows)
    y = y0
    for cols in rows:
        cw = (w - (cols - 1) * DIV) // cols
        x = x0
        for _ in range(cols):
            out.append((x, y, cw, rh))
            x += cw + DIV
        y += rh + DIV
    return out


def name_chip(draw, canvas, label, x, y, cw, ch, font):
    if not label:
        return
    pad = 26
    try:
        bbox = draw.textbbox((0, 0), label, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except Exception:
        tw, th = len(label) * 30, 54
    cx = x + (cw - tw) // 2
    cy = y + ch - th - pad * 2 - 30
    draw.rectangle([cx - pad, cy - pad // 2, cx + tw + pad, cy + th + pad], fill=INK)
    draw.rectangle([cx - pad, cy + th + pad - 8, cx + tw + pad, cy + th + pad], fill=RED)
    draw.text((cx + 2, cy + 2), label, font=font, fill=(0, 0, 0))
    draw.text((cx, cy), label, font=font, fill=(255, 255, 255))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--mode", default="grid", choices=["grid", "hero"])
    p.add_argument("--cells", required=True)
    p.add_argument("--hero", default=None)
    p.add_argument("--font", required=True)
    p.add_argument("--w", type=int, default=2700)
    p.add_argument("--h", type=int, default=4800)
    a = p.parse_args()

    W, H = a.w, a.h
    cells = [c.split("|", 1) for c in a.cells.split(",") if c.strip()][:6]
    cells = [(c[0], c[1] if len(c) > 1 else "") for c in cells]
    canvas = Image.new("RGB", (W, H), INK)
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype(a.font, 84)
    except Exception:
        font = ImageFont.load_default()

    if a.mode == "hero" and a.hero:
        hf, hl = (a.hero.split("|", 1) + [""])[:2]
        hero_h = int(H * 0.62)
        canvas.paste(fill_cell(hf, W, hero_h), (0, 0))
        draw.rectangle([0, hero_h, W, hero_h + DIV], fill=RED)
        strip_y = hero_h + DIV
        for (x, y, cw, ch), (f, label) in zip(boxes_for(len(cells), 0, strip_y, W, H - strip_y) if cells else [], cells):
            canvas.paste(fill_cell(f, cw, ch), (x, y))
            name_chip(draw, canvas, label, x, y, cw, ch, font)
        if hl:
            name_chip(draw, canvas, hl, 0, 0, W, hero_h, font)
    else:
        for (x, y, cw, ch), (f, label) in zip(boxes_for(len(cells), 0, 0, W, H), cells):
            canvas.paste(fill_cell(f, cw, ch), (x, y))
            name_chip(draw, canvas, label, x, y, cw, ch, font)
        # red dividers over the seams
        n = len(cells)
        rows = [1] * n if n <= 3 else [2] * (n // 2) + ([1] if n % 2 else [])
        rh = (H - (len(rows) - 1) * DIV) // len(rows)
        y = rh
        for _ in range(len(rows) - 1):
            draw.rectangle([0, y, W, y + DIV], fill=RED)
            y += rh + DIV
        if any(r == 2 for r in rows):
            draw.rectangle([(W - DIV) // 2, 0, (W + DIV) // 2, y], fill=RED)

    canvas.save(a.out, "JPEG", quality=90)
    print("ok")


if __name__ == "__main__":
    main()
