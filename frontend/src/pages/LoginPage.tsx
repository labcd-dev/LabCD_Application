import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import type { SsoProviderPublic } from '../api/types'
import { AuthPageFrame } from '../components/auth/AuthPageFrame'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'

const REMEMBER_EMAIL_KEY = 'labcd.login.rememberEmail'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.2 5.5l.1.1 6.3 5.3C39.1 37.1 44 33 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  )
}

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [ssoProviders, setSsoProviders] = useState<SsoProviderPublic[]>([])

  const from = (location.state as { from?: string; notice?: string } | null)?.from ?? '/design'
  const notice = (location.state as { notice?: string } | null)?.notice

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY)
      if (saved) {
        setEmail(saved)
        setRememberMe(true)
      }
    } catch {
      // ignore storage errors
    }
  }, [])

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
      const trimmed = email.trim()
      try {
        if (rememberMe) {
          localStorage.setItem(REMEMBER_EMAIL_KEY, trimmed)
        } else {
          localStorage.removeItem(REMEMBER_EMAIL_KEY)
        }
      } catch {
        // ignore storage errors
      }
      await login(trimmed, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  const startSso = (provider: string) => {
    window.location.href = authApi.ssoStartUrl(provider, from)
  }

  return (
    <AuthPageFrame
      title="Welcome back !"
      subtitle="Enter to get unlimited access to control design with AI."
    >
      <div className="login-auth__messages">
        {error && <StatusMessage type="error" message={error} />}
        {(info || notice) && <StatusMessage type="success" message={info || notice || ''} />}
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="login-auth__form">
        <label className="login-auth__label">
          <span>Email *</span>
          <input
            className="login-auth__input"
            type="email"
            autoComplete="username"
            required
            placeholder="Enter your mail address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="login-auth__label">
          <span>Password *</span>
          <div className="login-auth__password-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="login-auth__eye"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        </label>

        <div className="login-auth__row">
          <label className="login-auth__remember">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>Remember me</span>
          </label>
          <Link to="/forgot-password" className="login-auth__link">
            Forgot your password ?
          </Link>
        </div>

        <button type="submit" className="login-auth__submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log In'}
        </button>
      </form>

      {ssoProviders.length > 0 && (
        <>
          <div className="login-auth__divider">
            <span>Or, Login with</span>
          </div>
          <div className="login-auth__sso">
            {ssoProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="login-auth__sso-btn"
                onClick={() => startSso(provider.provider)}
              >
                {provider.provider === 'google' && <GoogleMark />}
                {provider.provider === 'google'
                  ? `Sign in with ${provider.display_name}`
                  : `Continue with ${provider.display_name}`}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="login-auth__footer">
        Don&apos;t have an account ?{' '}
        <Link to="/register" className="login-auth__link">
          Register here
        </Link>
      </p>

      <p className="login-auth__footer">
        Need a verification email?{' '}
        <Link to="/resend-verification" className="login-auth__link">
          Resend here
        </Link>
      </p>
    </AuthPageFrame>
  )
}
