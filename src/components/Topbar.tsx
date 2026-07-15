import { LogOut } from 'lucide-react'
import { REQUIRE_AUTH, signOut } from '../lib/auth'

interface Props {
  brandName: string
  domain: string
  onMenuToggle?: () => void
}

export function Topbar({ brandName, domain, onMenuToggle }: Props) {
  return (
    <header className="h-16 min-h-[64px] shrink-0 flex flex-col bg-white border-b border-[#E5E4DF]">
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
          className="sm:hidden shrink-0 flex flex-col items-center justify-center gap-[5px] w-8 h-8 rounded-md hover:bg-[#F7F7F5] transition-colors"
          aria-label="Open navigation"
        >
          <span className="block w-[18px] h-[2px] bg-[#0A0A0A] rounded-full" />
          <span className="block w-[18px] h-[2px] bg-[#0A0A0A] rounded-full" />
          <span className="block w-[18px] h-[2px] bg-[#0A0A0A] rounded-full" />
        </button>
        <div className="flex items-baseline gap-3 flex-1 min-w-0">
          <span className="font-display text-[18px] sm:text-[26px] tracking-wider text-[#1e2a6e] whitespace-nowrap">
            {brandName}
          </span>
          {domain && (
            <span className="text-[12px] font-public-sans text-[#ABABAA] truncate">{domain}</span>
          )}
        </div>

        {REQUIRE_AUTH && (
          <button
            type="button"
            onClick={() => { void signOut() }}
            title="Sign out"
            className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#E5E4DF] text-[12px] font-mono text-[#8A8A85] text-glow hover:border-[#7fd4f5] transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        )}
      </div>
    </header>
  )
}
