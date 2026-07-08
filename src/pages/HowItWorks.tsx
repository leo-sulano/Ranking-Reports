const STEPS: Array<{ title: string; desc: string }> = [
  {
    title: 'Upload your data',
    desc: 'Click "Import Data," pick a category, and drop in your ranking export (.xlsx/.xls/.csv).',
  },
  {
    title: 'Pick a brand',
    desc: 'Select a brand from the sidebar to see its full ranking table; until then, the Home page shows an overview of all brands.',
  },
  {
    title: 'Read the table',
    desc: 'Each row is a keyword: current position, day-over-day change (▲/▼), and "NR" when it isn\'t ranking.',
  },
  {
    title: 'Filter what you see',
    desc: 'Narrow the table by country, domain, or keyword using the filters above it.',
  },
  {
    title: 'Track over time',
    desc: 'Upload new reports as they come in; each becomes a dated snapshot so you can compare rankings across dates.',
  },
]

export function HowItWorks() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto px-7 py-10">
      <div className="max-w-2xl mx-auto w-full">
        <h1 className="font-display text-[28px] tracking-wider text-[#0A0A0A] mb-2">
          How It Works
        </h1>
        <p className="text-[14px] text-[#6B6B65] mb-8 leading-relaxed">
          A quick guide to using the dashboard, from uploading your first report to reading the results.
        </p>

        <div className="flex flex-col gap-4">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="flex gap-4 items-start bg-white border border-[#E5E4DF] rounded-[14px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]"
            >
              <div className="w-8 h-8 shrink-0 rounded-full bg-[#0A0A0A] text-white font-display text-[13px] flex items-center justify-center">
                {i + 1}
              </div>
              <div>
                <h2 className="font-display text-[15px] tracking-wide text-[#0A0A0A] mb-1">
                  {step.title}
                </h2>
                <p className="text-[13px] text-[#6B6B65] leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
