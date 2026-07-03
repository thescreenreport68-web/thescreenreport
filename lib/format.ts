// All editorial timestamps are pinned to ET (the newsroom convention THR follows);
// without an explicit timeZone the static build would stamp whatever TZ the build
// machine runs in.
const ET = "America/New_York";

export function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: ET,
  });
}

// "Jul 1, 2026" — for the mono metadata layer (rendered uppercase by .meta-mono).
export function formatDateShort(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: ET,
  });
}

export function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ET,
  })} ET`;
}

// Relative under 24h ("38 min ago", "6 hrs ago"), absolute after ("Jul 1, 2026").
// Computed at build time — the site rebuilds on every publish, so drift stays small.
export function formatRelative(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 24 * 60) {
    const hrs = Math.round(mins / 60);
    return `${hrs} ${hrs === 1 ? "hr" : "hrs"} ago`;
  }
  return formatDateShort(iso);
}
