import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, X, Square } from 'lucide-react'
import type { ChatMessage } from './types'

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
  error: string | null
  hasData: boolean
  // null = still probing the backend; false = unreachable/unconfigured; true = ready.
  reachable: boolean | null
  onSend: (text: string) => void
  onSummarize: () => void
  onStop: () => void
  onClose: () => void
}

export function AssistantPanel({
  messages, isStreaming, error, hasData, reachable, onSend, onSummarize, onStop, onClose,
}: Props) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const online = reachable === true
  const ready = online && hasData   // can actually send a message

  // Empty-state copy, prioritised by what's blocking use.
  const emptyState =
    reachable === null ? 'Connecting to the assistant…'
    : reachable === false ? "Assistant offline — the backend (Supabase Edge Function 'assistant') isn't deployed yet. Deploy it and set the OpenAI key, then reload."
    : !hasData ? 'Load some ranking data first, then I can help analyze it.'
    : 'Ask about ranking trends, or summarize the current view.'

  const placeholder =
    !online ? 'Assistant offline' : hasData ? 'Ask a question…' : 'No data loaded'

  const submit = () => {
    if (!input.trim() || isStreaming || !ready) return
    onSend(input)
    setInput('')
  }

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-8rem)] flex flex-col bg-white border border-[#E2E8F0] rounded-[14px] shadow-[0_40px_80px_rgba(15,23,42,0.18)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-14 shrink-0 border-b border-[#E2E8F0]">
        <Sparkles size={16} className="text-[#0F172A]" />
        <span className="font-display text-[15px] tracking-wider text-[#0F172A] flex-1">Assistant</span>
        <button onClick={onClose} className="text-[#64748B] hover:text-[#0F172A]" aria-label="Close assistant">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className={`text-[13px] mt-2 ${reachable === false ? 'text-[#B45309]' : 'text-[#64748B]'}`}>
            {emptyState}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={
              m.role === 'user'
                ? 'inline-block bg-[#0F172A] text-white rounded-[10px] px-3 py-2 text-[13px] max-w-[85%] text-left whitespace-pre-wrap'
                : 'inline-block bg-[#F1F5F9] text-[#0F172A] rounded-[10px] px-3 py-2 text-[13px] max-w-[85%] whitespace-pre-wrap'
            }>
              {m.content || (isStreaming && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
        {error && (
          <div className="text-[12px] text-[#EF4444] bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Summarize */}
      <div className="px-4 pb-2 shrink-0">
        <button
          onClick={onSummarize}
          disabled={!ready || isStreaming}
          className="w-full text-[12px] font-mono tracking-wider text-[#0F172A] border border-[#E2E8F0] rounded-[8px] py-2 hover:bg-[#F8FAFC] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Summarize this view
        </button>
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-4 pb-4 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          disabled={!ready}
          placeholder={placeholder}
          className="flex-1 text-[13px] border border-[#E2E8F0] rounded-[8px] px-3 py-2 outline-none focus:border-[#0F172A] disabled:bg-[#F8FAFC]"
        />
        {isStreaming ? (
          <button onClick={onStop} className="bg-[#F1F5F9] text-[#0F172A] rounded-[8px] p-2" aria-label="Stop">
            <Square size={16} />
          </button>
        ) : (
          <button onClick={submit} disabled={!input.trim() || !ready} className="bg-[#0F172A] text-white rounded-[8px] p-2 disabled:opacity-40" aria-label="Send">
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
