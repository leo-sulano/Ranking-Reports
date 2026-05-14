import { useEffect } from 'react'
import type { ToastItem } from '../types'

interface Props {
  toasts: ToastItem[]
  onRemove: (id: string) => void
}

function ToastEl({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onRemove(toast.id), toast.type === 'warning' ? 6000 : 4000)
    return () => clearTimeout(t)
  }, [toast.id, toast.type, onRemove])

  const accent =
    toast.type === 'success' ? '#10B981'
    : toast.type === 'warning' ? '#F59E0B'
    : '#F43F5E'

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-3 bg-white border border-[#E2E8F0] rounded-md text-[13px] text-[#0F172A] shadow-[0_8px_24px_rgba(15,23,42,0.12)] max-w-[340px] animate-[toastIn_0.25s_ease]"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {toast.message}
    </div>
  )
}

export function ToastContainer({ toasts, onRemove }: Props) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastEl key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  )
}
