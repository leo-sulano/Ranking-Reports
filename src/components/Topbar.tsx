interface Props {
  brandName: string
  domain: string
  uploadDate: string | null
}

export function Topbar({ brandName, domain, uploadDate }: Props) {
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
      {uploadDate && (
        <span className="text-[11px] font-mono text-[#475569] px-2.5 py-1 bg-[#F1F5F9] border border-[#E2E8F0] rounded-md whitespace-nowrap">
          Data: {uploadDate}
        </span>
      )}
    </header>
  )
}
