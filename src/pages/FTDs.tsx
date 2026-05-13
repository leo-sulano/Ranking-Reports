export function FTDs() {
  return <PlaceholderPage icon="💰" label="FTDs" desc="Track first-time depositor data and conversion metrics across brands." />
}

function PlaceholderPage({ icon, label, desc }: { icon: string; label: string; desc: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full text-center gap-4 px-7 pb-7">
      <div className="text-5xl opacity-30">{icon}</div>
      <div className="font-display text-[28px] tracking-wider text-[#94A3B8]">{label}</div>
      <p className="text-[14px] text-[#64748B] max-w-sm leading-relaxed">{desc}</p>
      <span className="px-3 py-1 rounded-full border border-[#1C2B3A] text-[11px] font-mono text-[#64748B] bg-[#0D1421]">
        Coming Soon
      </span>
    </div>
  )
}
