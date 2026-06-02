import { useState, type FormEvent } from 'react'
import { Lock, LogIn } from 'lucide-react'
import { signIn } from '../lib/auth'

/**
 * Login screen shown by AuthGate when VITE_REQUIRE_AUTH=true and no session
 * exists. On success, AuthGate's auth listener swaps this out for the app.
 */
export function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      // No navigation needed — the onAuthChange listener in AuthGate re-renders.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#F8FAFC] relative px-4">
      {/* Background grid, mirrors the main app */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(#E2E8F0 1px, transparent 1px), linear-gradient(90deg, #E2E8F0 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-[380px] max-w-full bg-white border border-[#E2E8F0] rounded-[14px] p-7 shadow-[0_40px_80px_rgba(15,23,42,0.18)]"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-[#0F172A] text-white">
            <Lock size={15} />
          </span>
          <span className="font-display text-[20px] tracking-wider text-[#0F172A]">
            Ranking Reports
          </span>
        </div>
        <p className="text-[12px] font-mono text-[#64748B] mb-6">
          Sign in to access the dashboard
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
          autoComplete="current-password"
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
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
