import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Inline-editable text cell.
 *
 *   - Click → input + auto-select.
 *   - Enter / blur → commit via onSave().
 *   - Esc → revert + exit edit mode.
 *   - While saving, the input is disabled.
 *
 * Pass an optional renderDisplay() to render the resting state (e.g. show
 * only the URL hostname for AFF cells while keeping the underlying value
 * editable in full).
 */
export function EditableCell({
  value,
  onSave,
  renderDisplay,
  placeholder = '–',
  className   = '',
  inputClassName = '',
  title       = 'Click to edit',
  disabled    = false,
  dimWhenDisabled = true,
}: {
  value: string
  onSave: (next: string) => Promise<void> | void
  renderDisplay?: (value: string) => ReactNode
  placeholder?: string
  className?: string
  inputClassName?: string
  title?: string
  disabled?: boolean
  dimWhenDisabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)
  const [saving,  setSaving]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch {
      // The caller surfaces the failure via toast; just stay in edit mode
      // so the user can retry or escape.
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => { setDraft(value); setEditing(false) }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        disabled={saving}
        className={`w-full bg-[var(--mx-edit-bg)] border border-[var(--mx-ink-strong)] rounded-[3px] px-1 py-0.5 text-[11px] text-[var(--mx-ink-strong)] outline-none ${inputClassName}`}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={title}
      disabled={disabled}
      className={`w-full text-center rounded-[2px] transition-colors cursor-text hover:bg-[var(--mx-hover)] ${dimWhenDisabled ? 'disabled:opacity-40' : ''} disabled:cursor-not-allowed disabled:hover:bg-transparent ${className}`}
    >
      {value
        ? (renderDisplay ? renderDisplay(value) : value)
        : <span className="opacity-30">{placeholder}</span>}
    </button>
  )
}
