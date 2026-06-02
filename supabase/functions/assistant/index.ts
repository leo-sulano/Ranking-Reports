// Supabase Edge Function: assistant
// Proxies chat requests to OpenAI with the ranking digest as context.
// Secrets (set via `supabase secrets set`):
//   OPENAI_API_KEY      (required)
//   OPENAI_MODEL        (optional, default gpt-4o-mini)
//   ALLOWED_ORIGINS     (optional, comma-separated; when unset, all origins allowed)

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'

// Bounds the cost of any single request. Summaries/answers fit comfortably here.
const MAX_TOKENS = 800

// Comma-separated allowlist. Empty ⇒ permissive ('*') so local dev / unconfigured
// projects keep working. When set, only these browser origins may call the
// function (a deterrent against other sites embedding it — not a hard wall, since
// a non-browser client can spoof the Origin header).
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Returns the value to use for Access-Control-Allow-Origin, or null if the
// request's Origin is not allowed.
function resolveOrigin(req: Request): string | null {
  if (ALLOWED_ORIGINS.length === 0) return '*'
  const origin = req.headers.get('Origin')
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin
  return null
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function systemPrompt(digest: unknown): string {
  const d = digest as {
    rangeMovers?: { fromDate?: string; toDate?: string }
  }
  const rangeLabel =
    d.rangeMovers?.fromDate && d.rangeMovers?.toDate
      ? `${d.rangeMovers.fromDate} → ${d.rangeMovers.toDate}`
      : 'full retained range'

  return [
    '## Role',
    'You are an analytics assistant embedded in an SEO keyword-ranking dashboard for Rooster Partners casino brands.',
    'Answer questions about the ranking data concisely and factually.',
    '',
    '## Domain rules',
    '- Lower position numbers are better (position 1 is best).',
    '- "NR" means Not Ranking — the keyword does not appear in the tracked results.',
    '- A negative `delta` means the keyword improved (moved toward position 1).',
    '- The `gained` list contains keywords that moved from NR to a numeric position (wins).',
    '- The `lost` list contains keywords that moved from a numeric position to NR (regressions).',
    '- Only use data present in the digest below. If something is not in the data, say so rather than guessing.',
    '',
    '## Digest structure',
    '- `timeline` — per-brand stats across snapshots, **newest first**, capped at 12.',
    '  Each entry has `perBrand[]` with: `rankingKeywords`, `avgPosition`, `top3`, `top10`,',
    '  `byCountry[]` (top 8 countries by keyword count), and `topKeywords[]` (5 best numeric positions).',
    '- `movers` — keywords with the largest position changes between the **two most recent** snapshots.',
    '- `gained` / `lost` — keywords that newly started or stopped ranking between the two most recent snapshots.',
    `- \`rangeMovers\` — largest position changes across the **full retained range** (${rangeLabel}).`,
    '',
    '## Answer format',
    '- Lead with the direct answer; no preamble.',
    '- Use compact markdown: short bullet points, **bold** brand names and keywords, position numbers inline.',
    '- Be concise — one or two sentences when that is sufficient.',
    '',
    '## Few-shot examples',
    '',
    '**Q: Which keywords dropped the most this week?**',
    'A: Biggest drops (latest vs prior snapshot, from `movers` where delta > 0):',
    '- **RoosterBet** – "online casino" UK: 3 → 9 (+6, worsened)',
    '- **Spinjo** – "free spins" AU: 7 → 14 (+7, worsened)',
    'Also check `lost` for keywords that fell off entirely (dropped to NR).',
    '',
    '**Q: How is RoosterBet doing in Germany?**',
    'A: In the latest snapshot, **RoosterBet** Germany (`byCountry`): avg position **4.2**, **12** ranking keywords, **3** in top 3, **8** in top 10.',
    'Top keywords: "online casino" (#1), "best casino" (#2), "casino bonus" (#4).',
    '',
    '**Q: Any keywords that fell off (NR) recently?**',
    'A: From the `lost` list (latest vs prior snapshot):',
    '- **LuckyVibe** – "casino app" IE: fell from position **5** to NR.',
    '- **PlayMojo** – "slots bonus" AU: fell from position **8** to NR.',
    '',
    '## Ranking data digest (JSON)',
    JSON.stringify(digest),
  ].join('\n')
}

Deno.serve(async (req) => {
  const allowOrigin = resolveOrigin(req)

  // Reject disallowed origins outright (no CORS headers ⇒ browser blocks the read).
  if (allowOrigin === null) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const cors = corsHeaders(allowOrigin)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Lightweight reachability probe used by the frontend to decide whether to
  // show the assistant bubble at all.
  if (req.method === 'GET') {
    return json({ ok: true, configured: Boolean(OPENAI_API_KEY) }, 200, cors)
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  if (!OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY not configured' }, 500, cors)

  let body: { messages?: { role: string; content: string }[]; digest?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, cors)
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) return json({ error: 'No messages provided' }, 400, cors)

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      stream: true,
      temperature: 0.3,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt(body.digest) },
        ...messages,
      ],
    }),
  })

  if (!openaiRes.ok || !openaiRes.body) {
    const detail = await openaiRes.text().catch(() => '')
    return json({ error: `OpenAI error ${openaiRes.status}: ${detail}` }, openaiRes.status, cors)
  }

  // Pipe OpenAI's SSE stream straight back to the browser.
  return new Response(openaiRes.body, {
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
})
