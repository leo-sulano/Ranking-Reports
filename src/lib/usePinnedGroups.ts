import { useCallback, useState } from 'react'

// Ordered list of pinned column-group keys for one table, persisted in
// localStorage per tableKey so each table remembers the user's pins.
// Order matters: groups freeze left-to-right in the order they were pinned.
export function usePinnedGroups(tableKey: string): [string[], (key: string) => void] {
  const storageKey = `rr_pins_${tableKey}`
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  })

  const toggle = useCallback((key: string) => {
    setPinned((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [storageKey])

  return [pinned, toggle]
}
