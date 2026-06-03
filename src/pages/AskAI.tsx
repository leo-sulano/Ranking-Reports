import { useState, useRef, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Sparkles, Send, Square, RotateCcw } from 'lucide-react'
import type { RROutletContext } from '../types'
import { useAssistant } from '../hooks/useAssistant'
import { checkAssistantHealth } from '../lib/assistantClient'
import { buildHistoryDigest } from '../lib/assistantDigest'
import { BRANDS } from '../lib/brands'

const STARTER_QUESTIONS = [
  'Biggest drops since last week?',
  'Which brand improved the most?',
  'Any keywords that fell off (NR)?',
  'Which brand has the best avg position?',
  'Summarize wins and losses',
] as const

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

  const bpDigest = buildHistoryDigest(snapshots, 'bp-sites')
  const latestPerBrand = bpDigest.timeline[0]?.perBrand ?? []

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

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── Left panel ─────────────────────────────────────────────────── */}
      <div className="w-[300px] shrink-0 border-r border-[#E2E8F0] flex flex-col overflow-hidden bg-white">

        <div className="px-5 py-4 border-b border-[#E2E8F0] shrink-0">
          <h2 className="font-display text-[13px] tracking-wider text-[#0F172A]">What I know</h2>
          <p className="text-[11px] text-[#64748B] mt-0.5">Latest snapshot · BP Sites</p>
        </div>

        {/* Brand overview cards */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
          {BRANDS.map((brand) => {
            const stats = latestPerBrand.find((b) => b.brand === brand.name)
            return (
              <div
                key={brand.name}
                className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0]"
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: brand.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-[#0F172A] truncate">
                    {brand.name}
                  </div>
                  {stats ? (
                    <div className="text-[10px] text-[#64748B] font-mono">
                      {stats.rankingKeywords} kw · avg {stats.avgPosition} · top3: {stats.top3}
                    </div>
                  ) : (
                    <div className="text-[10px] text-[#94A3B8]">no data</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Suggested questions */}
        <div className="px-3 py-3 border-t border-[#E2E8F0] shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748B] mb-2 px-1">
            Suggested
          </p>
          <div className="space-y-1">
            {STARTER_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => ready && send(q)}
                disabled={!ready}
                className="w-full text-left text-[11px] text-[#475569] px-3 py-1.5 rounded-[6px] hover:bg-[#F1F5F9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel — chat ──────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 bg-white">

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
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {messages.length === 0 && (
            <p className={`text-[13px] mt-2 ${reachable === false ? 'text-[#B45309]' : 'text-[#64748B]'}`}>
              {emptyState}
            </p>
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

        {/* Summarize */}
        <div className="px-6 pb-2 shrink-0">
          <button
            onClick={summarize}
            disabled={!ready || isStreaming}
            className="w-full text-[12px] font-mono tracking-wider text-[#0F172A] border border-[#E2E8F0] rounded-[8px] py-2 hover:bg-[#F8FAFC] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Summarize this view
          </button>
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 px-6 pb-5 shrink-0">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            disabled={!ready}
            placeholder={!online ? 'Assistant offline' : !hasData ? 'No data loaded' : 'Ask a question…'}
            className="flex-1 text-[13px] border border-[#E2E8F0] rounded-[8px] px-3 py-2.5 outline-none focus:border-[#0F172A] disabled:bg-[#F8FAFC]"
          />
          {isStreaming ? (
            <button
              onClick={stop}
              className="bg-[#F1F5F9] text-[#0F172A] rounded-[8px] p-2.5"
              aria-label="Stop"
            >
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
