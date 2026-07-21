import { useState, type FormEvent } from 'react'
import { Lock, LogIn, X } from 'lucide-react'
import { signIn, signInWithGoogle, signUp } from '../lib/auth'

type Mode = 'signin' | 'signup'

/**
 * Shared login/sign-up overlay opened by useAuth() whenever a signed-out
 * user triggers a gated action, or clicks "Sign in" in the Topbar. On
 * successful email/password sign-in, useAuth's onAuthChange listener closes
 * this and resumes whatever action was pending — no logic needed here beyond
 * calling signIn(). Google sign-in redirects the whole page away, so nothing
 * after that call runs. Signing up always closes the modal immediately
 * (via onClose, which useAuth wires to cancelAuth) — a brand-new account is
 * never approved yet, so there's nothing to resume.
 */
export function LoginModal({
  open,
  onClose,
  onSignedUp,
}: {
  open: boolean
  onClose: () => void
  onSignedUp?: () => void
}) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  function toggleMode() {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        await signUp(email.trim(), password)
        onSignedUp?.()
        onClose()
      } else {
        await signIn(email.trim(), password)
      }
    } catch (err) {
      const fallback = mode === 'signup' ? 'Sign-up failed' : 'Sign-in failed'
      setError(err instanceof Error ? err.message : fallback)
      setBusy(false)
    }
  }

  async function handleGoogle() {
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-md z-[60] flex items-center justify-center px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        className="relative w-[380px] max-w-full bg-white border border-[#E2E8F0] rounded-[14px] p-7 shadow-[0_40px_80px_rgba(15,23,42,0.18)] animate-[modalIn_0.2s_ease]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center bg-[#F1F5F9] border border-[#E2E8F0] rounded-md text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1] transition-all"
        >
          <X size={14} strokeWidth={2.25} />
        </button>

        <div className="flex items-center gap-2.5 mb-1">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-[#0F172A] text-white">
            <Lock size={15} />
          </span>
          <span className="font-display text-[20px] tracking-wider text-[#0F172A]">
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </span>
        </div>
        <p className="text-[12px] font-mono text-[#64748B] mb-6">
          {mode === 'signup'
            ? 'Create an account — an admin will approve it before you can make changes'
            : 'Sign in to make changes to the dashboard'}
        </p>

        <label className="block text-[11px] font-mono uppercase tracking-wider text-[#64748B] mb-1.5">
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 h-10 rounded-[9px] border border-[#E2E8F0] bg-[#F8FAFC] text-[14px] text-[#0F172A] outline-none focus:border-[#0F172A] focus:bg-white transition-colors"
          placeholder="you@optinetsolutions.com"
        />

        <label className="block text-[11px] font-mono uppercase tracking-wider text-[#64748B] mb-1.5">
          Password
        </label>
        <input
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-5 px-3 h-10 rounded-[9px] border border-[#E2E8F0] bg-[#F8FAFC] text-[14px] text-[#0F172A] outline-none focus:border-[#0F172A] focus:bg-white transition-colors"
          placeholder="••••••••"
        />

        {error && (
          <p className="mb-4 text-[12px] text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-[9px] px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full h-10 rounded-[9px] bg-[#0F172A] text-white text-[13px] font-medium tracking-wider flex items-center justify-center gap-2 hover:bg-[#1E293B] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <LogIn size={15} />
          {busy
            ? (mode === 'signup' ? 'Creating account…' : 'Signing in…')
            : (mode === 'signup' ? 'Create account' : 'Sign in')}
        </button>

        <button
          type="button"
          onClick={toggleMode}
          className="w-full mt-3 text-[12px] font-mono text-[#64748B] hover:text-[#0F172A] transition-colors"
        >
          {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-[#E2E8F0]" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8]">or</span>
          <div className="flex-1 h-px bg-[#E2E8F0]" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="w-full h-10 rounded-[9px] border border-[#E2E8F0] text-[#0F172A] text-[13px] font-medium tracking-wider flex items-center justify-center gap-2 hover:bg-[#F8FAFC] transition-colors"
        >
          Sign in with Google
        </button>
      </form>
    </div>
  )
}
