# Voice Input — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a microphone button to the Ask AI page that listens to the user's voice and auto-sends the transcript as a question.

**Architecture:** A `useVoice` hook (defined in the same file) wraps the browser `SpeechRecognition` API. It exposes `{ supported, recording, voiceError, startListening }`. The mic button renders only when `supported`, pulses red while recording, and is hidden on unsupported browsers. On speech result, `send(transcript)` is called directly.

**Tech Stack:** React, TypeScript, Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`), lucide-react (`Mic`, `MicOff`).

---

## Files

| Action | Path |
|--------|------|
| Modify | `src/pages/AskAI.tsx` |

---

## Task 1: Add voice input to AskAI page

**Files:**
- Modify: `src/pages/AskAI.tsx`

- [ ] **Step 1: Replace the file with the updated version**

Overwrite `src/pages/AskAI.tsx` with:

```tsx
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

const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window.SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition ?? null)
    : null

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access denied.',
  'no-speech':   'No speech detected.',
  'network':     'Voice recognition unavailable.',
}

function useVoice(onResult: (text: string) => void) {
  const [recording, setRecording] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recognitionRef = useRef<InstanceType<typeof window.SpeechRecognition> | null>(null)

  const startListening = useCallback(() => {
    if (!SpeechRecognitionAPI) return
    const recognition = new SpeechRecognitionAPI()
    recognition.interimResults = false
    recognition.continuous = false
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim()
      if (transcript) onResult(transcript)
    }

    recognition.onerror = (event) => {
      const msg = ERROR_MESSAGES[event.error] ?? 'Voice recognition error.'
      setVoiceError(msg)
      setTimeout(() => setVoiceError(null), 3000)
      setRecording(false)
    }

    recognition.onend = () => setRecording(false)

    recognitionRef.current = recognition
    recognition.start()
    setRecording(true)
  }, [onResult])

  return {
    supported: Boolean(SpeechRecognitionAPI),
    recording,
    voiceError,
    startListening,
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

  const { supported: voiceSupported, recording, voiceError, startListening } =
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
    ? 'Listening…'
    : !online ? 'Assistant offline'
    : !hasData ? 'No data loaded'
    : 'Ask a question…'

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

          {/* Mic button — only on supported browsers */}
          {voiceSupported && (
            <button
              onClick={startListening}
              disabled={!ready || isStreaming || recording}
              aria-label={recording ? 'Listening…' : 'Speak a question'}
              className={`rounded-[8px] p-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: clean build, no type errors (chunk-size warning is pre-existing).

- [ ] **Step 3: Commit and push**

```bash
git add src/pages/AskAI.tsx
git commit -m "feat(ask-ai): add voice input via Web Speech API"
git push origin main
```

---

## Done

Voice input is live. The mic button appears next to Send on supported browsers (Chrome, Edge). Click it, speak, and the question auto-sends. On unsupported browsers the button is hidden. Errors (permission denied, no speech) show in amber for 3 seconds then clear.
