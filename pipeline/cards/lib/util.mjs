// Small shared helpers for the cards lane (state I/O, fetch, LA-time math).
import fs from "node:fs";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

export function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, p); // atomic — a crashed run never leaves a torn ledger
}

import { createHash } from "node:crypto";
// non-Latin/all-symbol titles slug to "" → hosted-file collisions + dup-guard bypass (audit D4);
// fall back to a deterministic content hash so every title gets a unique, path-safe slug
export const slugify = (s) => {
  const base = String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return base || `card-${createHash("sha256").update(String(s || "")).digest("hex").slice(0, 10)}`;
};

// LA-date key ("2026-07-16") and LA hour for slot math — the lane thinks in LA time like every other lane.
export function laParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

// crude-but-sufficient HTML → text (same approach the ig lane uses for source excerpts)
export function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// minimal RSS/Atom item parser — titles, links, pubDates (regex; feeds are machine-generated)
export function parseFeed(xml) {
  const items = [];
  const blocks = String(xml || "").match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const pick = (re) => { const m = b.match(re); return m ? m[1].trim() : ""; };
    const title = htmlToText(pick(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i));
    let link = pick(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    if (!link) link = pick(/<link[^>]*href="([^"]+)"/i);
    const pub = pick(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i);
    const t = Date.parse(pub);
    if (title && link) items.push({ title, link, publishedAt: Number.isFinite(t) ? t : null });
  }
  return items;
}
