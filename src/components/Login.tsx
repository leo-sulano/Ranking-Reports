import { useState, type FormEvent } from 'react'
import { Lock, LogIn } from 'lucide-react'
import { sendPasswordReset, signIn } from '../lib/auth'

type Mode = 'signin' | 'forgot'

/**
 * Login screen shown by AuthGate when VITE_REQUIRE_AUTH=true and no session
 * exists. On success, AuthGate's auth listener swaps this out for the app.
 */
export function Login() {
  const [mode, setMode]         = useState<Mode>('signin')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)
  const [resetSent, setResetSent] = useState(false)

  function openForgot() {
    setMode('forgot')
    setError(null)
    setResetSent(false)
  }

  function backToSignIn() {
    setMode('signin')
    setError(null)
    setResetSent(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'forgot') {
        await sendPasswordReset(email.trim())
        setResetSent(true)
        setBusy(false)
      } else {
        await signIn(email.trim(), password)
        // No navigation needed — the onAuthChange listener in AuthGate re-renders.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (mode === 'forgot' ? 'Could not send reset email' : 'Sign-in failed'))
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--surface-2)] relative px-4">
      {/* Background grid, mirrors the main app */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-[380px] max-w-full bg-[var(--surface)] border border-[var(--border)] rounded-[14px] p-7 shadow-[0_40px_80px_rgba(15,23,42,0.18)]"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-[var(--btn-ink)] text-white">
            <Lock size={15} />
          </span>
          <span className="font-display text-[20px] tracking-wider text-[var(--ink)]">
            Ranking Reports
          </span>
        </div>
        <p className="text-[12px] font-mono text-[var(--muted)] mb-6">
          {mode === 'forgot' ? 'Enter your email and we’ll send you a reset link' : 'Sign in to access the dashboard'}
        </p>

        <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--muted)] mb-1.5">
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 h-10 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--ink)] focus:bg-[var(--surface)] transition-colors"
          placeholder="you@optinetsolutions.com"
        />

        {mode === 'signin' && (
          <>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-[var(--muted)] mb-1.5">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full mb-2 px-3 h-10 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--ink)] focus:bg-[var(--surface)] transition-colors"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={openForgot}
              className="block ml-auto mb-3 text-[12px] font-mono text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              Forgot password?
            </button>
          </>
        )}

        {mode === 'forgot' && resetSent && (
          <p className="mb-4 text-[12px] text-[#166534] bg-[var(--pos-surface)] border border-[var(--pos-border)] rounded-[9px] px-3 py-2">
            If that email is registered, a reset link is on its way — check your inbox.
          </p>
        )}

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
          <LogIn size={15} />
          {busy
            ? (mode === 'forgot' ? 'Sending…' : 'Signing in…')
            : (mode === 'forgot' ? 'Send reset link' : 'Sign in')}
        </button>

        {mode === 'forgot' && (
          <button
            type="button"
            onClick={backToSignIn}
            className="w-full mt-3 text-[12px] font-mono text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            Back to sign in
          </button>
        )}
      </form>
    </div>
  )
}
