import { useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowLeft,
  Bug,
  ClipboardList,
  FolderKanban,
  Flag,
  Globe,
  Key,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  Package,
  ScrollText,
  Users,
  X,
} from 'lucide-react'
import { BugReportFab } from '../BugReportFab'
import { ThemeToggle } from '../ThemeToggle'
import { useAuth } from '../../context/AuthContext'
import { btnBase, btnCompact } from '../../lib/classes'

const navItems = [
  { to: '/admin', end: true, label: 'Overview', icon: LayoutDashboard, action: 'admin:access' },
  { to: '/admin/users', end: false, label: 'Users', icon: Users, action: 'admin:users' },
  { to: '/admin/projects', end: false, label: 'Projects', icon: FolderKanban, action: 'admin:projects' },
  { to: '/admin/plans', end: false, label: 'Plans', icon: Package, action: 'admin:plans' },
  { to: '/admin/roles', end: false, label: 'Roles', icon: KeyRound, action: 'admin:roles' },
  { to: '/admin/api-keys', end: false, label: 'API Keys', icon: Key, action: 'admin:api_keys' },
  { to: '/admin/site', end: false, label: 'Site CMS', icon: Globe, action: 'admin:site' },
  { to: '/admin/blog', end: false, label: 'Blog', icon: Newspaper, action: 'admin:blog' },
  { to: '/admin/survey', end: false, label: 'Survey', icon: ClipboardList, action: 'admin:survey' },
  { to: '/admin/bug-reports', end: false, label: 'Bug Reports', icon: Flag, action: 'admin:bug_reports' },
  { to: '/admin/monitoring', end: false, label: 'Monitoring', icon: Activity, action: 'admin:monitoring' },
  { to: '/admin/errors', end: false, label: 'Error Tracking', icon: Bug, action: 'admin:errors' },
  { to: '/admin/audit-log', end: false, label: 'Audit Log', icon: ScrollText, action: 'admin:audit' },
] as const

export function AdminLayout() {
  const { user, logout, hasAction } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!user || !hasAction('admin:access')) {
    return <Navigate to="/studio" replace />
  }

  const visibleNav = navItems.filter((item) => hasAction(item.action))

  const handleLogout = () => {
    void logout()
    navigate('/login', { replace: true })
  }

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="admin-shell relative flex min-h-screen bg-surface text-foreground">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="absolute -left-24 top-0 h-80 w-80 rounded-full bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] blur-3xl" />
        <div className="absolute -right-16 bottom-20 h-72 w-72 rounded-full bg-[color-mix(in_srgb,var(--app-primary)_8%,transparent)] blur-3xl" />
      </div>

      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-foreground/30 backdrop-blur-[2px] lg:hidden"
          aria-label="Close sidebar"
          onClick={closeSidebar}
        />
      )}

      <aside
        className={`admin-sidebar fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-border bg-surface-elevated/95 shadow-sm backdrop-blur-md transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <Link to="/admin" className="flex items-center gap-3" onClick={closeSidebar}>
            <img src="/logo.svg" alt="LabCD" className="h-10 w-10" />
            <div>
              <div className="text-sm font-semibold tracking-tight text-foreground">
                LabCD Admin
              </div>
              <div className="text-[0.7rem] text-muted">Control panel</div>
            </div>
          </Link>
          <button
            type="button"
            className={`${btnBase} ${btnCompact} lg:hidden`}
            onClick={closeSidebar}
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {visibleNav.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={closeSidebar}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] text-primary shadow-sm'
                    : 'text-muted-text hover:bg-surface-hover hover:text-foreground'
                }`
              }
            >
              <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-border p-4">
          <Link
            to="/studio"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-text transition-colors hover:bg-surface-hover hover:text-foreground"
            onClick={closeSidebar}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to studio
          </Link>
          <div className="rounded-xl border border-border-subtle bg-surface-muted px-3 py-2.5">
            <div className="truncate text-sm font-medium text-foreground">{user.email}</div>
            <div className="mt-0.5 text-[0.7rem] uppercase tracking-wide text-muted">
              {user.role_name || (user.is_admin ? 'Administrator' : 'Staff')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${btnBase} ${btnCompact} flex-1`}
              onClick={handleLogout}
            >
              <LogOut className="size-3.5" aria-hidden />
              Sign out
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface-elevated/80 px-4 py-3 backdrop-blur-md lg:hidden">
          <button
            type="button"
            className={btnBase}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-4" />
          </button>
          <div className="text-sm font-semibold text-foreground">Admin</div>
        </header>
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
      <BugReportFab />
    </div>
  )
}
