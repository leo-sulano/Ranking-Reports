import { LogOut } from 'lucide-react'
import { REQUIRE_AUTH, signOut } from '../lib/auth'

interface Props {
  brandName: string
  domain: string
}

export function Topbar({ brandName, domain }: Props) {
  return (
    <header className="h-16 min-h-[64px] shrink-0 flex items-center gap-4 px-7 bg-white border-b border-[#E2E8F0]">
      <div className="flex items-baseline gap-3 flex-1 min-w-0">
        <span className="font-display text-[26px] tracking-wider text-[#0F172A] whitespace-nowrap">
          {brandName}
        </span>
        {domain && (
          <span className="text-[12px] font-mono text-[#64748B] truncate">{domain}</span>
        )}
      </div>

      {/* Sign-out only appears once login is enabled (VITE_REQUIRE_AUTH=true). */}
      {REQUIRE_AUTH && (
        <button
          type="button"
          onClick={() => { void signOut() }}
          title="Sign out"
          className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-[9px] border border-[#E2E8F0] text-[12px] font-mono text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1] transition-colors"
        >
          <LogOut size={14} />
          Sign out
        </button>
      )}
    </header>
  )
}
