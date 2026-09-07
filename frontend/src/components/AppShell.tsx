import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Clapperboard,
  HelpCircle,
  Layers,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  Plus,
  Shield,
  Sun,
} from 'lucide-react'
import { SupportFabs } from './SupportFabs'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

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
  if (pathname.startsWith('/case-studies') || pathname.startsWith('/projects'))
    return 'Case Studies & Projects'
  if (pathname.startsWith('/adaptive')) return 'Adaptive Control'
  if (pathname.startsWith('/mpc')) return 'MPC Control'
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
      className={`group relative flex items-center rounded-xl no-underline transition-all duration-150 ${
        expanded ? 'gap-3 px-3.5 py-2.5' : 'size-10 place-items-center justify-center'
      } ${
        active
          ? 'bg-primary/10 text-primary font-semibold border border-primary/20 shadow-sm dark:bg-primary/15'
          : 'text-muted-text hover:bg-surface-hover hover:text-foreground font-medium'
      }`}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      {active && (
        <span
          className={`absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-primary ${
            expanded ? 'left-1' : '-left-1'
          }`}
          aria-hidden
        />
      )}
      <span className="grid size-[19px] shrink-0 place-items-center">{children}</span>
      {expanded ? (
        <span className="truncate text-[13.5px]">{label}</span>
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
  const { resolvedTheme, toggleTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  if (!user) return null

  const isDesign = location.pathname === '/design'
  const isProjects =
    location.pathname.startsWith('/projects') ||
    location.pathname.startsWith('/case-studies') ||
    location.pathname.startsWith('/adaptive') ||
    location.pathname.startsWith('/mpc')
  const isTutorials = location.pathname.startsWith('/tutorials')
  const isProfile = location.pathname === '/profile'
  const isMpc = location.pathname.startsWith('/mpc')
  const isAdaptive = location.pathname.startsWith('/adaptive')
  const isFullBleed = isProfile || isDesign || isMpc || isAdaptive
  const initials = userInitials(user)
  const label = sectionLabel(location.pathname)
  const sidebarWidth = sidebarOpen ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH
  const displayName = user.display_name?.trim() || user.email

  const handleLogout = () => {
    void logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="relative flex h-dvh overflow-hidden bg-surface font-sans text-[14px] leading-[1.55] text-foreground antialiased">
      {/* Living Ambient Lighting Atmosphere */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-40 left-1/4 h-[480px] w-[700px] rounded-full bg-gradient-to-br from-primary/10 via-purple-600/5 to-transparent blur-3xl animate-[aurora-drift_14s_ease-in-out_infinite]" />
        <div className="absolute right-1/4 top-1/3 h-[420px] w-[560px] rounded-full bg-gradient-to-bl from-cyan-500/8 via-indigo-600/4 to-transparent blur-3xl animate-[pulse-soft_9s_ease-in-out_infinite]" />
        <div className="absolute bottom-10 left-1/3 h-[480px] w-[620px] rounded-full bg-gradient-to-tr from-purple-700/5 via-primary/6 to-transparent blur-3xl animate-[aurora-drift_18s_ease-in-out_infinite_reverse]" />
      </div>

      <aside
        className={`fixed inset-y-0 left-0 z-[200] flex flex-col border-r border-border bg-surface-elevated transition-[width] duration-200 shadow-sm ${
          sidebarOpen ? 'px-3.5 py-4' : 'items-center py-4 pb-4'
        }`}
        style={{ width: sidebarWidth }}
      >
        <div
          className={`mb-6 flex shrink-0 items-center ${
            sidebarOpen ? 'justify-between gap-2 px-1' : 'justify-center'
          }`}
        >
          <Link
            to="/design"
            className="flex items-center gap-2.5 no-underline group"
            aria-label="LabCD Home"
          >
            <div className="grid size-[36px] shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent-2 shadow-[0_2px_10px_color-mix(in_srgb,var(--app-primary)_30%,transparent)] transition-transform duration-150 group-hover:scale-105">
              <svg viewBox="0 0 24 24" fill="none" className="size-[20px]" aria-hidden>
                <path
                  d="M2 18h6V6h14"
                  stroke="white"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            {sidebarOpen && (
              <div className="flex flex-col">
                <span className="font-bold text-[16px] tracking-tight text-foreground leading-tight">
                  LabCD
                </span>
                <span className="text-[10.5px] font-mono text-muted tracking-wider uppercase">
                  Control Platform
                </span>
              </div>
            )}
          </Link>
          {sidebarOpen && (
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-text hover:bg-surface-hover hover:text-foreground transition-colors"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
              title="Close sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>

        {sidebarOpen && (
          <div className="mb-2 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted/80">
            Navigation
          </div>
        )}

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
            label="Case Studies & Projects"
            active={isProjects}
            expanded={sidebarOpen}
          >
            <Layers className="size-[19px]" strokeWidth={1.6} aria-hidden />
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
          className={`mt-auto flex flex-col gap-2.5 border-t border-border pt-3.5 ${
            sidebarOpen ? 'px-1' : 'items-center'
          }`}
        >
          <div className={`flex gap-2 ${sidebarOpen ? 'flex-col' : 'flex-col items-center'}`}>
            <button
              type="button"
              className={`flex items-center gap-2.5 rounded-xl border border-border bg-surface text-muted-text hover:bg-surface-hover hover:text-foreground text-xs font-medium transition-all ${
                sidebarOpen ? 'w-full px-3 py-2' : 'size-10 justify-center'
              }`}
              title={resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
              aria-label={
                resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
              }
              onClick={toggleTheme}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="size-4 shrink-0 text-amber-400" aria-hidden />
              ) : (
                <Moon className="size-4 shrink-0 text-slate-700" aria-hidden />
              )}
              {sidebarOpen && (
                <span>{resolvedTheme === 'dark' ? 'Theme: Dark' : 'Theme: Light'}</span>
              )}
            </button>

            <button
              type="button"
              className={`flex items-center gap-2.5 rounded-xl border border-border bg-surface text-muted-text hover:bg-surface-hover hover:text-foreground text-xs font-medium transition-all ${
                sidebarOpen ? 'w-full px-3 py-2' : 'size-10 justify-center'
              }`}
              onClick={handleLogout}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4 shrink-0" aria-hidden />
              {sidebarOpen && <span>Sign out</span>}
            </button>
          </div>

          <Link
            to="/profile"
            className={`group relative flex items-center overflow-hidden rounded-xl border no-underline transition-all ${
              sidebarOpen ? 'gap-3 px-2.5 py-2' : 'size-9 justify-center'
            } ${
              isProfile
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-surface-muted text-muted-text hover:bg-surface-hover hover:border-border/80'
            }`}
            aria-label="Profile & stats"
            aria-current={isProfile ? 'page' : undefined}
            title={displayName}
          >
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-primary to-accent-2 text-xs font-bold text-white shadow-sm">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="size-full object-cover" />
              ) : (
                <span>{initials}</span>
              )}
            </span>
            {sidebarOpen ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-foreground">
                  {displayName}
                </span>
                <span className="block text-[11px] text-muted leading-tight">Profile & stats</span>
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
        <header className="sticky top-0 z-[100] flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface-elevated/85 px-4 sm:px-6 backdrop-blur-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          {/* Left: Sidebar Toggle + Breadcrumb */}
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-text hover:bg-surface-hover hover:text-foreground transition-colors"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                title="Open sidebar"
              >
                <Menu className="size-4" />
              </button>
            )}
            <div className="flex items-center gap-2 text-[13px] text-muted-text">
              <span className="font-bold text-foreground tracking-tight">LabCD</span>
              <span className="text-muted/50">/</span>
              <span className="capitalize font-medium text-foreground/90">{label}</span>
            </div>
          </div>

          {/* Right: Help + Theme Toggle + CTA */}
          <div className="flex items-center gap-2.5">
            {/* Help / Tutorials */}
            <Link
              to="/tutorials"
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-text hover:bg-surface-hover hover:text-foreground transition-colors"
              title="Documentation & Tutorials"
              aria-label="Tutorials"
            >
              <HelpCircle className="size-4" />
            </Link>

            {/* Theme Switcher in Header */}
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted-text hover:bg-surface-hover hover:text-foreground transition-colors"
              title={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={toggleTheme}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="size-4 text-amber-400 transition-transform duration-200 hover:rotate-45" />
              ) : (
                <Moon className="size-4 text-slate-700 transition-transform duration-200 hover:-rotate-12" />
              )}
            </button>

            {/* Primary Action Button (New Chat / New System) */}
            {isDesign ? (
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-primary/25 hover:brightness-110 active:scale-95 transition-all"
                onClick={() =>
                  navigate('/design', { replace: true, state: { newChat: Date.now() } })
                }
              >
                <Plus className="size-3.5" aria-hidden />
                <span>New chat</span>
              </button>
            ) : isProjects ? (
              <Link
                to="/design"
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-primary/25 hover:brightness-110 active:scale-95 transition-all no-underline"
              >
                <Plus className="size-3.5" aria-hidden />
                <span>New system</span>
              </Link>
            ) : null}

            {topbarActions}
          </div>
        </header>

        <main
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${
            isFullBleed ? '' : 'p-4 sm:p-6 lg:p-8 xl:p-10'
          }`}
        >
          {isFullBleed ? (
            children
          ) : (
            <div className="mx-auto w-full max-w-[1720px] 2xl:max-w-[1920px]">{children}</div>
          )}
        </main>
      </div>

      <SupportFabs />
    </div>
  )
}
