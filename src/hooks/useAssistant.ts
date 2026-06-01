import { useState, useRef, useCallback } from 'react'
import type { Snapshot } from '../types'
import type { CategoryId } from '../lib/categories'
import type { ChatMessage } from '../components/Assistant/types'
import { buildHistoryDigest } from '../lib/assistantDigest'
import { streamChat } from '../lib/assistantClient'

const MAX_TURNS = 10
const SUMMARIZE_PROMPT =
  'Summarize the most important ranking movements across all brands in the latest snapshot versus the prior one. Call out the biggest improvements, the biggest drops, and any brand that stands out. Be concise.'

export function useAssistant(snapshots: Snapshot[], category: CategoryId) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async (history: ChatMessage[]) => {
    setError(null)
    setIsStreaming(true)
    // Push an empty assistant message we stream into.
    setMessages([...history, { role: 'assistant', content: '' }])

    const digest = buildHistoryDigest(snapshots, category)
    const upstream = history.slice(-MAX_TURNS)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat(upstream, digest, {
        signal: controller.signal,
        onToken: (delta) => {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, content: last.content + delta }
            return next
          })
        },
      })
    } catch (e) {
      if (controller.signal.aborted) return   // user-initiated stop — keep partial
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      // Drop the empty/partial assistant bubble so the error row stands alone.
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant' && last.content === '') return prev.slice(0, -1)
        return prev
      })
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [snapshots, category])

  const send = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    run([...messages, { role: 'user', content: trimmed }])
  }, [messages, isStreaming, run])

  const summarize = useCallback(() => {
    if (isStreaming) return
    run([...messages, { role: 'user', content: SUMMARIZE_PROMPT }])
  }, [messages, isStreaming, run])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
  }, [])

  return { messages, isStreaming, error, send, summarize, stop, reset }
}
