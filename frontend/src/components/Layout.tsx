import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Clapperboard,
  FolderOpen,
  LogOut,
  Menu,
  Plus,
  Shield,
  User,
  X,
} from 'lucide-react'
import { SupportFabs } from './SupportFabs'
import { ThemeToggle } from './ThemeToggle'
import { useAuth } from '../context/AuthContext'
import { btnBase, btnCompact } from '../lib/classes'

function navLinkClass(active: boolean) {
  return `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? 'bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
      : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
  }`
}

function mobileNavLinkClass(active: boolean) {
  return `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
    active
      ? 'bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] text-primary'
      : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
  }`
}

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const isHome = location.pathname === '/studio'
  const isProjects = location.pathname.startsWith('/projects')
  const isTutorials = location.pathname.startsWith('/tutorials')
  const isProfile = location.pathname === '/profile'
  const { user, logout, hasAction } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const handleLogout = () => {
    setMenuOpen(false)
    void logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-3.5 bg-surface-elevated/95 backdrop-blur-sm border-b border-border shadow-sm">
        <Link to="/studio" className="flex min-w-0 items-center gap-2.5 sm:gap-3 group">
          <img
            src="/logo.svg"
            alt="LabCD"
            className="h-9 w-9 shrink-0 transition-transform duration-200 group-hover:scale-105 sm:h-11 sm:w-11"
          />
          <div className="min-w-0">
            <h1 className="m-0 text-base font-semibold tracking-tight text-foreground sm:text-lg">
              LabCD
            </h1>
            <p className="m-0 hidden text-xs text-muted sm:block">
              AI-Powered Control System Design Studio
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {user && (
            <nav className="hidden items-center gap-1 md:flex" aria-label="Studio">
              <Link to="/studio" className={navLinkClass(isHome)}>
                <Plus className="size-4" aria-hidden />
                New Project
              </Link>
              <Link to="/projects" className={navLinkClass(isProjects)}>
                <FolderOpen className="size-4" aria-hidden />
                Projects
              </Link>
              <Link to="/tutorials" className={navLinkClass(isTutorials)}>
                <Clapperboard className="size-4" aria-hidden />
                Tutorials
              </Link>
              {hasAction('admin:access') && (
                <Link to="/admin" className={navLinkClass(false)}>
                  <Shield className="size-4" aria-hidden />
                  Admin
                </Link>
              )}
              <Link to="/profile" className={navLinkClass(isProfile)}>
                <User className="size-4" aria-hidden />
                Profile
              </Link>
            </nav>
          )}

          <div className="hidden items-center gap-2 md:flex">
            {user && (
              <>
                <Link
                  to="/profile"
                  className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-text transition-colors hover:text-foreground hover:bg-surface-hover"
                  title="Profile"
                >
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt=""
                      className="size-7 rounded-full border border-border object-cover"
                    />
                  ) : (
                    <span className="flex size-7 items-center justify-center rounded-full border border-border bg-surface-muted text-xs font-semibold text-primary">
                      {(user.display_name?.trim() || user.email).slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="max-w-[10rem] truncate">
                    {user.display_name?.trim() || user.email}
                  </span>
                </Link>
                <button
                  type="button"
                  className={`${btnBase} ${btnCompact}`}
                  onClick={handleLogout}
                  title="Sign out"
                >
                  <LogOut className="size-3.5" aria-hidden />
                  Sign out
                </button>
              </>
            )}
            <ThemeToggle />
          </div>

          <ThemeToggle className="md:hidden" iconOnly />

          {user && (
            <button
              type="button"
              className={`${btnBase} ${btnCompact} md:hidden`}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          )}
        </div>
      </header>

      {menuOpen && user && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] md:hidden"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed inset-x-0 top-[57px] z-50 border-b border-border bg-surface-elevated p-3 shadow-lg sm:top-[65px] md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Studio mobile">
              <Link
                to="/studio"
                className={mobileNavLinkClass(isHome)}
                onClick={() => setMenuOpen(false)}
              >
                <Plus className="size-4 shrink-0" aria-hidden />
                New Project
              </Link>
              <Link
                to="/projects"
                className={mobileNavLinkClass(isProjects)}
                onClick={() => setMenuOpen(false)}
              >
                <FolderOpen className="size-4 shrink-0" aria-hidden />
                Projects
              </Link>
              <Link
                to="/tutorials"
                className={mobileNavLinkClass(isTutorials)}
                onClick={() => setMenuOpen(false)}
              >
                <Clapperboard className="size-4 shrink-0" aria-hidden />
                Tutorials
              </Link>
              {hasAction('admin:access') && (
                <Link
                  to="/admin"
                  className={mobileNavLinkClass(false)}
                  onClick={() => setMenuOpen(false)}
                >
                  <Shield className="size-4 shrink-0" aria-hidden />
                  Admin
                </Link>
              )}
              <Link
                to="/profile"
                className={mobileNavLinkClass(isProfile)}
                onClick={() => setMenuOpen(false)}
              >
                <User className="size-4 shrink-0" aria-hidden />
                Profile
              </Link>
            </nav>

            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <Link
                to="/profile"
                className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-text transition-colors hover:bg-surface-hover hover:text-foreground"
                onClick={() => setMenuOpen(false)}
              >
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="size-8 rounded-full border border-border object-cover"
                  />
                ) : (
                  <span className="flex size-8 items-center justify-center rounded-full border border-border bg-surface-muted text-xs font-semibold text-primary">
                    {(user.display_name?.trim() || user.email).slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 truncate">
                  {user.display_name?.trim() || user.email}
                </span>
              </Link>
              <button
                type="button"
                className={`${btnBase} ${btnCompact} w-full`}
                onClick={handleLogout}
              >
                <LogOut className="size-3.5" aria-hidden />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <Outlet />
      </main>
      <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted sm:px-6">
        LabCD Control Design Studio
      </footer>
      {user && <SupportFabs />}
    </div>
  )
}
