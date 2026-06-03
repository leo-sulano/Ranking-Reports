# Voice Input — Design Spec

**Date:** 2026-06-03
**Status:** Approved, pending implementation plan

## Goal

Add a microphone button to the Ask AI page so users can speak their questions instead of typing. Speech is transcribed and auto-sent when the user stops speaking.

## Approach

Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`). Free, no API key, no server calls, works in Chrome and Edge. Mic button hidden on unsupported browsers — no broken UI, graceful degradation.

## File

**One file changed:** `src/pages/AskAI.tsx` only.

## Implementation

### `useVoice` hook (inside AskAI.tsx)

```ts
function useVoice(onResult: (text: string) => void): {
  supported: boolean
  recording: boolean
  voiceError: string | null
  startListening: () => void
}
```

- Detects support: `'SpeechRecognition' in window || 'webkitSpeechRecognition' in window`
- Creates a `SpeechRecognition` instance with: `interimResults: false`, `continuous: false`, `lang: 'en-US'`
- `onresult`: extracts `event.results[0][0].transcript`, calls `onResult(transcript)`
- `onerror`: sets `voiceError` for 3 seconds then clears
- `onend`: sets `recording = false`
- `startListening()`: calls `recognition.start()`, sets `recording = true`
- Returns `{ supported, recording, voiceError, startListening }`

### UI changes in AskAI.tsx

1. **Mic button** — rendered between the input field and the Send/Stop button, only when `supported`. 
   - Idle: `Mic` icon (lucide-react), muted color `text-[#94A3B8]`
   - Recording: `MicOff` icon (lucide-react), red `text-[#EF4444]` + `animate-pulse`
   - Disabled when `!ready || isStreaming`

2. **Input placeholder** — shows `"Listening…"` when `recording`, otherwise existing logic

3. **Voice error** — when `voiceError` is set, show a small amber error line below the input (same style as the existing error row but amber, auto-clears after 3s)

## Behaviour

- Auto-sends on result: `onResult` calls `send(transcript)` directly — no intermediate state, no user edit step
- Does not interfere with typed input — both paths call the same `send()` function
- `recording` blocks the Send button and disables the text input (same `!ready` pattern)
- `continuous: false` means it stops after a natural speech pause — no manual stop needed

## Error states

| Error | Display |
|-------|---------|
| `not-allowed` (permission denied) | "Microphone access denied." (amber, 3s) |
| `no-speech` | "No speech detected." (amber, 3s) |
| `network` | "Voice recognition unavailable." (amber, 3s) |
| Unsupported browser | Mic button hidden, no message |

## Out of scope

Continuous listening mode, language selection, interim transcription display, voice output (text-to-speech responses), Whisper API fallback.
