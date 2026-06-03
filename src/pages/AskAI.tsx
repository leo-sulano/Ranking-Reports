import { useState, useRef, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Sparkles, Send, Square, RotateCcw, Mic, MicOff } from 'lucide-react'
import type { RROutletContext } from '../types'
import { useAssistant } from '../hooks/useAssistant'
import { checkAssistantHealth } from '../lib/assistantClient'

const STARTER_QUESTIONS = [
  'Biggest drops since last week?',
  'Which brand improved the most?',
  'Any keywords that fell off (NR)?',
  'Which brand has the best avg position?',
  'Summarize wins and losses',
] as const

// ── Voice hook ────────────────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access denied.',
  'no-speech':   'No speech detected.',
  'network':     'Voice recognition unavailable.',
}

function getSpeechRecognitionAPI() {
  if (typeof window === 'undefined') return null
  const win = window as unknown as Record<string, unknown>
  return (win.SpeechRecognition ?? win.webkitSpeechRecognition) as unknown
}

function useVoice(onResult: (text: string) => void) {
  const [recording, setRecording] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recognitionRef = useRef<unknown>(null)

  const startListening = useCallback(() => {
    const SpeechRecognitionAPI = getSpeechRecognitionAPI()
    if (!SpeechRecognitionAPI) return

    try {
      const recognition = new (SpeechRecognitionAPI as unknown as { new (): unknown })()
      const rec = recognition as unknown as {
        interimResults?: boolean
        continuous?: boolean
        lang?: string
        onresult?: (event: unknown) => void
        onerror?: (event: unknown) => void
        onend?: () => void
        start: () => void
        stop: () => void
      }

      rec.interimResults = false
      rec.continuous = false
      rec.lang = 'en-US'

      rec.onresult = (event: unknown) => {
        const evt = event as unknown as {
          results: Array<Array<{ transcript: string }>>
        }
        const transcript = evt.results?.[0]?.[0]?.transcript?.trim()
        if (transcript) onResult(transcript)
      }

      rec.onerror = (event: unknown) => {
        const evt = event as unknown as { error: string }
        const msg = ERROR_MESSAGES[evt.error] ?? 'Voice recognition error.'
        setVoiceError(msg)
        setTimeout(() => setVoiceError(null), 3000)
        setRecording(false)
      }

      rec.onend = () => setRecording(false)

      recognitionRef.current = recognition
      rec.start()
      setRecording(true)
    } catch {
      setVoiceError('Voice recognition error.')
      setTimeout(() => setVoiceError(null), 3000)
    }
  }, [onResult])

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current as { stop?: () => void } | null
    rec?.stop?.()
  }, [])

  return {
    supported: Boolean(getSpeechRecognitionAPI()),
    recording,
    voiceError,
    startListening,
    stopListening,
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AskAI() {
  const { snapshots } = useOutletContext<RROutletContext>()
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const { messages, isStreaming, error, send, summarize, stop, reset } =
    useAssistant(snapshots, 'bp-sites')

  const hasData = snapshots.length > 0
  const online = reachable === true
  const ready = online && hasData

  const { supported: voiceSupported, recording, voiceError, startListening, stopListening } =
    useVoice(send)

  useEffect(() => {
    const controller = new AbortController()
    checkAssistantHealth(controller.signal).then(setReachable)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const submit = () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming || !ready) return
    send(trimmed)
    setInput('')
  }

  const emptyState =
    reachable === null ? 'Connecting to the assistant…'
    : reachable === false ? "Assistant offline — deploy the Edge Function and set the OpenAI key, then reload."
    : !hasData ? 'Load some ranking data first, then I can help analyze it.'
    : 'Ask about rankings, trends, or specific keyword positions across all brands and sites.'

  const inputPlaceholder = recording
    ? 'Listening… release to send'
    : !online ? 'Assistant offline'
    : !hasData ? 'No data loaded'
    : 'Ask a question or hold 🎤 to speak'

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-white">

      {/* Header */}
      <div className="flex items-center gap-2 px-6 h-14 shrink-0 border-b border-[#E2E8F0]">
        <Sparkles size={16} className="text-[#0F172A]" />
        <span className="font-display text-[15px] tracking-wider text-[#0F172A] flex-1">
          Ask AI
        </span>
        {messages.length > 0 && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 text-[11px] text-[#64748B] hover:text-[#0F172A] px-2 py-1 rounded-[6px] hover:bg-[#F8FAFC] transition-colors"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3 max-w-3xl w-full mx-auto">
        {messages.length === 0 && (
          <>
            <p className={`text-[13px] mt-2 ${reachable === false ? 'text-[#B45309]' : 'text-[#64748B]'}`}>
              {emptyState}
            </p>
            {ready && (
              <div className="flex flex-wrap gap-2 mt-4">
                {STARTER_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="text-[11px] border border-[#E2E8F0] rounded-[8px] px-3 py-1.5 text-[#475569] hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-colors"
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
                ? 'inline-block bg-[#0F172A] text-white rounded-[10px] px-4 py-2.5 text-[13px] max-w-[75%] text-left whitespace-pre-wrap'
                : 'inline-block bg-[#F1F5F9] text-[#0F172A] rounded-[10px] px-4 py-2.5 text-[13px] max-w-[75%] whitespace-pre-wrap'
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

      {/* Bottom bar */}
      <div className="max-w-3xl w-full mx-auto px-6 pb-5 shrink-0 space-y-2">
        <button
          onClick={summarize}
          disabled={!ready || isStreaming}
          className="w-full text-[12px] font-mono tracking-wider text-[#0F172A] border border-[#E2E8F0] rounded-[8px] py-2 hover:bg-[#F8FAFC] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Summarize this view
        </button>

        {voiceError && (
          <p className="text-[11px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-[6px] px-3 py-1.5">
            {voiceError}
          </p>
        )}

        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            disabled={!ready || recording}
            placeholder={inputPlaceholder}
            className="flex-1 text-[13px] border border-[#E2E8F0] rounded-[8px] px-3 py-2.5 outline-none focus:border-[#0F172A] disabled:bg-[#F8FAFC]"
          />

          {/* Mic button — hold to record, release to send */}
          {voiceSupported && (
            <button
              onMouseDown={startListening}
              onMouseUp={stopListening}
              onMouseLeave={stopListening}
              onTouchStart={startListening}
              onTouchEnd={stopListening}
              disabled={!ready || isStreaming}
              aria-label={recording ? 'Release to send' : 'Hold to speak'}
              title={recording ? 'Release to send' : 'Hold to speak'}
              className={`rounded-[8px] p-2.5 transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed ${
                recording
                  ? 'bg-[#FEF2F2] text-[#EF4444] animate-pulse'
                  : 'bg-[#F8FAFC] text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9]'
              }`}
            >
              {recording ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          )}

          {isStreaming ? (
            <button onClick={stop} className="bg-[#F1F5F9] text-[#0F172A] rounded-[8px] p-2.5" aria-label="Stop">
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim() || !ready}
              className="bg-[#0F172A] text-white rounded-[8px] p-2.5 disabled:opacity-40"
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
