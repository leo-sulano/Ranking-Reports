# Ahrefs Rank Tracker — BP Sites sync

"Sync from API" (BP Sites) and the scheduled sync read the client's Ahrefs
Rank Tracker. The design and its reasons are in
`docs/superpowers/specs/2026-11-09-ahrefs-rank-sync-design.md`.

A second, separate integration — the monthly **other ranking keywords** pull,
which does spend API units on its own key — is described at the end of this
file.

## The key

- `AHREFS_API_KEY`, server-only: set in Vercel (Production and Preview) and in
  the local `.env`. It must never get a `VITE_` prefix and is never pasted into
  chat, a ticket or a commit.
- Only an owner or admin of the Ahrefs workspace can create one (Account
  settings → API keys). The current key is titled `ranking-report` and
  **expires 2027-11-09**; renew it before then.
- A key reads the **whole workspace**, which holds other clients' projects
  too. The sync only ever fetches projects whose target is a BP domain.
- A key stops working if the person who created it leaves the workspace. When
  that happens the sync fails with "Ahrefs rejected the key…".
- Keep a small monthly unit cap on this key (Custom limit, e.g. 10,000; it is
  10,000 as of 2026-11-13). Every call the rankings sync makes with
  `AHREFS_API_KEY` is free, so the cap never gets in the way; it limits the
  damage if the key leaks. The plan's 1M+ options exceed Standard's whole
  monthly allowance, so they protect nothing. (The other-ranking-keywords pull
  below is NOT free and uses its own key, never this one.)

## Endpoints

Base `https://api.ahrefs.com/v3`, header `Authorization: Bearer <key>`, GET
only. All three are documented as free (0 API units), and the sync fails if a
response's `x-api-units-cost-total` header is ever above 0.

| Endpoint | Parameters | Used for |
|---|---|---|
| `management/projects` | — | Project id, name, target `url`, `keyword_count` |
| `management/project-competitors` | `project_id` | The competitors, in slot order |
| `rank-tracker/competitors-overview` | `project_id`, `device=desktop`, `date` (as of), `date_compared` (7 days earlier), `select=keyword,location,country,language,serp_updated,serp_updated_prev,competitors_list`, `limit=1000` | Every slot's current and previous position |

One sync is about 47 calls: the project list plus two per BP project.

## Observed behaviour (2026-11-09 coverage check)

Where these disagree with Ahrefs' docs, the observation wins.

| Observed | Requirement |
|---|---|
| `date` returns each keyword's latest update on or before that date | Sync with today's date |
| `date_compared` returns the update on or before that date in the same response, as `*_prev` fields, competitors included | Previous needs no extra call |
| `competitors_list` has one entry per project slot: the target first, then the competitors in `project-competitors` order; a slot that does not rank is `{url: null, position: null}` | Positions are credited to sites by slot. A ranked URL that does not match its slot's site fails the sync |
| `serp_updated: null` means never checked | No record — never NR |
| All BP projects update weekly on Tuesday (10:42–20:02 UTC on 2026-11-03); a few keywords are re-checked Wed–Sun, a few keep the previous week's check | The snapshot is dated by the weekly update day (`cycleDate`), never by a re-check |
| The largest response was 45 rows | No paging; a response that reaches `limit` fails the sync |
| The same site appears in 2–3 projects, and same-day positions can differ between them | A site's own project wins; otherwise the best same-day position |

## Coverage (2026-11-09)

- 23 BP projects (one per alias domain); the nine main domains appear only as
  competitors.
- All 37 BP domains, 9 brands and 5 countries (AU, CA, DE, IT, NZ), national
  only, one language per country.
- 75 keywords, so a full sync is about 1,535 records.
- spinjo.de and fortuneplaycasino.de appear in BP projects but not in
  `brands.ts`; the sync summary lists them as skipped. Adding them is a
  one-line change to `brands.ts`.

## Schedule

`api/cron-sync.ts` runs Wed and Fri at 04:00 UTC, after Tuesday's update has
landed. It skips (and logs) a run when more than half the records predate the
weekly update, and it never overwrites a snapshot a person uploaded or edited.

## Loading a past week

`scripts/ahrefs-week-to-xlsx.mts` prints one week as the sync would see it,
and can write it as an import-ready xlsx. It only reads Ahrefs and never
touches Supabase.

```bash
npx tsx scripts/ahrefs-week-to-xlsx.mts 2026-11-03                      # print only
npx tsx scripts/ahrefs-week-to-xlsx.mts 2026-11-03 docs/references/2026-11-03/ahrefs-bp-sites-2026-11-03.xlsx
```

It writes only under `docs/references/` (gitignored — client data never
reaches the repo) and reads the file back with the app's own parser, failing
unless the upload would land on the same date with every record.

To replace a snapshot with that week:

1. In the Supabase SQL editor, check the snapshot holds nothing typed by hand
   (search volume, global search volume and affiliate URL are not in the file;
   carry-forward fills them when the page loads):

   ```sql
   select count(*) as rows,
          count(*) filter (where search_volume <> '' or affiliate_url <> '' or global_search_volume <> '') as hand_typed
   from ranking_records where snapshot_id = 'snap-bp-sites-<date>';
   ```

2. If `hand_typed` is 0: Import Data → BP Sites → the file → **Delete &
   replace** at the duplicate warning. Keep the original file of the snapshot
   you are replacing.
3. Confirm with:

   ```sql
   select s.source, count(r.*) as rows from snapshots s
   left join ranking_records r on r.snapshot_id = s.id
   where s.id = 'snap-bp-sites-<date>' group by s.source;
   ```

## Other ranking keywords (paid Site Explorer units)

Each BP Sites brand page has an "Other ranking keywords · not tracked"
section: the keywords Ahrefs has seen the brand's sites rank for (top 100) in
AU, CA, DE, IT and NZ that the newest BP snapshot does not track. The design is
in `docs/superpowers/specs/2026-11-13-other-ranking-keywords-design.md`.

### Its own key — this one spends units

- `AHREFS_DISCOVERY_API_KEY` is server-only. It is set in Vercel (Production
  and Preview) and in the local `.env`.
- It must never be the same key as `AHREFS_API_KEY`; the job refuses to run
  if they match.
- The account owner created it on 2026-11-13 with a **200,000-unit monthly
  limit**, and it expires 2027-11-13. The job refuses to run if the key has
  no limit.
- Keep **pay-as-you-go API units switched off** (Account settings → Limits &
  usage). The Standard plan includes 800,000 units a month; with
  pay-as-you-go on, Ahrefs bills anything beyond that automatically.

### The request

`GET site-explorer/organic-keywords`, one call per domain × country:

- `target=<domain>`, `country=au|ca|de|it|nz`, `date=<today>`,
  `mode=subdomains`;
- `select=keyword,best_position,best_position_url,volume,last_update,best_position_kind`;
- `order_by=volume:desc`, `limit=50`;
- a `where` that leaves out the keywords the newest BP snapshot already tracks
  for that brand and country:
  `{"not":{"or":[{"field":"keyword","is":["eq","<keyword>"]},…]}}`. `eq` is
  case-sensitive, so keywords go out lower-case.

| | Units |
|---|---|
| Per row (volume 10, every other field 1) | 15 |
| Minimum per call, even when empty | 50 |
| Worst case per call (50 rows) | 750 |
| Worst case per cycle (37 domains × 5 countries) | 138,750 |

Ahrefs reports each call's real charge in `x-api-units-cost-total-actual`.
`x-api-units-cost-total` is the nominal cost: on a free test target it shows,
for example, 65 while the actual charge is 0.

### Guards (`api/_lib/ahrefsDiscovery.ts`, `api/cron-discovery.ts`)

- The job reads the key's limit and usage first, from
  `subscription-info/limits-and-usage` (free).
- It refuses to run with a missing key, a key equal to `AHREFS_API_KEY`, or a
  key with no limit.
- It never starts a call with fewer than 750 units left on the key.
- It counts each call's cost from the `-actual` header. A missing header
  counts as the nominal cost, then as the worst case; never as free.
- It retries a paid call once on a 429 (honouring Retry-After, capped) or a
  5xx, because Ahrefs did not serve those.
  - It never sends a paid call twice after a timeout, a network failure or a
    2xx, since that call may already have been charged. The next run picks
    the pair up instead.
  - A 2xx whose body is cut off still counts its charge.
  - A 401/403 is reported as the discovery key being rejected.
- **Run lease.** Each run first takes a 90 s lease on the
  `keyword_discovery_state` row, with an atomic conditional update. Vercel can
  deliver the same cron run twice, and someone can trigger it by hand. A run
  that finds the lease taken returns `busy`, without spending or logging. The
  lease is released before the run answers.
- **Halt.** If a call costs more than its rows explain (max(50, rows × 15) +
  50: pricing changed), or the answer no longer reads as organic keywords
  (response shape changed), the job saves a halt.
  - Every later run refuses, without calling Ahrefs, until someone clears it
    in the Supabase SQL editor:

    ```sql
    update public.keyword_discovery_state set halted_reason = null, halted_at = null where id = 1;
    ```
  - A single oddly typed row is skipped rather than halting the job.

### Schedule and progress

- **A cycle** is the Ahrefs billing month that the key's limit counts
  against. It starts one month before `usage_reset_date` (usage resets on the
  5th). Each cycle gets one pull.
- **The cron.** `api/cron-discovery.ts` runs three times a day: 05:00, 11:00
  and 17:00 UTC, three `vercel.json` entries on the same path. On Hobby,
  each entry may fire at any point in its hour.
  - Each run fetches the pairs the cycle still lacks, brand by brand, at most
    one call a second, within a 45 s budget.
  - A call only starts with at least 21 s of the budget left: a timeout, a
    capped Retry-After wait and a second timeout. That leaves calls about 24 s
    to start in, so roughly 12–24 calls a run depending on how fast Ahrefs
    and Supabase answer.
  - A full cycle (185 calls) therefore takes about 3–6 days.
  - Once the cycle is complete, runs return without calling Site Explorer
    and without a /log line. The first few /log lines show the real calls per
    run.
- **The /log line.** Every run that does work leaves one line starting
  "Keyword discovery", for example:
  - "Keyword discovery — 24 calls, 2,140 units; SpinsUp complete for the
    cycle from Nov 5, 2026; 125 calls left"
  - "Keyword discovery — cycle from Nov 5, 2026 complete (185/185), 46,300
    units in total"
  - "Keyword discovery failed: … (after 2 calls, 65 units)": a passing
    error; the next run carries on.
  - "Keyword discovery halted: … — no more calls until halted_reason is
    cleared in keyword_discovery_state": see Halt above.

### Tables (`supabase/keyword-discovery.sql`)

- `keyword_discovery_fetches` has one row per cycle × domain × country
  fetched (row count, units, time). A pair with no row is fetched by the next
  run; a pair with one is never re-bought that cycle.
- `keyword_discovery` holds the keywords: position, position kind, URL,
  volume and Ahrefs' check date.
- `keyword_discovery_state` is one row holding the run lease and any halt.
  It has no RLS policy at all, so only the service role touches it.
- On the two other tables, approved users can read (RLS `is_approved()`) and
  only the service role writes.

### The page

- A brand shows its newest cycle in which every one of its domains has every
  country.
- NEW marks keywords missing from the previous cycle, but only in a country
  where that cycle has every domain and none of those lists was cut off at 50
  keywords. A cut-off list holds only the top keywords by volume, so a
  missing keyword may simply have ranked below the cut. On big domains NEW is
  therefore rare.
- The page re-checks "tracked" against the newest snapshot on load, so a
  keyword drops out as soon as it is tracked.

### Checking the integration without spending units

```bash
npx tsx scripts/ahrefs-discovery-check.mts
```

The script queries ahrefs.com, one of Ahrefs' free Site Explorer test targets
(ahrefs.com, yep.com, firehose.com), with the real discovery key. It prints the
key's limit, the cycle and the mapped rows, and exits 1 unless the key's usage
is unchanged afterwards.
