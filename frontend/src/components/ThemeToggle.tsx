import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { btnBase, btnCompact } from '../lib/classes'

interface ThemeToggleProps {
  className?: string
  iconOnly?: boolean
}

export function ThemeToggle({ className, iconOnly = false }: ThemeToggleProps) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <button
      type="button"
      className={`${btnBase} ${btnCompact}${className ? ` ${className}` : ''}`}
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? (
        <>
          <Sun className="size-4" aria-hidden />
          {!iconOnly && 'Light'}
        </>
      ) : (
        <>
          <Moon className="size-4" aria-hidden />
          {!iconOnly && 'Dark'}
        </>
      )}
    </button>
  )
}
