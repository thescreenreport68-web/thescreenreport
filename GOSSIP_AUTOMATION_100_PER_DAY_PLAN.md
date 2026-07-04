# Gossip Automation — MASTER PLAN (100+/day, scheduled, fully cloud)

**Owner:** Shivajith · **Status:** ✅ Phases 1–3 BUILT + tested (20-suite green); cloud wiring pending owner (see §13) · **Updated:** 2026-07-04

> The single source of truth for the **gossip automation** as a standalone,
> GitHub-run, scheduled publisher. It borrows the news automation's **plumbing and
> timing mechanism** (so the two stay consistent and we avoid confusion) but keeps
> gossip's **own content rules** (see §2 — this is the key difference). Nothing is
> implemented; this is for the owner to approve first.

---

## 0. TL;DR

Split gossip into **FIND** (fills a story backlog) and **MAKE** (drains it, one
post every ~5 min), exactly like news. Run it on **GitHub Actions (free, public
repo)**, clocked by a **Cloudflare Worker Cron Trigger** — the same reliable
timing mechanism news uses. Post **LA 10am–10pm, ~10/hour, ~120/day**. Cost
**~$33/month**. The content stays **gossip** — every story written **as
speculation** from a source (never asserted as confirmed), with every checkable
**specific** (name/date/place/title/quote) **verified and perfect**. That content
model does NOT copy news.

---

## 1. What the owner wants

1. **≥100 articles/day** (target ~120).
2. **Post only Los Angeles 10:00 AM – 10:00 PM (PT)** — 12 posting hours.
3. **Drip:** one article roughly every **5–6 minutes** → ~**10/hour**.
4. **Runs entirely on GitHub — never the Mac.**
5. **Standalone gossip automation** — its own schedule/state/switch; NOT wired to
   news/music/inside-stories.
6. **A pending-stories QUEUE (backlog):** the finder keeps discovering; if an hour
   is thin, the publisher drains earlier pending stories so the cadence never
   starves.
7. **Timing/posting mechanism = copy the news automation exactly** (to avoid
   confusion).
8. **Content = gossip, NOT news** (see §2).
9. Keep it simple; plan first; approve before building.

---

## 2. ⭐ THE KEY DIFFERENCE — this is a SPECULATION desk, not a news desk

The owner's exact model of this automation (do NOT copy news's content rules):

- **It is a SPECULATION / gossip automation.** If the finder discovers a SOURCE
  that says a situation happened, we turn it into a STORY and post it — **written
  as speculation.** We are NEVER claiming to confirm anything in the article.
- **Confirmation status does NOT gate publishing.** It doesn't matter whether the
  item is confirmed by a big outlet or is an unconfirmed report — we still make the
  story and post it, framed as speculation ("reportedly", "a source says", "fans
  wonder", "appears to"). We are not asserting the story as our own confirmed fact,
  so there is no "hold until verified" step like news has. (This corrects the
  earlier draft — it's not a confirmed-vs-unconfirmed decision at all.)
- **THE ONE HARD LINE — the checkable SPECIFICS must be perfect / verified.**
  Even though the STORY is speculation, every **name, date, place, work title, and
  quote (and who said it)** must be TRUE and verified — no matter whether the
  source is a top outlet or an unconfirmed tip. A speculative story is fine; a
  wrong name / date / place / title / misattributed quote is NOT.

| | **NEWS automation** | **GOSSIP automation (this one)** |
|---|---|---|
| What it posts | strictly verified NEWS, stated as fact | a SPECULATION story built from a source, never asserted as confirmed |
| Confirmation | must be confirmed to publish | doesn't matter — post it as speculation either way |
| Voice | straight, restrained | punchy, bold, "set tongues wagging" — play it up |
| The hard line (SAME) | specifics must be TRUE | **identical — names/dates/places/titles/quotes must be verified & perfect** |

**So we copy news's PLUMBING and TIMING only, and keep gossip's own speculation
writer + the verified-specifics spine that already backs it** (the pipeline today
already writes bold speculation while the accuracy gates keep every specific true).

---

## 3. Architecture — mirror news's FIND → MAKE split (plumbing only)

News already separates discovery from publishing with a queue file between them.
We copy that shape 1:1 for gossip (gossip already has all the parts — today
`gossiprun.mjs` just runs both halves at once):

| | NEWS (today) | GOSSIP (build) |
|---|---|---|
| **FINDER (producer)** | `find/findrun.mjs` → discover → categorize → verify → score → dedup → writes `data/find/queue.json` | `pipeline/gossip/find.mjs` → discover+social → categorize (scope) → dedup vs ledger → writes `data/gossip/queue.json` |
| **MAKER (consumer)** | `run.mjs --from-find --limit=N` drains the queue, publishes | `gossiprun.mjs --from-find --limit=N` drains the queue, `runGossip`, deploy |
| **Queue seam** | `queue.json` | `queue.json` (identical shape) — **this is the owner's "pending stories" backlog** |
| **Dedup ledger** | published ledger (never re-queue) | `store.json` (exact/same-event/semantic dedup — already built) |

The finder **over-produces** (finds more than 10/hour) so the backlog builds a
buffer; the maker drains it steadily and, on quiet hours, works through the
backlog instead of starving.

---

## 4. ⭐ Timing / scheduling — COPY the news mechanism exactly

Straight from the news cloud design (`FIND_HALF_PLAN.md`), applied to gossip's
drip cadence:

- **Compute = GitHub Actions** (`ubuntu-latest`, **public repo → free**). The
  existing `.mjs` pipeline runs there exactly as on the Mac.
- **Clock = a Cloudflare Worker Cron Trigger** (free) that fires on schedule and
  calls GitHub **`workflow_dispatch`**. News chose this because **GitHub's own
  cron is delayed/dropped under load** — the Worker is an independent, reliable
  external clock. We use the **same** mechanism so both automations tick the same
  way.
- **Cadence for gossip:** the Worker fires every ~5 min; each tick it **checks Los
  Angeles time** and only dispatches during **10am–10pm PT** (this also makes it
  DST-proof — no cron edits across PST/PDT). Each dispatched run publishes **one**
  article → the ~5-min drip, ~120/day.
- **No double-posting:** an **idempotent ledger** — a topic is *claimed* before it's
  written, so even if two ticks overlap, the same story is never published twice
  (news does this with atomic claims; gossip does it via the dedup store + a claim
  flag).
- **State persists** by committing the new `.md` + `queue.json` + `store.json` back
  to the repo each run (GitHub runners are ephemeral). Every article is
  version-controlled as a bonus.
- **Deploy:** each run builds + deploys so the post is live within its slot.
- **Belt-and-suspenders (from news):** odd-minute scheduling + a couple of
  over-provisioned ticks so a skipped tick is absorbed, never starving the quota.

**What gossip does NOT need from the news cloud stack** (keeps it simpler):
- **No Cloudflare R2** — gossip **hotlinks** source images (per image policy), so
  there are no 300 studio images/day to store out of git.
- **No 12-way matrix sharding** — gossip is a steady 5-min drip, near-serial; one
  worker per tick is enough (news shards because it bursts 300/day).
- **D1 database is OPTIONAL for gossip** — news uses Cloudflare D1 as its state
  source-of-truth. Gossip's volume is low enough that the existing JSON
  `store.json`/`queue.json` committed to the repo works with the claim-guard.
  *(Decision D: match news with D1 for strict parity, or keep gossip's simpler
  JSON-in-repo state? Recommended: start with JSON-in-repo — simplest — and adopt
  D1 only if/when gossip needs the same scale as news.)*

---

## 5. ✅ What I WILL do

1. **Split gossip into FIND → MAKE** with a `data/gossip/queue.json` backlog,
   mirroring news; add a claim-guard so a queued story is never double-published.
2. **Keep the gossip content pipeline exactly as-is** — writer, speculation/
   exaggeration voice, per-type templates, and the accuracy spine (quote-speaker
   guard, verify-gate over all fields, correct-or-drop, dedup, FAQ-with-answers).
3. **Build the GitHub Actions workflow** + a **Cloudflare Worker Cron Trigger**
   clock (same mechanism as news), LA-time-gated to 10am–10pm, ~5-min drip.
4. **Commit content + state back to the repo** each run; **build + deploy** each
   post so it goes live.
5. **Broaden the finder** so it sustainably supplies ~10 fresh, distinct, in-niche
   stories/hour into the backlog.
6. **Offline-test everything** first (queue/dedup/drain), then a **1-hour cloud dry
   run (~10 posts)** for owner review, THEN enable the full 12-hour day.
7. **Add monitoring** — per-tick summary (published/held/rejected/queue depth) +
   failure alert + the `recheck` retraction net.

## 6. ❌ What I will NOT do

1. **NOT copy news's content rules.** Gossip keeps speculating/exaggerating; I will
   not turn it into a straight verified-news desk.
2. **NOT lower the specifics-accuracy bar or re-post a story** to hit the number —
   accuracy of dates/numbers/names/quotes stays existential; dedup stays strict.
3. **NOT wire this into the other automations** — standalone, its own workflow +
   state + on/off switch.
4. **NOT use a premium model at runtime** (writer deepseek, judge/gate/verify
   gemini-flash) — ever.
5. **NOT build a second site/checkout** — one repo, one Cloudflare project, one
   design.
6. **NOT design or change homepage placement/display** — which stories surface,
   the top story staying put, slot rotation — the owner owns that in a separate
   chat. This automation only publishes; display is decided elsewhere.
7. **NOT turn on the full schedule before the owner approves the dry-run output.**
8. **NOT put secrets in code/argv** — GitHub Secrets + the parent `.env` only.

---

## 7. Cost (public repo)

| Item | Rate | ~Monthly @100/day |
|---|---|---|
| LLM (deepseek writer + gemini-flash judge/gate/verify — never premium) | ~$0.011/article (measured) | **~$33** |
| GitHub Actions | free on public repos | **$0** |
| Cloudflare Worker Cron Trigger | free plan (~5 triggers) | **$0** |
| Cloudflare Pages deploys | free tier | **$0** (confirm deploy-count limit) |
| **Total** | | **~$33/month** |

---

## 8. Homepage display — DEFERRED (owner handles it separately)

This automation's only job here is to **publish every article to the live site** —
each article's own page goes live and is reachable. **How articles are DISPLAYED
on the homepage** — which stories surface, the big **top story staying put** while
the **other slots keep rotating** in new stories — is a **separate concern the
owner will design in another chat, across ALL automations at once**, so everything
has its proper place. **NOT part of this build.** For now: this automation just
publishes; homepage placement/rotation is decided elsewhere.

(The earlier "cache/keep-time" question was really this display question — it's
now owner-owned and out of scope for this automation.)

---

## 9. Story supply — honest note

100 genuinely distinct in-niche gossip stories/day is a lot. The backlog + a
broadened finder is how we chase it; on a genuinely slow day we may land under 100
**without lowering the accuracy bar or re-posting**. Realistic: ~100/day most
days, backlog smoothing the quiet stretches. ("There are always stories" — we keep
the finder wide.)

---

## 10. Build phases (NOT started)

1. **FIND→MAKE split + queue + claim-guard**, offline tests (local only).
2. **Scheduler glue:** LA-time gate + one-post-per-tick + commit→build→deploy.
3. **GitHub workflow + Cloudflare Worker Cron clock** (same as news); secrets;
   concurrency guard.
4. **Broaden the finder** for sustained volume.
5. **1-hour cloud dry run (~10 posts)** → owner review → enable full 12h day.
6. **Monitoring + recheck retraction net.**

*(Homepage display is intentionally NOT a phase here — the owner handles it in a
separate chat.)*

**Prerequisite:** commit/push the gossip code to the repo (currently local-only)
so GitHub can run it.

---

## 11. What's already built (context)

Full gossip pipeline, live-proven across 3 hands-off runs (2026-07-04), each
reviewed article-by-article with independent web fact-checking (my web-verified
avg ~87–88 vs the automation's own judge ~78–82; most articles zero false
specifics). Includes: discovery → scope/niche gate → editorial gate → cross-run
dedup → gossip writer (speculation-friendly) → accuracy spine (`quoteGuard` with
**speaker attribution**, `verifyGate` over **all reader-facing fields**,
correct-or-drop `polish`, judge backstop) → hero image → FAQ with real answers →
homepage placement engine. Offline suite **17/17 green**. Not built yet: the
FIND→MAKE split, the queue, the scheduler, the GitHub workflow + Worker clock, and
committing the code to the repo.

---

## 12. Open decisions for the owner

- **Homepage display:** OUT OF SCOPE here — owner handles it in a separate chat.
- **D. Gossip state layer:** simple JSON-in-repo (BUILT — recommended) vs match
  news's Cloudflare D1. Shipped with JSON-in-repo; D1 remains a later option.

---

## 13. ✅ BUILD STATUS + owner go-live checklist

**What is BUILT + tested (local, nothing live yet):**
- `pipeline/gossip/find.mjs` — the FIND producer + the backlog queue
  (`data/gossip/queue.json`: `enqueue`/`dequeue`/`loadQueue`). Live-smoke-proven
  (found 54 topics → enqueued 42).
- `pipeline/gossip/gossiprun.mjs` — refactored into the MAKE consumer; reuses
  `gossipFind` (no duplicated discovery), adds `--from-find --limit=N` to drain
  the backlog with a claim-guard. Existing behavior unchanged (dedup/pipeline
  tests still pass).
- `pipeline/gossip/scheduler.mjs` — one drip tick: LA-posting-hours gate
  (DST-proof), top-up-when-low, publish one, emit `published`/`slugs` for the
  workflow.
- `.github/workflows/gossip-drip.yml` — the GitHub Actions job (checkout → npm ci
  → scheduler tick → commit state → build → wrangler deploy). `workflow_dispatch`
  only; the `schedule:` cron is COMMENTED OUT so merging it does NOT start posting.
- `cloudflare/gossip-cron/` — the Cloudflare Worker Cron Trigger (every 5 min,
  LA-gated) that calls `workflow_dispatch` — the same external-clock mechanism news
  uses.
- Offline suite **20/20 green** (adds `find-queue-test`, `scheduler-test`).

**OWNER go-live checklist (the parts only you can do — I can't):**
1. **Commit + push** the gossip code + these new files to the repo (currently
   local-only).
2. **Make the repo public** (so GitHub Actions is free) and ensure the
   `gossip-drip.yml` workflow is on the **default branch** (`workflow_dispatch`
   only sees workflows on default) — set `GH_REF` in `wrangler.toml` to that branch.
3. **Add GitHub Secrets:** `OPENROUTER_API_KEY`, `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `TMDB_READ_TOKEN`, `TMDB_API_KEY`, `OMDB_API_KEY`,
   `LASTFM_API_KEY` (values from the parent `.env`).
4. **Deploy the Worker:** `cd site/cloudflare/gossip-cron && npx wrangler deploy`,
   then `wrangler secret put GH_TOKEN` (a fine-grained PAT with Actions:read/write
   on the repo).
5. **DRY RUN:** trigger `gossip-drip` manually once (Actions tab → Run workflow) →
   review the one published article live.
6. **Enable the schedule:** once the dry run looks right, either leave the Worker
   cron on (it's already dispatching) and/or uncomment the `schedule:` fallback in
   the workflow. From here it runs LA 10am–10pm at ~1 post/5 min on its own.
7. Confirm Cloudflare Pages **Git auto-build is OFF** (we deploy via wrangler; we
   don't want a second competing build on each state push).
