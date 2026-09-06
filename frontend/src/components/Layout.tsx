import { Outlet, useLocation } from 'react-router-dom'
import { AppShell } from './AppShell'
import { useAuth } from '../context/AuthContext'

const AUTH_PATHS = new Set([
  '/',
  '/login',
  '/login/sso',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
])

export function Layout() {
  const location = useLocation()
  const { user } = useAuth()
  const isAuthPage = AUTH_PATHS.has(location.pathname)
  const useAppShell = Boolean(user) && !isAuthPage

  if (useAppShell) {
    return (
      <AppShell>
        <Outlet />
      </AppShell>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <Outlet />
      </main>
      <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted sm:px-6">
        LabCD Control Design Suite
      </footer>
    </div>
  )
}
