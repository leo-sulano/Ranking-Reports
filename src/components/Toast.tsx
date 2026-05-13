import { useEffect } from 'react'
import type { ToastItem } from '../types'

interface Props {
  toasts: ToastItem[]
  onRemove: (id: string) => void
}

function ToastEl({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onRemove(toast.id), 4000)
    return () => clearTimeout(t)
  }, [toast.id, onRemove])

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-3 bg-[#0D1421] border rounded-md text-[13px] text-[#E2E8F0] shadow-[0_8px_24px_rgba(0,0,0,0.4)] max-w-[340px] animate-[toastIn_0.25s_ease] ${
        toast.type === 'success' ? 'border-l-[3px] border-l-[#10B981] border-[#1C2B3A]' : 'border-l-[3px] border-l-[#F43F5E] border-[#1C2B3A]'
      }`}
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
