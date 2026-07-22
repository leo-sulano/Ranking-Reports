import { LogIn, LogOut, Moon, Sun } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { signOut } from '../lib/auth'
import type { Theme } from '../lib/theme'

interface Props {
  brandName: string
  domain: string
  session: Session | null
  onSignIn: () => void
  onMenuToggle?: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function Topbar({ brandName, domain, session, onSignIn, onMenuToggle, theme, onToggleTheme }: Props) {
  return (
    <header className="h-16 min-h-[64px] shrink-0 flex flex-col bg-[var(--surface)] border-b border-[var(--border-2)]">
      {/* Brand accent strip — navy / blue / light-blue */}
      <div className="flex h-[3px] shrink-0">
        <div className="flex-1 bg-[#1e2a6e]" />
        <div className="flex-1 bg-[#1c9fe0]" />
        <div className="flex-1 bg-[#7fd4f5]" />
      </div>
      <div className="flex-1 flex items-center gap-2 sm:gap-4 px-3 sm:px-7">
        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={onMenuToggle}
          className="sm:hidden shrink-0 flex flex-col items-center justify-center gap-[5px] w-8 h-8 rounded-md hover:bg-[var(--hover)] transition-colors"
          aria-label="Open navigation"
        >
          <span className="block w-[18px] h-[2px] bg-[var(--ink-2)] rounded-full" />
          <span className="block w-[18px] h-[2px] bg-[var(--ink-2)] rounded-full" />
          <span className="block w-[18px] h-[2px] bg-[var(--ink-2)] rounded-full" />
        </button>
        <div className="flex items-baseline gap-3 flex-1 min-w-0">
          <span className="font-display text-[18px] sm:text-[26px] tracking-wider text-[var(--navy-text)] whitespace-nowrap">
            {brandName}
          </span>
          {domain && (
            <span className="text-[12px] font-public-sans text-[var(--muted-3)] truncate">{domain}</span>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border-2)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[#7fd4f5] transition-colors"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {session ? (
          <button
            type="button"
            onClick={() => { void signOut() }}
            title="Sign out"
            className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-2)] text-[12px] font-mono text-[var(--muted)] text-glow hover:border-[#7fd4f5] transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            title="Sign in"
            className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-2)] text-[12px] font-mono text-[var(--muted)] hover:text-[var(--ink-2)] hover:border-[var(--muted-3)] transition-colors"
          >
            <LogIn size={14} />
            Sign in
          </button>
        )}
      </div>
    </header>
  )
}
