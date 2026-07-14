// RENDER — the LOCKED "Literary" card template → headless Chrome → 1000×1500 PNG.
// Hard-coded design (owner-approved 2026-07-14): white bg, thin red frame, photo top, Fraunces headline +
// Source Serif 4 body, red kicker, native wordmark. Only image/kicker/headline/dek change per pin.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { PIN } from "./config.mjs";

const INK = "#14120F", RED = "#C1121C", MUT = "#6f685c";
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// headline auto-fit: keep it commanding but never overflow. Scale by the longest line's length.
function headlineSize(headline) {
  const longest = Math.max(...String(headline).split(/<br\s*\/?>/i).map((l) => l.trim().length), 1);
  if (longest <= 14) return 88;
  if (longest <= 17) return 82;
  if (longest <= 20) return 74;
  if (longest <= 24) return 66;
  return 58;
}

// card = { imgDataUri, kicker, headline (may contain <br>), dek }
export function cardHtml({ imgDataUri, kicker, headline, dek }) {
  const hs = headlineSize(headline);
  const FONTS = '<link rel=preconnect href=https://fonts.googleapis.com><link rel=preconnect href=https://fonts.gstatic.com crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;1,8..60,400&display=swap" rel=stylesheet>';
  return `<!doctype html><html><head><meta charset=utf8>${FONTS}<style>
  *{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  html,body{width:1000px;height:1500px;background:#fff}
  .card{width:1000px;height:1500px;background:#fff;position:relative}
  .frame{position:absolute;inset:20px;border:4px solid ${RED};z-index:5;pointer-events:none}
  .inner{position:absolute;inset:20px;display:flex;flex-direction:column}
  .hero{height:820px;overflow:hidden;flex:none}.hero img{width:100%;height:100%;object-fit:cover;display:block}
  .body{padding:46px 52px 0;flex:1;position:relative}
  .kick{display:flex;align-items:center;gap:15px;margin-bottom:24px}
  .kick .rule{width:28px;height:2px;background:${RED}}
  .kick .lbl{font-family:'Source Serif 4';font-weight:500;font-size:19px;letter-spacing:.34em;text-transform:uppercase;color:${RED}}
  .head{font-family:Fraunces;font-weight:600;font-size:${hs}px;line-height:.98;letter-spacing:-.015em;color:${INK}}
  .dek{font-family:'Source Serif 4';font-weight:400;font-size:32px;line-height:1.5;color:#413b31;margin-top:26px;max-width:27ch}
  .foot{position:absolute;left:52px;right:52px;bottom:40px;display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid rgba(20,18,15,.14);padding-top:22px}
  .wm{font-family:Fraunces;font-weight:500;font-size:30px;color:${INK}}.wm i{font-style:italic}
  .url{font-family:'Source Serif 4';font-size:19px;letter-spacing:.2em;color:${MUT}}
  </style></head><body>
  <div class=card>
    <div class=frame></div>
    <div class=inner>
      <div class=hero><img src="${imgDataUri}"></div>
      <div class=body>
        <div class=kick><span class=rule></span><span class=lbl>${esc(kicker)}</span></div>
        <div class=head>${headline}</div>
        <div class=dek>${esc(dek)}</div>
        <div class=foot><span class=wm>The <i>Screen</i> Report<span style="color:${RED}">.</span></span><span class=url>THESCREENREPORT.COM</span></div>
      </div>
    </div>
  </div></body></html>`;
}

// render → PNG at outPng. Returns outPng.
export async function renderCard(card, outPng) {
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const htmlPath = outPng.replace(/\.png$/, ".html");
  fs.writeFileSync(htmlPath, cardHtml(card));
  await new Promise((res, rej) => {
    execFile(PIN.chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
      "--force-device-scale-factor=2", `--screenshot=${outPng}`,
      `--window-size=${PIN.width},${PIN.height}`, "--virtual-time-budget=14000", `file://${htmlPath}`,
    ], { timeout: 90000 }, (e) => (e && !fs.existsSync(outPng) ? rej(new Error("chrome render failed: " + String(e).slice(0, 120))) : res()));
  });
  if (!fs.existsSync(outPng)) throw new Error("render produced no PNG");
  return outPng;
}
