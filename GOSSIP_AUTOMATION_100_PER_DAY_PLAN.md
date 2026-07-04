# Gossip Automation — MASTER PLAN (100+/day, scheduled, fully cloud)

**Owner:** Shivajith · **Status:** FINAL PLAN for review — nothing built yet · **Updated:** 2026-07-04

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
**~$33/month**. The content stays **gossip** (verified core facts, but speculation
and playful exaggeration allowed) — that part does NOT copy news.

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

## 2. ⭐ THE KEY DIFFERENCE — content: GOSSIP is not NEWS

This is what the owner stressed and what must NOT be copied from news:

| | **NEWS automation** | **GOSSIP automation (this one)** |
|---|---|---|
| Content bar | **Strictly verified news only.** No exaggeration, no speculation. | **Verified core facts, BUT** we can **speculate, play it up, exaggerate a bit, and make the story big/bold.** |
| Voice | Straight, factual, restrained. | Punchy, teasing, "set tongues wagging" energy — a real gossip desk. |
| Unconfirmed items | Held or dropped until verified. | **Allowed** — posted **as speculation, clearly framed** ("reportedly", "fans wonder", "appears to"). |
| The one hard line (SAME for both) | **Checkable specifics** (dates, numbers, names, quotes, who-said-what) must be **TRUE.** | **Identical** — a wrong specific is a defect on both desks. Speculation is fine; a false *fact* is not. |

**So we copy news's PLUMBING and TIMING, and we KEEP gossip's own writer, tone,
and speculation rules.** The gossip pipeline (writer, per-type templates,
speculation framing, the accuracy spine that already lets stories be bold while
keeping specifics true) stays exactly as it is today.

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
6. **NOT turn on the full schedule before the owner approves the dry-run output.**
7. **NOT put secrets in code/argv** — GitHub Secrets + the parent `.env` only.

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

## 8. Homepage freshness / cache (Decision C — not blocking, Phase 5)

To stay fast, Cloudflare keeps a **saved copy** of each page near visitors. A new
article's **own page** appears instantly (new address). But the **homepage** and
**category lists** are already-saved pages, so the newest post may not appear in
those lists until the saved copy expires. Fix: **(A, recommended)** short "keep
time" (~1–2 min) on the list pages so they refresh themselves — no new key; or
**(B)** a Cloudflare key with *purge* permission to clear them on each deploy.

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
5. **Cache/freshness** (Decision C).
6. **1-hour cloud dry run (~10 posts)** → owner review → enable full 12h day.
7. **Monitoring + recheck retraction net.**

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

- **C. Homepage freshness:** short cache "keep time" (A, recommended) vs purge key (B).
- **D. Gossip state layer:** simple JSON-in-repo (recommended) vs match news's
  Cloudflare D1 for strict parity.
- **Go/no-go:** approve Phase 1 (the FIND→MAKE split + tests, local only, nothing
  live) to begin.
