interface Props {
  brandName: string
  domain: string
  uploadDate: string | null
}

export function Topbar({ brandName, domain, uploadDate }: Props) {
  return (
    <header className="h-16 min-h-[64px] shrink-0 flex items-center gap-4 px-7 bg-[#0D1421] border-b border-[#1C2B3A]">
      <div className="flex items-baseline gap-3 flex-1 min-w-0">
        <span className="font-display text-[26px] tracking-wider text-[#E2E8F0] whitespace-nowrap">
          {brandName}
        </span>
        {domain && (
          <span className="text-[12px] font-mono text-[#64748B] truncate">{domain}</span>
        )}
      </div>
      {uploadDate && (
        <span className="text-[11px] font-mono text-[#64748B] px-2.5 py-1 bg-[#111928] border border-[#1C2B3A] rounded-md whitespace-nowrap">
          Data: {uploadDate}
        </span>
      )}
    </header>
  )
}
