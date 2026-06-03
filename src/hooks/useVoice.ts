import { useState, useRef, useCallback } from 'react'

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

export function useVoice(onResult: (text: string) => void) {
  const [recording, setRecording] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recognitionRef = useRef<unknown>(null)
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualStopRef = useRef(false)

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
        if (transcript) {
          if (manualStopRef.current) {
            manualStopRef.current = false
            onResult(transcript)
          } else {
            sendTimerRef.current = setTimeout(() => onResult(transcript), 5000)
          }
        }
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
    manualStopRef.current = true
    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current)
      sendTimerRef.current = null
    }
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
