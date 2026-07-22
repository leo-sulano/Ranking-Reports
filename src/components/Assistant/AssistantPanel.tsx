import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, X, Square, Mic } from 'lucide-react'
import type { ChatMessage } from './types'
import { useVoice } from '../../hooks/useVoice'

const STARTER_QUESTIONS = [
  'Biggest drops since last week?',
  'Which brand improved the most?',
  'Any keywords that fell off (NR)?',
  'Which brand has the best avg position?',
  'Summarize wins and losses',
] as const

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

  const { supported: voiceSupported, recording, voiceError, startListening, stopListening } =
    useVoice(onSend)

  // Empty-state copy, prioritised by what's blocking use.
  const emptyState =
    reachable === null ? 'Connecting to the assistant…'
    : reachable === false ? "Assistant offline — the backend (Supabase Edge Function 'assistant') isn't deployed yet. Deploy it and set the OpenAI key, then reload."
    : !hasData ? 'Load some ranking data first, then I can help analyze it.'
    : 'Ask about ranking trends, or summarize the current view.'

  const placeholder = recording
    ? 'Listening…'
    : !online ? 'Assistant offline'
    : !hasData ? 'No data loaded'
    : 'Ask a question…'

  const submit = () => {
    if (!input.trim() || isStreaming || !ready) return
    onSend(input)
    setInput('')
  }

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-8rem)] flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-[14px] shadow-[0_40px_80px_rgba(15,23,42,0.18)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-14 shrink-0 border-b border-[var(--border)]">
        <Sparkles size={16} className="text-[var(--ink)]" />
        <span className="font-display text-[15px] tracking-wider text-[var(--ink)] flex-1">Assistant</span>
        <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--ink)]" aria-label="Close assistant">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <>
            <p className={`text-[13px] mt-2 ${reachable === false ? 'text-[#B45309]' : 'text-[var(--muted)]'}`}>
              {emptyState}
            </p>
            {ready && (
              <div className="flex flex-wrap gap-2 mt-3">
                {STARTER_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => onSend(q)}
                    className="text-[11px] border border-[var(--border)] rounded-[8px] px-2 py-1 text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:border-[var(--border-strong)] transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={
              m.role === 'user'
                ? 'inline-block bg-[var(--btn-ink)] text-white rounded-[10px] px-3 py-2 text-[13px] max-w-[85%] text-left whitespace-pre-wrap'
                : 'inline-block bg-[var(--surface-3)] text-[var(--ink)] rounded-[10px] px-3 py-2 text-[13px] max-w-[85%] whitespace-pre-wrap'
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
          className="w-full text-[12px] font-mono tracking-wider text-[var(--ink)] border border-[var(--border)] rounded-[8px] py-2 hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Summarize this view
        </button>
      </div>

      {/* Voice error */}
      {voiceError && (
        <div className="px-4 pb-1 shrink-0">
          <p className="text-[11px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-[6px] px-2 py-1">
            {voiceError}
          </p>
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 px-4 pb-4 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          disabled={!ready || recording}
          placeholder={placeholder}
          className="flex-1 text-[13px] border border-[var(--border)] rounded-[8px] px-3 py-2 outline-none focus:border-[var(--ink)] disabled:bg-[var(--surface-2)]"
        />
        {voiceSupported && (
          <button
            onClick={startListening}
            disabled={!ready || isStreaming || recording}
            aria-label="Click to speak"
            className={`rounded-[8px] p-2 transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed ${
              recording
                ? 'bg-[#FEF2F2] text-[#EF4444] animate-pulse'
                : 'bg-[var(--surface-2)] text-[var(--muted-2)] hover:text-[var(--ink)] hover:bg-[var(--surface-3)]'
            }`}
          >
            <Mic size={16} />
          </button>
        )}
        {isStreaming ? (
          <button onClick={onStop} className="bg-[var(--surface-3)] text-[var(--ink)] rounded-[8px] p-2" aria-label="Stop">
            <Square size={16} />
          </button>
        ) : recording ? (
          <button
            onClick={stopListening}
            className="bg-[#EF4444] text-white rounded-[8px] p-2 animate-pulse"
            aria-label="Stop and send"
          >
            <Send size={16} />
          </button>
        ) : (
          <button onClick={submit} disabled={!input.trim() || !ready} className="bg-[var(--btn-ink)] text-white rounded-[8px] p-2 disabled:opacity-40" aria-label="Send">
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
