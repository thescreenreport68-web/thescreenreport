# PHASE 4 — FACE-FIT (owner rules 2026-07-03): the 9:16 crop window must be chosen around the FACES,
# never the blind center; if the faces cannot all fit at readable size the image is REJECTED for
# full-bleed use (caller falls back to stacked individual portraits). Local OpenCV — free, ~50ms.
# Usage: face_crop.py --in img.jpg --out cropped.jpg [--aspect 0.5625]
# Prints JSON: {"faces": N, "fitted": M, "action": "cropped"|"asis"|"reject"}
import argparse, json
import cv2

p = argparse.ArgumentParser()
p.add_argument("--in", dest="inp", required=True)
p.add_argument("--out", required=True)
p.add_argument("--aspect", type=float, default=9 / 16)
p.add_argument("--mode", default="person", choices=["person", "scene"])
a = p.parse_args()

img = cv2.imread(a.inp)
if img is None:
    print(json.dumps({"faces": 0, "fitted": 0, "action": "reject", "err": "unreadable"})); raise SystemExit(0)

# F (owner 2026-07-03): auto-correct too-dark / washed-out frames so every shot reads on a phone in
# daylight. Gentle gamma toward a target mean luminance + a mild contrast (CLAHE) lift on very-flat images.
def autolevel(im):
    import numpy as np
    lum = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    mean = float(lum.mean())
    if 70 <= mean <= 200:
        g = 1.0
    else:
        target = 118.0
        g = max(0.45, min(2.2, (mean / target) ** 0.75)) if mean > 0 else 1.0  # gamma = (mean/target)^k
    if abs(g - 1.0) > 0.03:
        lut = np.array([((i / 255.0) ** g) * 255 for i in range(256)], dtype="uint8")
        im = cv2.LUT(im, lut)
    if float(lum.std()) < 38:  # very flat → mild contrast lift in luminance
        ycrcb = cv2.cvtColor(im, cv2.COLOR_BGR2YCrCb)
        ycrcb[:, :, 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(ycrcb[:, :, 0])
        im = cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)
    return im

def write(im):
    cv2.imwrite(a.out, autolevel(im), [cv2.IMWRITE_JPEG_QUALITY, 92])

H, W = img.shape[:2]
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
mn = max(40, int(min(W, H) * 0.08))  # ignore tiny background faces
faces = list(cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(mn, mn)))
faces.sort(key=lambda f: -(f[2] * f[3]))
faces = faces[:4]  # the main subjects

# the 9:16 window at maximum size inside the source
cw = min(W, int(H * a.aspect)); ch = int(cw / a.aspect)
if ch > H: ch = H; cw = int(ch * a.aspect)

if not faces:
    write(img)  # scenes/posters: no crop, but STILL brightness-corrected (fix F: dark scene stills)
    print(json.dumps({"faces": 0, "fitted": 0, "action": "leveled"})); raise SystemExit(0)

# face cluster bbox with breathing margin (a face needs headroom, not a guillotine crop)
x1 = min(f[0] for f in faces); y1 = min(f[1] for f in faces)
x2 = max(f[0] + f[2] for f in faces); y2 = max(f[1] + f[3] for f in faces)
mx = int((x2 - x1) * 0.15) + 10; my = int((y2 - y1) * 0.35) + 10  # extra headroom above/below
raw_w, raw_h = x2 - x1, y2 - y1  # rejection is decided on the RAW face box — margins are best-effort
x1, y1, x2, y2 = max(0, x1 - mx), max(0, y1 - my), min(W, x2 + mx), min(H, y2 + my)

if raw_w > cw or raw_h > ch:
    if a.mode == "person":
        # the faces cannot fit one 9:16 frame — REJECT full-bleed (caller stacks individual portraits)
        print(json.dumps({"faces": len(faces), "fitted": 0, "action": "reject"})); raise SystemExit(0)
    # scene mode (title art / outlet photos / hero): never reject — center on the LARGEST face
    fx, fy, fw, fh = faces[0]
    cx0, cy0 = fx + fw // 2, fy + fh // 2
    left = min(max(0, cx0 - cw // 2), W - cw)
    top = min(max(0, cy0 - int(ch * 0.38)), H - ch)
    write(img[top : top + ch, left : left + cw])
    print(json.dumps({"faces": len(faces), "fitted": 1, "action": "cropped"})); raise SystemExit(0)

# slide the window to center the face cluster (clamped to the image)
cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
left = min(max(0, cx - cw // 2), W - cw)
# faces sit in the upper part of a good vertical frame: aim cluster center at ~38% height
top = min(max(0, cy - int(ch * 0.38)), H - ch)
write(img[top : top + ch, left : left + cw])
print(json.dumps({"faces": len(faces), "fitted": len(faces), "action": "cropped"}))
