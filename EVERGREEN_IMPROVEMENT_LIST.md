# Evergreen improvement list — PARKED until Google is crawling us again

**Status: PARKED, not rejected** (owner decision, 2026-07-24). These are edits to pages Google has
**already seen**. The whole recovery plan rests on not touching published pages while Google
re-evaluates the site after the Jul-15 crawl-parking. Nothing here is actioned until the weekly GSC
numbers show Google crawling and showing us again — then this becomes priority one, **one page at a
time, never as a batch** (a batch edit is the churn signal that caused the damage).

## Why this list is the whole evergreen opportunity

The evergreen detector was re-run against the real GSC data after a bug fix (below). Result:

> **24 clusters of reference-style search demand → 0 need a new page. All 24 are pages we already own.**

Every "best/ranked/winners" query that reaches this site already has a page behind it. They just rank
badly — positions 32–69, i.e. pages 4–7 of Google. **There is nothing to write; there is a lot to fix.**

## 🔴 The bug that nearly caused two duplicate pages

The first version of `evergreenOpportunities()` matched cluster words against GSC page **slugs only**,
after stripping "best/top/ranked/movies/all/time" as stopwords, with no stemming. It reported
**"NO PAGE YET"** for two clusters we had strong pages for, and that wrong answer was reported to the
owner, who approved writing both:

| Cluster | Reported | Truth |
|---|---|---|
| "best movie trilogy" | no page | `best-movie-trilogies` — 1,316 words, 54 impr, pos 46. "trilogy" is not a substring of "trilogies"; every other word had been stripped as a stopword |
| "2025 oscar winners" | no page | `every-winner-at-the-97th-academy-awards` — 648 words, 50 impr, pos 57. Its **metaTitle is literally** "2025 Oscars Winners: Full List of Academy Award Winners", but the **slug shares zero words** with the query, so a slug-only check could never find it |

Publishing either would have duplicated a page that already ranks — exactly the harm the recovery plan
exists to prevent. **Fixed**: matching now runs against the real article corpus (slug + title +
metaTitle) with stemming and a searcher-synonym map (film/movie, show/series, oscars/academy), and
keeps the identifying words instead of stripping them. Both cases are pinned by regression tests.

## The list — ranked by impressions already being earned

Position is where Google currently ranks us. Everything below is a **content-quality** change; none of
it touches the title system, and none of it creates a URL.

### 1. `/movies/best-a24-movies-ranked/` — pos 34 · 136 impr · 1,140 words
Our single biggest evergreen earner. Real queries: "best a24 films", "a24 best movies", "a24 movies
2025", "2022 a24 movies", "2026 movies a24".
- **Add year coverage.** Several distinct queries ask by year; the page is a timeless list and answers
  none of them. Add a dated section (a 2025/2026 A24 slate) so the year-qualified queries have
  something to match.
- **Verify every entry against TMDB** (title, year, director) before touching anything else.
- Do **not** renumber or re-rank the existing list — that rewrites the whole page for no gain.

### 2. `/movies/christopher-nolan-movies-ranked/` — pos 32 · 76 impr · 1,341 words
Closest to page one of anything we have. Queries include the very specific
"christopher nolan movies ranked **by tomatometer**" (twice, plus a "rotten tomatoes" variant).
- **Add a critics-score column** sourced from the existing OMDb/RT grounding, so the tomatometer
  queries are actually answered. This is the single highest-value edit on the list.
- Nolan's filmography grew — confirm the count in the title ("All 12") is still correct before publish.

### 3. `/movies/ryan-gosling-best-movies/` — pos 44 · 66 impr · 1,255 words
Queries are all phrasing variants ("best movies **of/with** ryan gosling").
- Content is fine; the gap is **freshness and completeness of credits** — verify the filmography
  against TMDB and add anything missing since publication.

### 4. `/movies/best-movie-trilogies/` — pos 46 · 54 impr · 1,316 words
Queries: "best film trilogies", "best movie trilogy", "best trilogy of all time".
- Substantial already. Needs **entry verification** and a clearer answer to "of all time" framing in
  the opening lines, where the query intent actually lives.

### 5. `/awards/every-winner-at-the-97th-academy-awards/` — pos 57 · 50 impr · **648 words**
🔴 **The most under-built page on the list** — barely half the length of its peers, ranking 57th for a
query with real, recurring demand ("2025 oscar winners" in six phrasings).
- **This is the one I would do first when the freeze lifts.** A full winners list is a reference page;
  648 words cannot be complete. Expand to the complete category list from the authoritative Academy
  source already wired into the pipeline (`lib/awardsCache.mjs` → `oscarAwards()`), never from memory.
- The slug is fine and must not change (it is indexed). Only the body grows.

### 6. `/movies/best-quentin-tarantino-movies-ranked/` — pos 53 · 27 impr · 941 words
- Shortest of the director lists. Verify the filmography and deepen the thin entries.

### 7. `/movies/denis-villeneuve-movies-ranked/` — pos 47 · 27 impr · 1,304 words
- Confirm "All 11" is still accurate; otherwise healthy.

### 8. `/awards/oscars-2024-winners-96th-academy-awards/` — pos 69 · 7 impr · 545 words
- Same shape as #5 and the weakest position on the site. Same fix, lower priority (older ceremony,
  less demand). Note both Oscars pages are thin — that is a pattern, not two coincidences.

## Rules for when this unfreezes
1. **One page per day, maximum.** Verify each on the live site before starting the next.
2. **Never touch the slug, the date, or the metaTitle** of an indexed page. Body and structure only.
3. **Every fact re-verified** against TMDB / the Academy source before it ships — these are reference
   pages, so a wrong year or a missing winner is worse than a thin page.
4. Route through the existing in-place update machinery so `dateModified` is stamped correctly and no
   second URL can be created.
5. Stop immediately and reassess if impressions on an edited page drop over the following week.
