import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Clapperboard, FolderOpen, Home, LogOut, Shield, User } from 'lucide-react'
import { surveyApi } from '../api/endpoints'
import type { TutorialVideo } from '../api/types'
import { BugReportFab } from './BugReportFab'
import { ThemeToggle } from './ThemeToggle'
import { TutorialSliderModal } from './TutorialSliderModal'
import { useAuth } from '../context/AuthContext'
import { btnBase, btnCompact } from '../lib/classes'

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const isHome = location.pathname === '/studio'
  const isProjects = location.pathname.startsWith('/projects')
  const isProfile = location.pathname === '/profile'
  const { user, logout } = useAuth()
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [tutorialVideos, setTutorialVideos] = useState<TutorialVideo[]>([])
  const [tutorialLoading, setTutorialLoading] = useState(false)
  const [tutorialError, setTutorialError] = useState<string | null>(null)

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const openTutorials = async () => {
    setTutorialLoading(true)
    setTutorialError(null)
    try {
      const status = await surveyApi.status()
      if (status.videos.length === 0) {
        setTutorialError('No tutorial videos available yet.')
        setTutorialVideos([])
        setTutorialOpen(false)
        return
      }
      setTutorialVideos(status.videos)
      setTutorialOpen(true)
    } catch (err) {
      setTutorialError(err instanceof Error ? err.message : 'Failed to load tutorials')
      setTutorialOpen(false)
    } finally {
      setTutorialLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="sticky top-0 z-10 flex justify-between items-center gap-4 px-6 py-3.5 bg-surface-elevated/95 backdrop-blur-sm border-b border-border shadow-sm max-md:flex-col max-md:items-start">
        <Link to="/studio" className="flex items-center gap-3 group">
          <img
            src="/logo.svg"
            alt="LabCD"
            className="w-11 h-11 transition-transform duration-200 group-hover:scale-105"
          />
          <div>
            <h1 className="m-0 text-lg font-semibold tracking-tight text-foreground">
              LabCD
            </h1>
            <p className="m-0 text-muted text-xs">
              AI-Powered Control System Design Studio
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-3 flex-wrap max-md:w-full max-md:justify-between">
          {user && (
            <nav className="flex gap-1">
              <Link
                to="/studio"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isHome
                    ? 'bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
                    : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                <Home className="size-4" aria-hidden />
                Home
              </Link>
              <Link
                to="/projects"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isProjects
                    ? 'bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
                    : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                <FolderOpen className="size-4" aria-hidden />
                Projects
              </Link>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-text transition-colors hover:text-foreground hover:bg-surface-hover disabled:opacity-60"
                disabled={tutorialLoading}
                onClick={() => void openTutorials()}
                title="Watch video tutorials"
              >
                <Clapperboard className="size-4" aria-hidden />
                {tutorialLoading ? 'Loading…' : 'Tutorials'}
              </button>
              {user.is_admin && (
                <Link
                  to="/admin"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-text transition-colors hover:text-foreground hover:bg-surface-hover"
                >
                  <Shield className="size-4" aria-hidden />
                  Admin
                </Link>
              )}
              <Link
                to="/profile"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isProfile
                    ? 'bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
                    : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                <User className="size-4" aria-hidden />
                Profile
              </Link>
            </nav>
          )}
          <div className="flex items-center gap-2">
            {user && (
              <>
                <Link
                  to="/profile"
                  className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-text transition-colors hover:text-foreground hover:bg-surface-hover max-md:hidden"
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
                  <span>{user.display_name?.trim() || user.email}</span>
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
        </div>
      </header>
      <main className="flex-1 p-6 max-w-[1200px] w-full mx-auto">
        {tutorialError && (
          <p className="mb-4 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-text">
            {tutorialError}
          </p>
        )}
        <Outlet />
      </main>
      <footer className="text-center py-4 px-6 text-muted text-xs border-t border-border">
        LabCD Control Design Studio
      </footer>
      {tutorialOpen && (
        <TutorialSliderModal
          videos={tutorialVideos}
          mode="browse"
          onClosed={() => {
            setTutorialOpen(false)
            setTutorialError(null)
          }}
        />
      )}
      {user && <BugReportFab />}
    </div>
  )
}
