// Supabase Edge Function: assistant
// Proxies chat requests to OpenAI with the ranking digest as context.
// Secrets (set via `supabase secrets set`): OPENAI_API_KEY, optional OPENAI_MODEL.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function systemPrompt(digest: unknown): string {
  return [
    'You are an analytics assistant embedded in an SEO keyword-ranking dashboard',
    'for Rooster Partners casino brands. Answer questions about the ranking data',
    'concisely and factually. Lower position numbers are better (1 is best);',
    '"NR" means not ranking. A negative mover delta means the keyword improved',
    '(moved toward #1). Only use the data provided below — if something is not in',
    'the data, say so rather than guessing.',
    '',
    'Here is a compact digest of the ranking history (JSON):',
    JSON.stringify(digest),
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  let body: { messages?: { role: string; content: string }[]; digest?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: 'No messages provided' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

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
      messages: [
        { role: 'system', content: systemPrompt(body.digest) },
        ...messages,
      ],
    }),
  })

  if (!openaiRes.ok || !openaiRes.body) {
    const detail = await openaiRes.text().catch(() => '')
    return new Response(JSON.stringify({ error: `OpenAI error ${openaiRes.status}: ${detail}` }), {
      status: openaiRes.status, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Pipe OpenAI's SSE stream straight back to the browser.
  return new Response(openaiRes.body, {
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
})
