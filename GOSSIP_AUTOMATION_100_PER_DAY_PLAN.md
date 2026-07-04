# Gossip Automation — 100 Articles/Day, Scheduled & Cloud-Native

**Owner:** Shivajith · **Status:** PLAN (nothing implemented — awaiting sign-off + 1 open decision) · **Updated:** 2026-07-04

> Single source of truth for the **gossip automation** as a standalone, GitHub-run
> publishing system. It **mirrors the existing NEWS automation's architecture**
> (the FIND→MAKE queue seam) so we add nothing exotic — we reshape what already
> works. Implementation starts only after the owner OKs this + answers the one
> remaining decision (homepage freshness).

---

## 1. What the owner wants (the directive)

1. **≥100 articles/day** (target ~120).
2. **Post only during Los Angeles 10:00 AM – 10:00 PM (PT)** — 12 posting hours.
3. **Drip:** ~one article every **5–6 minutes** → ~**10/hour** → ~120/day.
4. **Runs entirely on GitHub — never the Mac.**
5. **Standalone gossip automation.** NOT wired to news/music/inside-stories; its
   own schedule, own state, own on/off switch.
6. **A pending-stories QUEUE (backlog).** The finder keeps discovering and piling
   vetted stories up; if an hour is thin, the publisher drains earlier **pending**
   stories so the cadence never starves.
7. **Keep the existing pipeline as-is** — same concept, story types, and accuracy
   spine. We only add: the split, the queue, the schedule, the cloud runner.
8. **Keep it SIMPLE.** Mirror how the news automation already works. Plan first.

---

## 2. Scope

- **Gossip lane only** (`site/pipeline/gossip/`, 27 modules, 21 tests): celebrity
  personal-life stories about Hollywood / Western entertainment figures.
- Same repo as the site (`thescreenreport68-web/thescreenreport`), same Cloudflare
  Pages project, same design. The old UI is permanently deleted, so there is no
  "old design" to protect against — this is just another scheduled process in the
  one repo, exactly like news will be.

---

## 3. Mirror the NEWS automation (the "different idea" = the FIND→MAKE seam)

The news lane already splits discovery from publishing, with a queue file between
them. We copy that shape 1:1 for gossip:

| | NEWS (exists today) | GOSSIP (what we build) |
|---|---|---|
| **FINDER (producer)** | `find/findrun.mjs` → discover → categorize → verify → score → dedup vs published ledger → writes ranked `data/find/queue.json` | `pipeline/gossip/find.mjs` → discover + social → categorize (scope) → dedup vs `store.json` → writes `data/gossip/queue.json` |
| **MAKER (consumer)** | `run.mjs --from-find --limit=N` → reads queue → full pipeline → records published | `gossiprun.mjs --from-find --limit=N` → reads queue → `runGossip` → writes `.md` → records dedup → deploy |
| **Queue seam** | `data/find/queue.json` `{runId, builtAt, count, topics[]}` | `data/gossip/queue.json` (identical shape) |
| **Dedup ledger** | `loadPublished()` (never re-queue a published story) | `store.json` (already does exact/same-event/semantic dedup) |
| **Per-topic state** | `data/state/<id>.json` | `data/gossip/state/<id>.json` |

**Almost all of this already exists in gossip** — `gossiprun.mjs` today runs the
producer half (discover→categorize→dedup) and the consumer half (runGossip→write)
in ONE shot. We simply **split it in two** and drop a `queue.json` in the middle,
just like news. That queue **is** the owner's pending-stories backlog.

---

## 4. The schedule (simple, GitHub-native, drip-preserving)

GitHub `cron` is best-effort and min 5-min — 144 tiny jobs would drift/skip. So:

- **One workflow per posting hour**, `.github/workflows/gossip-hourly.yml`, that
  runs a single ~50-min job which paces itself:
  1. **Top up the queue** (run `find.mjs`, over-produce so a buffer builds).
  2. **Loop ~10×:** pop one topic → `runGossip` → write `.md` → **commit** the new
     article + updated `store.json` + `queue.json` back to the repo → `npm run
     build` → `wrangler pages deploy` → **sleep ~5 min**. → one article goes live
     every ~5 min (the drip).
- **DST-proof:** the workflow fires hourly in UTC, but `find.mjs`/the runner first
  **checks Los Angeles local time** and exits in seconds outside 10:00–22:00 PT.
  No cron edits needed across PST/PDT.
- **State survives GitHub's throwaway runners** because each publish commits the
  content + queue + dedup state back to the repo. Bonus: every article is
  version-controlled. (~100 bot commits/day — normal for a publisher bot.)
- **Concurrency guard:** the workflow uses a concurrency group so two hourly jobs
  can never overlap and double-publish.

That's it — the same producer/consumer split news uses, wrapped in one small
hourly GitHub workflow. No servers, no exotic infra.

---

## 5. Cost (public repo — confirmed)

| Item | Rate | ~Monthly @100/day |
|---|---|---|
| LLM (deepseek writer + gemini-flash judge/gate/verify — never premium) | ~$0.011/article (measured) | **~$33** |
| GitHub Actions | **free on public repos** (confirmed public) | **$0** |
| Cloudflare Pages (wrangler direct-upload deploys) | free tier | **$0** (confirm deploy-count limit) |
| **Total** | | **~$33/month** |

---

## 6. The homepage/cache issue — plain English (the one open decision)

To stay fast, Cloudflare keeps a **saved copy** of each page near your visitors. A
**new article's own page** is a brand-new address, so it appears instantly (every
link so far worked). But the **homepage** and **category lists** (`/celebrity/`)
are pages Cloudflare *already saved*, so visitors may keep seeing the old list
(missing the newest article) until that saved copy expires. At 100/day we want new
posts to show in the lists promptly. Two fixes:

- **(A) Short "keep time" on the list pages (recommended):** tell Cloudflare to
  hold those pages for only ~1–2 min so they refresh on their own. No new key. I
  check the current setting and tune it.
- **(B) Purge after each deploy:** actively clear the saved homepage on every
  publish — instant, but needs a Cloudflare key with *purge* permission (our
  current deploy key lacks it, so you'd create one).

**Decision C — the only thing still open.** (Not blocking the build; it's Phase 5.)

---

## 7. Story supply — the honest feasibility note

100 *genuinely distinct* in-niche gossip stories every single day is a lot. The
queue + a broadened finder is how we chase it (finder over-produces; publisher
drains the backlog on quiet hours, per the owner's rule — "there are always
stories"). On a genuinely slow news day we might land below 100 **without lowering
the accuracy bar or re-posting** — accuracy stays existential. Realistic
expectation: ~100/day most days, with the backlog smoothing the quiet stretches.

---

## 8. Build phases (once approved — NOT started)

1. **Split gossip into FIND→MAKE** mirroring news: `find.mjs` writes
   `data/gossip/queue.json`; `gossiprun.mjs --from-find --limit=N` drains it.
   Offline tests for enqueue / dedup / drain.
2. **Scheduler** inside the maker: LA-time gate + self-paced 10-per-hour drip +
   per-article commit→build→deploy.
3. **GitHub workflow** `gossip-hourly.yml`: hourly cron, secrets from GitHub
   Secrets, commit-back of state+content, concurrency guard.
4. **Broaden the finder** for sustained volume (more query breadth/sources) —
   never weakening scope or accuracy gates.
5. **Cache/freshness** per Decision C.
6. **1-hour dry run** on GitHub (~10 articles) → review → enable full 12-hour day.
7. **Monitoring:** per-run summary (published/held/rejected/queue depth) + failure
   alerts + `recheck` retraction net.

**Prerequisite:** the gossip code must be committed/pushed to the repo (currently
local-only) so GitHub can run it.

---

## 9. Guardrails carried over (do not regress)

- Models LOCKED cheap — never a premium model at runtime.
- Accuracy of specifics is existential: verify-gate, quote-speaker guard,
  structured-field scrub, dedup — all stay ON.
- Never re-post; never fabricate; speculation framed as speculation.
- One repo, one Cloudflare project, one design (`site/`).
- Secrets only in GitHub Secrets / the parent `.env` — never in code or argv.

---

## 10. What's already built (context for "what's done")

Full pipeline live-proven across 3 hands-off runs (2026-07-04), each reviewed
article-by-article with independent web fact-checking (my web-verified avg ~87–88
vs the automation's own judge ~78–82; most articles zero false specifics):
discovery → scope/niche gate → editorial gate → cross-run dedup → researched
writer → accuracy spine (`quoteGuard` w/ **speaker attribution**, `verifyGate`
over **all reader-facing fields**, correct-or-drop `polish`, judge backstop) →
hero image → FAQ with real answers → homepage placement engine. Offline suite
**17/17 green**. Not yet done: the FIND→MAKE split, the queue, the scheduler, the
GitHub workflow, and committing the code to the repo.
