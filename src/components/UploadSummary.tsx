import type { RankingRecord, Snapshot } from '../types'
import { DOMAIN_TO_BRAND } from '../lib/brands'

export interface UploadSummaryData {
  displayDate: string
  records: RankingRecord[]
  allSnapshots: Snapshot[]   // post-upload state; used for "total in DB"
}

interface Props {
  data: UploadSummaryData
  onClose: () => void
}

function aggregate(records: RankingRecord[]) {
  const byBrand:   Record<string, number> = {}
  const byDomain:  Record<string, number> = {}
  const byCountry: Record<string, number> = {}
  let unknown = 0
  for (const r of records) {
    const dk = r.domain.toLowerCase()
    const brand = DOMAIN_TO_BRAND[dk]
    byDomain[dk] = (byDomain[dk] ?? 0) + 1
    if (r.country) byCountry[r.country] = (byCountry[r.country] ?? 0) + 1
    if (brand) {
      byBrand[brand] = (byBrand[brand] ?? 0) + 1
    } else {
      unknown++
    }
  }
  return {
    byBrand:   Object.entries(byBrand).sort((a, b) => b[1] - a[1]),
    byDomain:  Object.entries(byDomain).sort((a, b) => b[1] - a[1]),
    byCountry: Object.entries(byCountry).sort((a, b) => b[1] - a[1]),
    unknown,
  }
}

export function UploadSummary({ data, onClose }: Props) {
  const { displayDate, records, allSnapshots } = data
  const { byBrand, byDomain, byCountry, unknown } = aggregate(records)

  const totalRecordsInDb   = allSnapshots.reduce((sum, s) => sum + s.records.length, 0)
  const totalSnapshotsInDb = allSnapshots.length

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-md z-50 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white border border-[#CBD5E1] rounded-[14px] w-[560px] max-w-[95vw] max-h-[85vh] overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.6)] animate-[modalIn_0.2s_ease] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E2E8F0] shrink-0">
          <div>
            <h2 className="font-display text-[18px] tracking-wider text-[#0F172A]">
              Import Summary
            </h2>
            <p className="text-[11px] text-[#64748B] mt-0.5">
              {displayDate} · {records.length} record{records.length !== 1 ? 's' : ''} uploaded
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center bg-[#F8FAFC] border border-[#E2E8F0] rounded-md text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1] transition-all text-[16px]"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto">

          {/* Totals row */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            <Stat label="Uploaded"       value={records.length}   accent="#10B981" />
            <Stat label="Brands matched" value={byBrand.length}   accent="#0F172A" />
            <Stat label="Domains"        value={byDomain.length}  accent="#38BDF8" />
            <Stat label="Countries"      value={byCountry.length} accent="#A78BFA" />
          </div>

          {unknown > 0 && (
            <div className="mb-4 px-3 py-2 bg-[rgba(244,63,94,0.08)] border border-[rgba(244,63,94,0.3)] rounded-md text-[12px] text-[#F43F5E]">
              ⚠ {unknown} record{unknown !== 1 ? 's' : ''} had a domain not in CONFIG and were ignored.
            </div>
          )}

          {/* Per-brand */}
          <Section title="Per brand">
            {byBrand.length === 0 ? (
              <p className="text-[11px] text-[#64748B] py-2">No matching brands.</p>
            ) : (
              <Table rows={byBrand} />
            )}
          </Section>

          {/* Per-domain */}
          <Section title="Per website">
            {byDomain.length === 0 ? (
              <p className="text-[11px] text-[#64748B] py-2">No domains.</p>
            ) : (
              <Table rows={byDomain} mono />
            )}
          </Section>

          {/* Per-country */}
          <Section title="Per country">
            {byCountry.length === 0 ? (
              <p className="text-[11px] text-[#64748B] py-2">No countries.</p>
            ) : (
              <Table rows={byCountry} mono />
            )}
          </Section>

          {/* DB totals */}
          <Section title="Database after upload">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total snapshots" value={totalSnapshotsInDb} accent="#94A3B8" />
              <Stat label="Total records"   value={totalRecordsInDb}  accent="#94A3B8" />
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#E2E8F0] shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#0F172A] text-white rounded-md text-[12px] font-bold hover:bg-[#1E293B] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-md px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.1em] text-[#64748B] mb-0.5">{label}</div>
      <div className="text-[20px] font-bold" style={{ color: accent }}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B] mb-1.5">
        {title}
      </div>
      {children}
    </div>
  )
}

function Table({ rows, mono = false }: { rows: [string, number][]; mono?: boolean }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-md overflow-hidden">
      {rows.map(([key, count], i) => (
        <div
          key={key}
          className={`flex items-center justify-between px-3 py-1.5 text-[12px] ${i > 0 ? 'border-t border-[#E2E8F0]' : ''}`}
        >
          <span className={`${mono ? 'font-mono' : ''} text-[#0F172A] truncate mr-3`}>{key}</span>
          <span className="text-[#64748B] font-mono shrink-0">{count}</span>
        </div>
      ))}
    </div>
  )
}
