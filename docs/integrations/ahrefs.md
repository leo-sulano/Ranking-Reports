# Ahrefs Rank Tracker — BP Sites sync

"Sync from API" (BP Sites) and the scheduled sync read the client's Ahrefs
Rank Tracker. The design and its reasons are in
`docs/superpowers/specs/2026-11-09-ahrefs-rank-sync-design.md`.

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
- Keep a small monthly unit cap on the key (Custom limit, e.g. 10,000). Every
  call the sync makes is free, so the cap never gets in the way; it limits the
  damage if the key leaks. The plan's 1M+ options exceed Standard's whole
  monthly allowance, so they protect nothing.

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
