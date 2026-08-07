import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { cardPanel, pageIntro } from '../lib/classes'

function parseHashParams(hash: string): URLSearchParams {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(raw)
}

export function LoginSsoPage() {
  const { user, loading, loginWithToken } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    const params = parseHashParams(window.location.hash)
    const token = params.get('access_token')
    const redirectTo = params.get('redirect_to') || '/studio'
    const ssoError = params.get('error')

    // Clear sensitive token from the address bar.
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }

    if (ssoError) {
      setError(ssoError)
      setBusy(false)
      return
    }
    if (!token) {
      setError('Missing SSO token')
      setBusy(false)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        await loginWithToken(token)
        if (!cancelled) {
          navigate(redirectTo.startsWith('/') ? redirectTo : '/studio', { replace: true })
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'SSO login failed')
          setBusy(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loginWithToken, navigate])

  if (!loading && user && !error && !busy) {
    return <Navigate to="/studio" replace />
  }

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-1">
      <div className={`${cardPanel} space-y-4`}>
        <header>
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">
            Completing sign-in
          </h2>
          <p className={`${pageIntro} mt-2`}>
            {busy && !error ? 'Finishing SSO login…' : 'SSO sign-in did not complete.'}
          </p>
        </header>
        {error && <StatusMessage type="error" message={error} />}
        {error && (
          <p className="m-0 text-center text-sm text-muted-text">
            <Link to="/login" className="font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        )}
      </div>
    </section>
  )
}
