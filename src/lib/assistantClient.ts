import type { ChatMessage, HistoryDigest } from '../components/Assistant/types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const FN_URL = `${SUPABASE_URL}/functions/v1/assistant`

export interface StreamHandlers {
  onToken: (delta: string) => void
  signal?: AbortSignal
}

/**
 * POST the conversation + digest to the assistant Edge Function and stream the
 * reply. Resolves when the stream completes. Throws on non-2xx or network error.
 */
export async function streamChat(
  messages: ChatMessage[],
  digest: HistoryDigest,
  { onToken, signal }: StreamHandlers,
): Promise<void> {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ messages, digest }),
    signal,
  })

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j?.error) detail = typeof j.error === 'string' ? j.error : JSON.stringify(j.error)
    } catch { /* non-JSON error body */ }
    throw new Error(detail)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by double newlines.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) onToken(delta)
      } catch { /* keep-alive or partial frame — ignore */ }
    }
  }
}
