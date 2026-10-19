import { useEffect } from 'react'
import { useTheme } from '../../context/ThemeContext'

/**
 * Auth pages follow the OS light/dark preference automatically.
 * ThemeProvider updates live when prefers-color-scheme changes in "system" mode.
 */
export function AuthThemeAuto() {
  const { setTheme } = useTheme()

  useEffect(() => {
    setTheme('system')
  }, [setTheme])

  return null
}
