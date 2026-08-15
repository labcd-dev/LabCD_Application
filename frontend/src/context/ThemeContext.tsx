import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { getThemeOfDay } from '../lib/themeOfDay'

export type ThemeMode = 'light' | 'dark' | 'system' | 'theme_of_day'

const STORAGE_KEY = 'labcd-theme'
const VALID_THEMES = new Set<ThemeMode>(['light', 'dark', 'system', 'theme_of_day'])

interface ThemeContextValue {
  theme: ThemeMode
  resolvedTheme: 'light' | 'dark'
  themeOfDayName: string
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') return getSystemTheme()
  if (theme === 'theme_of_day') return 'dark'
  return theme
}

function applyDayAccent(enabled: boolean) {
  const root = document.documentElement
  if (!enabled) {
    root.style.removeProperty('--app-primary')
    root.style.removeProperty('--app-accent-2')
    root.classList.remove('theme-of-day')
    return
  }
  const day = getThemeOfDay()
  root.classList.add('theme-of-day')
  root.style.setProperty('--app-primary', day.primary)
  root.style.setProperty('--app-accent-2', day.accent2)
}

function applyTheme(theme: ThemeMode, resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  applyDayAccent(theme === 'theme_of_day')
}

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && VALID_THEMES.has(stored as ThemeMode)) return stored as ThemeMode
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme())
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    resolveTheme(readStoredTheme()),
  )
  const [themeOfDayName, setThemeOfDayName] = useState(() => getThemeOfDay().name)

  useEffect(() => {
    const resolved = resolveTheme(theme)
    setResolvedTheme(resolved)
    setThemeOfDayName(getThemeOfDay().name)
    applyTheme(theme, resolved)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const resolved = getSystemTheme()
      setResolvedTheme(resolved)
      applyTheme(theme, resolved)
    }

    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  // Stable identity so UserThemeSync does not re-apply profile theme on every render.
  const setTheme = useCallback((next: ThemeMode) => setThemeState(next), [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (resolveTheme(current) === 'dark' ? 'light' : 'dark'))
  }, [])

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, themeOfDayName, setTheme, toggleTheme }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
