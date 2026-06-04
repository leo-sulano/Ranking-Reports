import { LogOut } from 'lucide-react'
import { REQUIRE_AUTH, signOut } from '../lib/auth'

interface Props {
  brandName: string
  domain: string
}

export function Topbar({ brandName, domain }: Props) {
  return (
    <header className="h-16 min-h-[64px] shrink-0 flex items-center gap-4 px-7 bg-[#13121F] border-b border-[rgba(255,255,255,0.06)]">
      <div className="flex items-baseline gap-3 flex-1 min-w-0">
        <span className="font-display text-[26px] tracking-wider text-white whitespace-nowrap">
          {brandName}
        </span>
        {domain && (
          <span className="text-[12px] font-mono text-white/35 truncate">{domain}</span>
        )}
      </div>

      {REQUIRE_AUTH && (
        <button
          type="button"
          onClick={() => { void signOut() }}
          title="Sign out"
          className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-[9px] border border-[rgba(255,255,255,0.1)] text-[12px] font-mono text-white/40 hover:text-white hover:border-[rgba(255,255,255,0.2)] transition-colors"
        >
          <LogOut size={14} />
          Sign out
        </button>
      )}
    </header>
  )
}
