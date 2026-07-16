// RENDERER — deterministic Design-D card compositor (NOT an LLM).
// sharp attention-crops the photo into the top zone (saliency ≈ face-aware, deterministic);
// satori lays out the overlay (tab, headline, sub, credits, wordmark) with REAL font metrics
// (static fonts only — satori crashes on variable fonts); resvg rasterizes; sharp composites
// and emits one IG/FB-safe mozjpeg. Research §8: satori+resvg+sharp chosen over headless
// Chrome for pixel-determinism in CI.
import fs from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { CARDS } from "./config.mjs";

const FONTS_DIR = path.join(CARDS.assetsDir, "fonts");
let FONTS = null;
function fonts() {
  if (!FONTS) {
    FONTS = [
      { name: "Anton", data: fs.readFileSync(path.join(FONTS_DIR, "Anton-Regular.ttf")), weight: 400, style: "normal" },
      { name: "Karla", data: fs.readFileSync(path.join(FONTS_DIR, "karla-latin-400-normal.woff")), weight: 400, style: "normal" },
      { name: "Karla", data: fs.readFileSync(path.join(FONTS_DIR, "karla-latin-700-normal.woff")), weight: 700, style: "normal" },
    ];
  }
  return FONTS;
}
let WORDMARK = null; // white wordmark PNG (owner-approved raster of the native-type logo)
function wordmarkURI() {
  if (!WORDMARK) WORDMARK = "data:image/png;base64," + fs.readFileSync(path.join(CARDS.assetsDir, "logo-wordmark.png")).toString("base64");
  return WORDMARK;
}

// satori element helper (object form — no React dependency)
const h = (type, style, children, extra = {}) => ({ type, props: { style, children, ...extra } });

// Split a headline into per-WORD satori spans (satori collapses whitespace at span
// boundaries — a phrase-level red span silently ate the following space). Each word is
// its own span with a size-scaled right margin; flexWrap breaks lines at word borders.
// Words inside `redSpan` (exact substring match) go red unless somber. Uppercase render.
function headlineSpans(headline, redSpan, somber, size) {
  const text = String(headline || "").toUpperCase().replace(/\s+/g, " ").trim();
  const accent = somber ? "" : String(redSpan || "").toUpperCase().replace(/\s+/g, " ").trim();
  const i = accent ? text.indexOf(accent) : -1;
  const gap = Math.round(size * 0.24); // Anton word-space ≈ 0.24em
  const spans = [];
  let pos = 0;
  for (const word of text.split(" ")) {
    const start = text.indexOf(word, pos);
    const red = i >= 0 && start >= i && start + word.length <= i + accent.length;
    spans.push(h("span", { display: "flex", marginRight: `${gap}px`, ...(red ? { color: CARDS.redOnDark } : {}) }, word));
    pos = start + word.length;
  }
  return spans;
}

// Measure a block's rendered height at a given font size by letting satori lay it out
// with REAL metrics (width fixed, height auto), then reading the SVG height attribute.
async function measureBlock({ width, fontFamily, fontSize, lineHeight, letterSpacing = 0, weight = 400, children }) {
  const svg = await satori(
    h("div", {
      display: "flex", width: "100%", fontFamily, fontSize: `${fontSize}px`,
      lineHeight, letterSpacing: `${letterSpacing}px`, fontWeight: weight,
      color: "#fff", flexWrap: "wrap",
    }, children),
    { width, fonts: fonts() },
  );
  const m = svg.match(/height="(\d+(?:\.\d+)?)"/);
  return m ? parseFloat(m[1]) : Infinity;
}

// Shrink a text block until it fits maxHeight (headline auto-shrink, plan §6 #8).
// makeChildren(size) rebuilds the spans per candidate size (word margins scale with size).
async function fitSize({ width, maxHeight, sizes, fontFamily, lineHeight, weight, makeChildren }) {
  for (const size of sizes) {
    const children = makeChildren(size);
    const hgt = await measureBlock({ width, fontFamily, fontSize: size, lineHeight, weight, children });
    if (hgt <= maxHeight) return { size, height: hgt, children };
  }
  return null; // even the smallest size overflows → caller must reject (fail closed, never clip)
}

/**
 * Render one card.
 * job = {
 *   category: key of CARDS.categories, breaking?: boolean,
 *   headline: string (≤12 words), redSpan?: exact substring to accent,
 *   sub: string (detail line), creditLine: "PHOTO: … | VIA …",
 *   photo: Buffer | absolute path,
 * }
 * Returns { jpeg: Buffer, meta: { w, h, headlineSize, category, somber } }.
 */
export async function renderCard(job) {
  const cat = CARDS.categories[job.breaking ? "breaking" : job.category];
  if (!cat) throw new Error(`unknown category: ${job.category}`);
  const somber = cat.somber;
  const aspect = job.aspect && CARDS.canvas[job.aspect] ? job.aspect : CARDS.aspect; // per-job override (comps, A/B)
  const { w: W, h: H, photoH: PHOTO_H } = CARDS.canvas[aspect];
  const BAND_H = H - PHOTO_H;
  const M = 60; // side margin (safe-zone research: 60-80px)

  // ── photo: cover-crop into the top zone; attention strategy = saliency/face-aware
  const photoBuf = Buffer.isBuffer(job.photo) ? job.photo : fs.readFileSync(job.photo);
  const photo = await sharp(photoBuf)
    .resize(W, PHOTO_H, { fit: "cover", position: sharp.strategy.attention })
    .removeAlpha()
    .toBuffer();

  // ── headline: fit within the band (max 3 lines by construction: sizes floor at 56px)
  const subText = String(job.sub || "").trim();
  const headlineFit = await fitSize({
    width: W - 2 * M,
    maxHeight: Math.round(BAND_H * 0.52),
    sizes: aspect === "4x5" ? [88, 82, 76, 70, 64, 58] : [84, 78, 72, 66, 60, 56],
    fontFamily: "Anton",
    lineHeight: 1.09,
    weight: 400,
    makeChildren: (size) => headlineSpans(job.headline, job.redSpan, somber, size),
  });
  if (!headlineFit) throw new Error(`headline does not fit at minimum size: "${job.headline}"`);
  const spans = headlineFit.children;

  const tabBg = somber ? CARDS.charcoal : CARDS.red;
  const TAB_OVERLAP = 42; // tab bridges the photo/band seam (the approved D signature)

  // ── overlay tree (transparent over the photo zone; band owns the bottom)
  const tree = h("div", { width: "100%", height: "100%", display: "flex", flexDirection: "column", position: "relative", fontFamily: "Karla" }, [
    // photo credit pill (on-photo, top-right)
    h("div", {
      position: "absolute", top: "24px", right: "28px", display: "flex",
      backgroundColor: "rgba(0,0,0,0.40)", borderRadius: "4px", padding: "8px 14px",
      color: "rgba(255,255,255,0.85)", fontSize: "19px", letterSpacing: "2.3px", fontWeight: 700,
    }, String(job.creditLine || "").toUpperCase()),
    // ink band
    h("div", { position: "absolute", top: `${PHOTO_H}px`, left: "0", width: `${W}px`, height: `${BAND_H}px`, display: "flex", backgroundColor: CARDS.ink }),
    // category tab bridging the seam
    h("div", {
      position: "absolute", top: `${PHOTO_H - TAB_OVERLAP}px`, left: `${M}px`, display: "flex",
      backgroundColor: tabBg, color: "#ffffff", fontFamily: "Anton", fontSize: "33px",
      letterSpacing: "6.6px", padding: "16px 28px 13px 33px", boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
    }, cat.label),
    // headline
    h("div", {
      position: "absolute", top: `${PHOTO_H + 74}px`, left: `${M}px`, width: `${W - 2 * M}px`,
      display: "flex", flexWrap: "wrap", fontFamily: "Anton", fontSize: `${headlineFit.size}px`,
      lineHeight: 1.09, color: "#ffffff",
    }, spans),
    // sub-line (detail) — right margin leaves room for the wordmark block
    h("div", {
      position: "absolute", top: `${PHOTO_H + 74 + headlineFit.height + 26}px`, left: `${M}px`, width: `${W - M - 340}px`,
      display: "flex", flexWrap: "wrap", fontSize: "29px", lineHeight: 1.38, color: CARDS.subGray, fontWeight: 400,
    }, subText),
    // wordmark + handle, bottom-right of the band
    h("div", { position: "absolute", right: `${M}px`, bottom: "48px", display: "flex", flexDirection: "column", alignItems: "flex-end" }, [
      h("img", { height: "34px", opacity: 0.92 }, undefined, { src: wordmarkURI(), height: 34 }),
      h("div", { display: "flex", marginTop: "10px", color: "#5A5A5A", fontSize: "19px", letterSpacing: "3.4px", fontWeight: 700 }, CARDS.handle),
    ]),
  ]);

  const svg = await satori(tree, { width: W, height: H, fonts: fonts() });
  const overlay = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();

  // ── composite: ink canvas ← photo (top) ← overlay (full)
  const jpeg = await sharp({ create: { width: W, height: H, channels: 3, background: CARDS.ink } })
    .composite([
      { input: photo, top: 0, left: 0 },
      { input: overlay, top: 0, left: 0 },
    ])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  if (jpeg.length > 1_000_000) throw new Error(`card jpeg unexpectedly large: ${jpeg.length}B`); // IG/FB safety (<1MB contract)

  return { jpeg, meta: { w: W, h: H, headlineSize: headlineFit.size, category: job.breaking ? "breaking" : job.category, somber } };
}
