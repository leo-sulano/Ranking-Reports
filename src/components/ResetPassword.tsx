import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Lock } from 'lucide-react'
import { getSession, onAuthChange, updatePassword } from '../lib/auth'

/**
 * Landing page for the password-reset email link. Supabase parses the
 * recovery token from the URL and establishes a session automatically; this
 * page waits briefly for that session to appear, then lets the user set a
 * new password. Reachable at all times (outside AuthGate) since a broken or
 * expired link must show its own message rather than the app's login screen.
 */
export function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [validLink, setValidLink] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false

    getSession().then((s) => {
      if (cancelled) return
      if (s) { setValidLink(true); setReady(true) }
    })

    const unsub = onAuthChange((s) => {
      if (cancelled) return
      if (s) setValidLink(true)
      setReady(true)
    })

    // Supabase processes the recovery token asynchronously on load — if
    // neither getSession nor onAuthChange has produced a session shortly
    // after mount, treat the link as invalid/expired.
    const timeout = setTimeout(() => { if (!cancelled) setReady(true) }, 2500)

    return () => { cancelled = true; unsub(); clearTimeout(timeout) }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      await updatePassword(password)
      setDone(true)
      setTimeout(() => navigate('/'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password')
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--surface-2)] relative px-4">
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(#E2E8F0 1px, transparent 1px), linear-gradient(90deg, #E2E8F0 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative z-10 w-[380px] max-w-full bg-[var(--surface)] border border-[var(--border)] rounded-[14px] p-7 shadow-[0_40px_80px_rgba(15,23,42,0.18)]">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-[var(--btn-ink)] text-white">
            <Lock size={15} />
          </span>
          <span className="font-display text-[20px] tracking-wider text-[var(--ink)]">
            Ranking Reports
          </span>
        </div>

        {!ready && (
          <p className="text-[12px] font-mono text-[var(--muted)] mt-6">Verifying reset link…</p>
        )}

        {ready && !validLink && (
          <>
            <p className="text-[12px] font-mono text-[var(--muted)] mb-6 mt-5">
              This reset link is invalid or has expired.
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full h-10 rounded-[9px] bg-[var(--btn-ink)] text-white text-[13px] font-medium tracking-wider hover:bg-[var(--btn-ink-hover)] transition-colors"
            >
              Back to sign in
            </button>
          </>
        )}

        {ready && validLink && done && (
          <p className="text-[12px] font-mono text-[var(--muted)] mb-1 mt-6">
            ✓ Password updated — redirecting…
          </p>
        )}

        {ready && validLink && !done && (
          <form onSubmit={handleSubmit}>
            <p className="text-[12px] font-mono text-[var(--muted)] mb-6">
              Choose a new password for your account
            </p>

            <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--muted)] mb-1.5">
              New password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full mb-4 px-3 h-10 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--ink)] focus:bg-[var(--surface)] transition-colors"
              placeholder="••••••••"
            />

            <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--muted)] mb-1.5">
              Confirm password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full mb-5 px-3 h-10 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--ink)] focus:bg-[var(--surface)] transition-colors"
              placeholder="••••••••"
            />

            {error && (
              <p className="mb-4 text-[12px] text-[var(--neg)] bg-[var(--neg-surface)] border border-[var(--neg-border)] rounded-[9px] px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-10 rounded-[9px] bg-[var(--btn-ink)] text-white text-[13px] font-medium tracking-wider flex items-center justify-center gap-2 hover:bg-[var(--btn-ink-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              <KeyRound size={15} />
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
