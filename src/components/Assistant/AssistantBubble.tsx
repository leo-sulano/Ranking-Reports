import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { AiIcon } from './AiIcon'
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

  // Probe the Edge Function so the panel can degrade gracefully (show an
  // "offline" state) when it isn't deployed / key-configured yet. The bubble
  // itself is always shown.
  useEffect(() => {
    const controller = new AbortController()
    checkAssistantHealth(controller.signal).then(setReachable)
    return () => controller.abort()
  }, [])

  return (
    <>
      {open && (
        <AssistantPanel
          messages={messages}
          isStreaming={isStreaming}
          error={error}
          hasData={hasData}
          reachable={reachable}
          onSend={send}
          onSummarize={summarize}
          onStop={stop}
          onClose={() => setOpen(false)}
        />
      )}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-1 group">
        {!open && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-sm font-medium text-[var(--ink)] pointer-events-none select-none pr-1">
            Ask AI
          </span>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-14 h-14 rounded-full bg-[var(--btn-ink)] text-white flex items-center justify-center shadow-[0_12px_28px_rgba(15,23,42,0.35)] hover:bg-[var(--btn-ink-hover)] transition-colors"
          aria-label={open ? 'Close assistant' : 'Open assistant'}
        >
          {open ? <X size={22} /> : <AiIcon size={38} />}
        </button>
      </div>
    </>
  )
}
