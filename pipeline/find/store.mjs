// FIND-engine state + run MONITOR. Everything is plain inspectable JSON under site/data/find/ so the
// whole process can be watched and audited (Cloudflare D1 is the cloud path later). The monitor is
// the observability layer: it records what every stage discovered/decided and verifies each article's
// data is COMPLETE before it is allowed to publish.
import fs from "node:fs";
import path from "node:path";

const DIR = "/Users/sivajithcu/Movie News site/site/data/find";
fs.mkdirSync(path.join(DIR, "runs"), { recursive: true });
const fp = (f) => path.join(DIR, f);

export const readJSON = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(fp(f), "utf8"));
  } catch {
    return d;
  }
};
export const writeJSON = (f, v) => fs.writeFileSync(fp(f), JSON.stringify(v, null, 2));

// ── PUBLISHED-HISTORY DEDUP LEDGER (owner 2026-07-01: NEVER re-publish a story we already posted — it wastes
// credits, looks like doorway spam to Google, and bores the audience). A durable local-file ledger of every
// published story keyed by BOTH its outlet-agnostic eventSlug AND its title slug; FIND consults it and drops any
// candidate/topic already published within the window. (This is the D1 cloud-port's local precursor.)
const PUBLISHED_FILE = "published.json";
export const slugKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

// The ROBUST dedup key (owner 2026-07-01): a story re-reported under a slightly different headline gets a
// different title slug AND a different eventSlug across runs (that's how KVIFF regenerated). The one thing that
// stays stable is WHAT it's about + WHAT KIND of event: primaryEntity + eventType. Dedup on that too so the same
// entity's same-type event is never written twice in the window. (Deliberately coarse: we would rather occasionally
// skip a genuinely-new same-entity/same-type story than burn credits re-posting — the owner's stated priority.)
export const entityKey = (primaryEntity, eventType) => (primaryEntity && eventType ? `${slugKey(primaryEntity)}:${slugKey(eventType)}` : null);

// Returns { events:Set, titles:Set, entities:Set } of everything published in the last `windowDays` (default 45).
export function loadPublished(windowDays = 45) {
  const list = readJSON(PUBLISHED_FILE, []);
  const cutoff = Date.now() - windowDays * 24 * 3600 * 1000;
  const events = new Set(), titles = new Set(), entities = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    if (r.at && Date.parse(r.at) < cutoff) continue;
    if (r.eventSlug) events.add(r.eventSlug);
    if (r.titleKey) titles.add(r.titleKey);
    if (r.entityKey) entities.add(r.entityKey);
  }
  return { events, titles, entities };
}

// Append a published story to the ledger (deduped by slug; capped so the file can't grow unbounded).
// VIDEO-FEED FIELDS (owner 2026-07-02, Reels automation — see REELS_AUTOMATION_PLAN.md): sourceUrls/priority/
// signals/image/category are persisted here because queue.json is OVERWRITTEN every findrun — without capturing
// them at publish time, the video picker loses the popularity signals and the image-gatherer loses the source
// article URLs. All optional + ignored by loadPublished(), so the dedup ledger behavior is unchanged.
export function recordPublished({ eventSlug, titleKey, slug, title, primaryEntity, eventType, at, sourceUrls, priority, signals, image, category, verifyStatus } = {}) {
  const list = readJSON(PUBLISHED_FILE, []);
  const arr = Array.isArray(list) ? list : [];
  if (slug && arr.some((r) => r.slug === slug)) return; // already recorded
  arr.push({
    eventSlug: eventSlug || null, titleKey: titleKey || slugKey(title), entityKey: entityKey(primaryEntity, eventType), slug: slug || null, title: title || null, at: at || new Date().toISOString(),
    ...(Array.isArray(sourceUrls) && sourceUrls.length ? { sourceUrls: sourceUrls.slice(0, 8) } : {}),
    ...(Number.isFinite(priority) ? { priority } : {}),
    ...(signals && typeof signals === "object" ? { signals } : {}),
    ...(image ? { image } : {}),
    ...(category ? { category } : {}),
    // INSIDE-lane trigger fields (2026-07-03): the ripple lane triggers off published events and
    // needs the explicit eventType (entityKey folding loses it for consumers) + the verify status
    // (deaths must fail closed without a CONFIRMED). Optional + ignored by loadPublished().
    ...(eventType ? { eventType } : {}),
    ...(verifyStatus ? { verifyStatus } : {}),
  });
  writeJSON(PUBLISHED_FILE, arr.slice(-8000)); // keep the most recent ~8k
}

// A run monitor — the single source of truth for "what the automation did this run".
export function newMonitor(runId) {
  const m = {
    runId,
    startedAt: new Date().toISOString(),
    counts: {},
    stages: [], // { stage, t, msg, data? }
    articles: [], // per-topic: the full lifecycle (find -> research -> write -> gate -> publish)
  };
  const stamp = () => new Date().toISOString().slice(11, 19);
  return {
    raw: m,
    // a pipeline-level event
    stage(stage, msg, data) {
      m.stages.push({ stage, t: stamp(), msg, ...(data !== undefined ? { data } : {}) });
      console.log(`  [${stage}] ${msg}`);
    },
    count(k, v) {
      m.counts[k] = v;
    },
    // begin tracking one topic through the whole pipeline; returns a per-article recorder
    article(topic) {
      const a = {
        id: topic.id,
        slug: topic.slug,
        title: topic.title,
        category: topic.category,
        subcategory: topic.subcategory,
        formatTag: topic.formatTag,
        source: topic.source,
        steps: [],
        checks: {},
        status: "started",
      };
      m.articles.push(a);
      return {
        step(name, msg, data) {
          a.steps.push({ step: name, t: stamp(), msg, ...(data !== undefined ? { data } : {}) });
          console.log(`    ↳ ${topic.id} · ${name}: ${msg}`);
        },
        // record a pre-publish completeness check (true = collected ok)
        check(name, ok, detail) {
          a.checks[name] = { ok: !!ok, detail };
          if (!ok) console.log(`    ⚠ ${topic.id} · check FAILED: ${name}${detail ? " — " + detail : ""}`);
        },
        done(status, extra = {}) {
          a.status = status;
          Object.assign(a, extra);
        },
      };
    },
    finish(queueLen) {
      m.finishedAt = new Date().toISOString();
      m.queueLength = queueLen;
      writeJSON(`runs/${runId}.json`, m);
      writeJSON("runs/latest.json", m);
      return m;
    },
  };
}

// Human-readable one-screen summary of a finished run (the "what happened" view).
export function printRunReport(m) {
  console.log("\n================ FIND-ENGINE RUN REPORT ================");
  console.log(`run ${m.runId}  ·  ${m.startedAt} → ${m.finishedAt || "(unfinished)"}`);
  console.log("counts:", JSON.stringify(m.counts));
  console.log(`\nArticles attempted: ${m.articles.length}`);
  for (const a of m.articles) {
    const failedChecks = Object.entries(a.checks).filter(([, v]) => !v.ok).map(([k]) => k);
    const mark = a.status === "published" ? "✅" : a.status === "needs_review" ? "🟡" : "✗";
    console.log(
      `  ${mark} [${a.formatTag || "?"}] ${a.category}/${a.subcategory}  ${a.id}` +
        (a.score ? `  score ${a.score}` : "") +
        (failedChecks.length ? `  ⚠ incomplete: ${failedChecks.join(",")}` : "")
    );
  }
  console.log("=======================================================\n");
}
