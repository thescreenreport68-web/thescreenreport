# N-ADAPTIVE FRAME COMPOSER (the Visual Brain's layout engine, owner-approved plan 2026-07-03).
# Not templates — a FORMULA for any N (1..6): N<=3 -> N stacked bands; N>3 -> 2-column rows, odd
# remainder becomes one full-width row ([2,2],[2,2,1],[2,2,2]...). Second mode "hero": main panel
# (~62%) + an evenly split bottom strip of K mentioned faces (K auto-computed). Brand system on
# every cell: ink bg, red dividers, Anton name chips with drop shadow.
# Usage: compose_grid.py --out o.jpg --mode grid|hero --cells "file|LABEL,..." [--hero "file|LABEL"] --font Anton.ttf
import argparse
from PIL import Image, ImageDraw, ImageFont

INK = (16, 16, 16)
RED = (217, 33, 40)
W, H = 2160, 3840
DIV = 10

p = argparse.ArgumentParser()
p.add_argument("--out", required=True)
p.add_argument("--mode", default="grid", choices=["grid", "hero"])
p.add_argument("--cells", required=True)
p.add_argument("--hero", default=None)
p.add_argument("--font", required=True)
a = p.parse_args()

cells = [c.split("|", 1) for c in a.cells.split(",") if c.strip()][:6]
canvas = Image.new("RGB", (W, H), INK)
draw = ImageDraw.Draw(canvas)

def boxes_for(n, x0, y0, w, h):
    """The formula: n<=3 -> n rows x 1 col; n>3 -> rows of 2, odd remainder = 1 full-width row."""
    rows = [1] * n if n <= 3 else [2] * (n // 2) + ([1] if n % 2 else [])
    out, rh = [], (h - (len(rows) - 1) * DIV) // len(rows)
    for r, ncols in enumerate(rows):
        ry = y0 + r * (rh + DIV)
        cw = (w - (ncols - 1) * DIV) // ncols
        for c in range(ncols):
            out.append((x0 + c * (cw + DIV), ry, cw, rh))
    return out

def cover(im, bw, bh):
    s = max(bw / im.width, bh / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x = (im.width - bw) // 2
    y = min(max(0, round(im.height * 0.08)), im.height - bh)
    return im.crop((x, y, x + bw, y + bh))

def chip(bx, by, bh, label, size):
    f = ImageFont.truetype(a.font, size)
    label = label.strip().upper()
    tw = draw.textlength(label, font=f)
    px, py = int(size * 0.36), int(size * 0.24)
    cx, cy = bx + 40, by + bh - size - 2 * py - 36
    draw.rectangle([cx + 6, cy + 8, cx + tw + 2 * px + 6, cy + size + 2 * py + 8], fill=(0, 0, 0))
    draw.rectangle([cx, cy, cx + tw + 2 * px, cy + size + 2 * py], fill=RED)
    draw.text((cx + px, cy + py - size * 0.06), label, font=f, fill=(255, 255, 255))

if a.mode == "hero" and a.hero:
    hf, hl = a.hero.split("|", 1)
    hero_h = round(H * 0.62)
    canvas.paste(cover(Image.open(hf).convert("RGB"), W, hero_h), (0, 0))
    if hl.strip():
        chip(0, 0, hero_h, hl, 92)
    # the mention strip: K columns side-by-side under the hero (K auto-computed, <=4)
    k = min(len(cells), 4)
    cw = (W - (k - 1) * DIV) // k
    strip = [(i * (cw + DIV), hero_h + DIV, cw, H - hero_h - DIV) for i in range(k)]
    for (f, label), (bx, by, bw, bh) in zip(cells[:k], strip):
        canvas.paste(cover(Image.open(f).convert("RGB"), bw, bh), (bx, by))
        chip(bx, by, bh, label, 56)
else:
    for (f, label), (bx, by, bw, bh) in zip(cells, boxes_for(len(cells), 0, 0, W, H)):
        canvas.paste(cover(Image.open(f).convert("RGB"), bw, bh), (bx, by))
        chip(bx, by, bh, label, 84 if len(cells) <= 3 else 72)

canvas.save(a.out, quality=92)
print(a.out)
