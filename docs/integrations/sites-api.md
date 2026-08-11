# Ranks API — Quick Start

**Base URL:** `https://3213211.xyz/bpn-panel-cc/api/ranks.php`

---

## Step 1 — Get an API Key

Go to **Settings → API Keys** in the panel, click **Generate Key**, copy it immediately (shown once).

Your key looks like: `bpn_a1b2c3d4e5f6...`

---

## Step 2 — Pull data

All filters are optional. Add them to narrow results.

### Get all keywords + rankings for one domain
```
GET /api/ranks.php?action=results&domain=example.com&api_key=bpn_YOUR_KEY
```

### Get all tracked domains (with keyword counts)
```
GET /api/ranks.php?action=domains&api_key=bpn_YOUR_KEY
```

### Get everything (all domains, all keywords)
```
GET /api/ranks.php?action=results&api_key=bpn_YOUR_KEY
```

### Get rank history for a domain
```
GET /api/ranks.php?action=history&domain=example.com&api_key=bpn_YOUR_KEY
```

---

## What you get back

```json
{
  "ok": true,
  "meta": { "total": 12, "limit": 100, "offset": 0 },
  "data": [
    {
      "domain":            "example.com",
      "keyword":           "online casino",
      "country":           "US",
      "position":          5,
      "previous_position": 7,
      "change":            2,
      "url_found":         "https://example.com/casino",
      "checked_at":        "2026-07-29T09:00:00Z"
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `position` | Current rank (null = not in top results) |
| `previous_position` | Rank from the previous check |
| `change` | Positive = moved up, negative = dropped |

---

## Optional filters

Append any of these to any request:

| Param | Example | Effect |
|-------|---------|--------|
| `domain` | `domain=example.com` | Only this domain |
| `keyword` | `keyword=online casino` | Only this keyword |
| `country` | `country=US` | Only this country/language |
| `from` | `from=2026-07-01` | History from this date |
| `to` | `to=2026-07-31` | History up to this date |
| `limit` | `limit=500` | Max rows (default 100, max 1000) |
| `offset` | `offset=100` | Skip first N rows (for paging) |

---

## Using a header instead of query param

If you'd rather not put the key in the URL:

```
Authorization: Bearer bpn_YOUR_KEY
```

---

## Errors

```json
{ "ok": false, "error": "Invalid or revoked API key.", "code": 401 }
```

| Code | Reason |
|------|--------|
| 401 | Missing or invalid key |
| 403 | Key scoped to a different project |
| 400 | Unknown action |

---

## Observed behaviour (verified 2026-08-10)

Where this contradicts the sections above, the observation wins. Each line is a
requirement on `src/lib/sitesNormalize.ts`.

| Observed | Documented | Requirement |
|---|---|---|
| Rooster data is `project_id: 0` | not mentioned | `?project_id=0` does **not** filter — the upstream treats `0` as falsy and returns every project. `api/sites.ts` never sends it. |
| `position: 0` on 403 of 1,109 Rooster rows; no nulls at all | "null = not in top results" | Both `0` and `null` normalize to `NR`. |
| `country` is `AU/CA/DE/IT/NZ` with `language` a separate field | "country/language" | Project 0 returns real country codes matching `COUNTRY_LABELS`. `language` is ignored. |
| One row per (domain, keyword, country) on project 0 | implied current state | The latest-per-key reduction is a no-op here; it stays as a guard, since project 18 has been seen returning 6 rows per key. |
| `meta.total` under-reports (135 for a 154-row response) | — | Page until a page is shorter than `limit`; never terminate on a count. |
| `from` / `to` ignored on `action=results` | listed as filters | Usable only on `action=history`. |
| `keyword_count` in `action=domains` counts check rows, not distinct keywords | — | `rooster.bet` reports 688, which is its full history row count, not its 7 keywords. |
| `action=history` returns weekly history back to 2026-03-30 | listed | Not used. Backfill is deliberately out of scope — the API's dates do not line up with the xlsx "Last Check" dates. |

### Coverage

Of 2,826 total result rows across both projects, 1,109 match BP domains: all 37
BP/MAIN domains, 54 keywords, 5 countries. **No LP domains are tracked** — the
30 rows that appear to match are `lucky7evencasino.org`, which is registered
under both `domains` and `lpDomains`. LP Sites therefore stays xlsx-only.

56 of the 1,109 BP rows carry `project_id: 18` on five domains shared with
BIF-Dashboard. They are kept: their keywords all exist in the project-0
vocabulary, and they fill keys project 0 did not check that week.

### Our proxy is not public

`GET /api/sites` requires the caller's Supabase access token in an
`Authorization: Bearer` header and verifies it server-side
(`api/_lib/requestAuth.ts`) before forwarding anything. Without the gate the
endpoint would hand any anonymous visitor all 2,826 rows — including the 1,687
that belong to other projects — and let them burn the vendor's quota through
our key.

Only `action=results` is allowed; anything else is a 400. Two 401 shapes exist
and mean different things:

| Status | `code` | Meaning |
|---|---|---|
| 401 | `unauthenticated` | *We* rejected the caller — no session, or an expired/invalid token. |
| 401 | absent | The *vendor* rejected `SITES_API_KEY`, passed through verbatim. |

`maxDuration` is raised to 60s so the handler's own 45s timeout can produce a
504 rather than being killed by the platform's 10s/15s default first.

### Scheduled sync

`api/cron-sync.ts` runs the same pull automatically at 04:00 UTC (12:00 PHT) on
Wednesdays and Fridays, registered in `vercel.json`. It is gated by
`CRON_SECRET` and fails closed while that variable is unset.

It writes with the service-role key, because a cron has no user session for RLS
to evaluate. It only ever replaces a snapshot whose `snapshots.source` is
`'sync'` — one that a person uploaded, or has since edited inline, is skipped
and the skip is logged. Every run writes one `activity_log` row, so `/log` is
the cron's history.
