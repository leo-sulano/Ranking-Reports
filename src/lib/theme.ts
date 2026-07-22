export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'rr_theme'

// Saved choice wins; otherwise follow the OS preference.
export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function saveTheme(theme: Theme) {
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* ignore */ }
}
