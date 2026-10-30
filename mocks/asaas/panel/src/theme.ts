/**
 * The theme. Light by default — it is the one of Asaas, and it is the look this
 * screen exists to have.
 *
 * We do NOT follow `prefers-color-scheme`: on a machine configured in dark mode
 * (most of the developers'), the panel would never show up as it was designed.
 * The dark one stays behind an explicit choice, kept in the localStorage.
 *
 * The `data-theme` is applied to the <html> BEFORE the first paint (see the
 * inline script in index.html), otherwise whoever chose dark sees a white
 * flash on every reload.
 */
import { useEffect, useState } from 'preact/hooks'

export type Theme = 'light' | 'dark'
const KEY = 'asaas-mock:theme'

export function readTheme(): Theme {
  return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(KEY, theme)
  }, [theme])

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const
}
