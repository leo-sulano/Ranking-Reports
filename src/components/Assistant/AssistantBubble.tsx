import { useState, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { Snapshot } from '../../types'
import type { CategoryId } from '../../lib/categories'
import { useAssistant } from '../../hooks/useAssistant'
import { checkAssistantHealth } from '../../lib/assistantClient'
import { AssistantPanel } from './AssistantPanel'

interface Props {
  snapshots: Snapshot[]
  category: CategoryId
}

export function AssistantBubble({ snapshots, category }: Props) {
  const [open, setOpen] = useState(false)
  // null = still probing; false = backend unreachable/unconfigured; true = ready.
  const [reachable, setReachable] = useState<boolean | null>(null)
  const { messages, isStreaming, error, send, summarize, stop } = useAssistant(snapshots, category)
  const hasData = snapshots.some((s) => s.category === category && s.records.length > 0)

  // Hide the assistant entirely until the Edge Function is deployed AND has the
  // OpenAI key configured — avoids dangling a bubble that only ever errors.
  useEffect(() => {
    const controller = new AbortController()
    checkAssistantHealth(controller.signal).then(setReachable)
    return () => controller.abort()
  }, [])

  if (!reachable) return null

  return (
    <>
      {open && (
        <AssistantPanel
          messages={messages}
          isStreaming={isStreaming}
          error={error}
          hasData={hasData}
          onSend={send}
          onSummarize={summarize}
          onStop={stop}
          onClose={() => setOpen(false)}
        />
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#0F172A] text-white flex items-center justify-center shadow-[0_12px_28px_rgba(15,23,42,0.35)] hover:bg-[#1E293B] transition-colors"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>
    </>
  )
}
