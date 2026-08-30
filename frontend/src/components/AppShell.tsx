import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Clapperboard,
  LogOut,
  Menu,
  // Moon,
  PanelLeftClose,
  Plus,
  Shield,
  // Sun,
} from 'lucide-react'
import { SupportFabs } from './SupportFabs'
import { useAuth } from '../context/AuthContext'
// import { useTheme } from '../context/ThemeContext'
import { btnBase, btnCompact, btnPrimary } from '../lib/classes'

const SIDEBAR_EXPANDED_WIDTH = 260
const SIDEBAR_COLLAPSED_WIDTH = 64

function userInitials(user: { display_name: string | null; email: string }): string {
  const source = user.display_name?.trim() || user.email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function sectionLabel(pathname: string): string {
  if (pathname === '/design') return 'chat'
  if (pathname.startsWith('/case-studies')) return 'case studies'
  if (pathname.startsWith('/projects')) return 'Projects'
  if (
    pathname === '/studio' ||
    pathname === '/recommender' ||
    pathname === '/trimmer' ||
    pathname === '/silo' ||
    pathname === '/mulo'
  ) {
    return 'studio'
  }
  if (pathname.startsWith('/tutorials')) return 'tutorials'
  if (pathname === '/profile') return 'profile'
  return 'app'
}

function RailTip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-[52px] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface-muted px-2.5 py-1 text-[11.5px] font-medium text-foreground opacity-0 transition-opacity duration-125 group-hover:opacity-100">
      {label}
    </span>
  )
}

function RailItem({
  to,
  label,
  active,
  expanded,
  children,
}: {
  to: string
  label: string
  active?: boolean
  expanded: boolean
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      className={`group relative flex items-center rounded-[10px] no-underline transition-[background,color] duration-150 ${
        expanded ? 'gap-3 px-3 py-2.5' : 'size-10 place-items-center justify-center'
      } ${
        active
          ? 'bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
          : 'text-muted hover:bg-surface-hover hover:text-muted-text'
      }`}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      {active && (
        <span
          className={`absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-sm bg-primary ${
            expanded ? 'left-0' : '-left-3'
          }`}
          aria-hidden
        />
      )}
      <span className="grid size-[19px] shrink-0 place-items-center">{children}</span>
      {expanded ? (
        <span className="truncate text-sm font-medium">{label}</span>
      ) : (
        <RailTip label={label} />
      )}
    </Link>
  )
}

interface AppShellProps {
  children: ReactNode
  topbarActions?: ReactNode
}

export function AppShell({ children, topbarActions }: AppShellProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, hasAction } = useAuth()
  // const { resolvedTheme, toggleTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  if (!user) return null

  const isDesign = location.pathname === '/design'
  const isCaseStudies = location.pathname.startsWith('/case-studies')
  const isStudio =
    location.pathname === '/studio' ||
    location.pathname === '/recommender' ||
    location.pathname === '/trimmer' ||
    location.pathname === '/silo' ||
    location.pathname === '/mulo'
  const isProjects = location.pathname.startsWith('/projects')
  const isTutorials = location.pathname.startsWith('/tutorials')
  const isProfile = location.pathname === '/profile'
  const initials = userInitials(user)
  const label = sectionLabel(location.pathname)
  const sidebarWidth = sidebarOpen ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH
  const displayName = user.display_name?.trim() || user.email

  const handleLogout = () => {
    void logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-surface font-sans text-[14px] leading-[1.55] text-foreground antialiased">
      <aside
        className={`fixed inset-y-0 left-0 z-[200] flex flex-col border-r border-border bg-surface-elevated transition-[width] duration-200 ${
          sidebarOpen ? 'px-3 py-3.5' : 'items-center py-3.5 pb-4'
        }`}
        style={{ width: sidebarWidth }}
      >
        <div
          className={`mb-[22px] flex shrink-0 items-center ${
            sidebarOpen ? 'justify-between gap-2 px-1' : 'justify-center'
          }`}
        >
          <Link
            to="/design"
            className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-primary to-accent-2 no-underline shadow-[0_0_0_1px_color-mix(in_srgb,var(--app-foreground)_6%,transparent),0_4px_14px_color-mix(in_srgb,var(--app-primary)_28%,transparent)]"
            aria-label="LabCD"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden>
              <path
                d="M2 18h6V6h14"
                stroke="white"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          {sidebarOpen && (
            <button
              type="button"
              className={`${btnBase} ${btnCompact}`}
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
              title="Close sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>

        <nav
          className={`flex flex-1 flex-col gap-1.5 ${sidebarOpen ? '' : 'items-center'}`}
          aria-label="App"
        >
          <RailItem to="/design" label="Chat" active={isDesign} expanded={sidebarOpen}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[19px]"
              strokeWidth="1.6"
              aria-hidden
            >
              <path d="M4 5h16v11H8l-4 4V5Z" />
            </svg>
          </RailItem>
          <RailItem
            to="/case-studies"
            label="Case studies"
            active={isCaseStudies}
            expanded={sidebarOpen}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[19px]"
              strokeWidth="1.6"
              aria-hidden
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </RailItem>
          <RailItem to="/projects" label="Projects" active={isProjects} expanded={sidebarOpen}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[19px]"
              strokeWidth="1.6"
              aria-hidden
            >
              <path d="M4 20V8.5L12 4l8 4.5V20" />
              <path d="M4 11.5 12 16l8-4.5" />
              <path d="M12 16v4" />
            </svg>
          </RailItem>
          <RailItem to="/studio" label="Studio" active={isStudio} expanded={sidebarOpen}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[19px]"
              strokeWidth="1.6"
              aria-hidden
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
              <circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none" />
              <circle cx="16" cy="12" r="1.8" fill="currentColor" stroke="none" />
              <circle cx="11" cy="18" r="1.8" fill="currentColor" stroke="none" />
            </svg>
          </RailItem>
          <RailItem
            to="/tutorials"
            label="Tutorials"
            active={isTutorials}
            expanded={sidebarOpen}
          >
            <Clapperboard className="size-[19px]" strokeWidth={1.6} aria-hidden />
          </RailItem>
          {hasAction('admin:access') && (
            <RailItem to="/admin" label="Admin" expanded={sidebarOpen}>
              <Shield className="size-[19px]" strokeWidth={1.6} aria-hidden />
            </RailItem>
          )}
        </nav>

        <div
          className={`mt-auto flex flex-col gap-2.5 border-t border-border pt-3 ${
            sidebarOpen ? 'px-1' : 'items-center'
          }`}
        >
          <div className={`flex gap-2 ${sidebarOpen ? 'flex-col' : 'flex-col items-center'}`}>
            {/* <button
              type="button"
              className={`${btnBase} ${btnCompact} ${sidebarOpen ? 'w-full justify-start' : 'size-10 p-0'}`}
              title={resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
              aria-label={
                resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
              }
              onClick={toggleTheme}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <Moon className="size-3.5 shrink-0" aria-hidden />
              )}
              {sidebarOpen && 'Theme'}
            </button> */}
            <button
              type="button"
              className={`${btnBase} ${btnCompact} ${sidebarOpen ? 'w-full justify-start' : 'size-10 p-0'}`}
              onClick={handleLogout}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-3.5 shrink-0" aria-hidden />
              {sidebarOpen && 'Sign out'}
            </button>
          </div>

          <Link
            to="/profile"
            className={`group relative flex items-center overflow-hidden rounded-[9px] border no-underline transition-colors ${
              sidebarOpen ? 'gap-3 px-2.5 py-2' : 'size-8 justify-center'
            } ${
              isProfile
                ? 'border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
                : 'border-border bg-surface-muted text-muted-text hover:bg-surface-hover'
            }`}
            aria-label="Profile & stats"
            aria-current={isProfile ? 'page' : undefined}
            title={displayName}
          >
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-[7px] text-[11px] font-semibold">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="size-full object-cover" />
              ) : (
                <span>{initials}</span>
              )}
            </span>
            {sidebarOpen ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {displayName}
                </span>
                <span className="block text-[11px] text-muted">Profile & stats</span>
              </span>
            ) : (
              <span className="pointer-events-none absolute bottom-0 left-[52px] z-50 whitespace-nowrap rounded-md border border-border bg-surface-muted px-2.5 py-1 text-[11.5px] font-medium text-foreground opacity-0 transition-opacity duration-125 group-hover:opacity-100">
                Profile & stats
              </span>
            )}
          </Link>
        </div>
      </aside>

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col transition-[margin] duration-200"
        style={{ marginLeft: sidebarWidth }}
      >
        <header className="sticky top-0 z-[100] flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface/90 px-6 backdrop-blur-[10px]">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                type="button"
                className={btnBase}
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                title="Open sidebar"
              >
                <Menu className="size-4" />
              </button>
            )}
            <div className="flex items-center gap-2 text-[13px] font-semibold text-muted-text">
              <b className="font-semibold text-foreground">LabCD</b>
              <span className="text-muted">· {label}</span>
            </div>
            {isDesign && (
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                onClick={() =>
                  navigate('/design', { replace: true, state: { newChat: Date.now() } })
                }
              >
                <Plus className="size-3.5" aria-hidden />
                New chat
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isCaseStudies && (
              <Link to="/design" className={`${btnPrimary} ${btnCompact} no-underline`}>
                <Plus className="size-3.5" aria-hidden />
                New system
              </Link>
            )}
            {topbarActions}
          </div>
        </header>

        <main
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${
            isProfile || isDesign ? '' : 'p-4 sm:p-6 lg:p-8'
          }`}
        >
          {isProfile || isDesign ? (
            children
          ) : (
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          )}
        </main>
      </div>

      <SupportFabs />
    </div>
  )
}
