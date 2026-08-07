import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import type { SsoProviderPublic } from '../api/types'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { btnBase, btnPrimary, btnWide, cardPanel, fieldInput, fieldLabel, pageIntro } from '../lib/classes'

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [ssoProviders, setSsoProviders] = useState<SsoProviderPublic[]>([])

  const from = (location.state as { from?: string; notice?: string } | null)?.from ?? '/studio'
  const notice = (location.state as { notice?: string } | null)?.notice

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const providers = await authApi.listSsoProviders()
        if (!cancelled) setSsoProviders(providers)
      } catch {
        if (!cancelled) setSsoProviders([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!loading && user) {
    return <Navigate to={from} replace />
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResend = async () => {
    if (!email.trim()) {
      setError('Enter your email first, then resend verification')
      return
    }
    setError(null)
    setInfo(null)
    setResending(true)
    try {
      const result = await authApi.resendVerification({ email: email.trim() })
      setInfo(result.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend verification')
    } finally {
      setResending(false)
    }
  }

  const startSso = (provider: string) => {
    window.location.href = authApi.ssoStartUrl(provider, from)
  }

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-1">
      <div className={`${cardPanel} space-y-4`}>
        <header>
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">Sign in</h2>
          <p className={`${pageIntro} mt-2`}>
            Use your email to access Single Loop or Multi Loop design for your account.
          </p>
        </header>

        {error && <StatusMessage type="error" message={error} />}
        {(info || notice) && <StatusMessage type="success" message={info || notice || ''} />}

        {ssoProviders.length > 0 && (
          <div className="space-y-2">
            {ssoProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={`${btnBase} ${btnWide} border border-border bg-surface-elevated`}
                onClick={() => startSso(provider.provider)}
              >
                Continue with {provider.display_name}
              </button>
            ))}
            <div className="relative py-2 text-center text-xs uppercase tracking-[0.14em] text-muted-text">
              <span className="relative z-10 bg-[var(--app-surface-elevated,var(--app-surface))] px-2">
                or
              </span>
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
            </div>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-1">
          <label className={fieldLabel}>
            <span>Email</span>
            <input
              className={fieldInput}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className={fieldLabel}>
            <span>Password</span>
            <input
              className={fieldInput}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="flex justify-end pb-1">
            <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <button type="submit" className={`${btnPrimary} ${btnWide}`} disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="m-0 text-center text-sm text-muted-text">
          Need a verification email?{' '}
          <button
            type="button"
            className="border-0 bg-transparent p-0 font-medium text-primary hover:underline"
            disabled={resending}
            onClick={() => void handleResend()}
          >
            {resending ? 'Sending…' : 'Resend verification'}
          </button>
        </p>

        <p className="m-0 text-center text-sm text-muted-text">
          No account yet?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </section>
  )
}
