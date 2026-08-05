import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { btnBase, btnPrimary } from '../lib/classes'
import { OnboardingGate } from './OnboardingGate'

export function ProtectedRoute() {
  const { user, token, loading, sessionError, refreshUser, logout } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-text">
        Checking session…
      </div>
    )
  }

  if (sessionError && token && !user) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-muted-text">Couldn’t restore your session. The server may be busy.</p>
        <div className="flex gap-2">
          <button type="button" className={btnPrimary} onClick={() => void refreshUser()}>
            Retry
          </button>
          <button
            type="button"
            className={btnBase}
            onClick={() => {
              void logout()
            }}
          >
            Sign in again
          </button>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return (
    <OnboardingGate>
      <Outlet />
    </OnboardingGate>
  )
}
