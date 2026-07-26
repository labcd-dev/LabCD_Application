import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { btnPrimary, btnWide, cardPanel, fieldInput, fieldLabel, pageIntro } from '../lib/classes'

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/studio'

  if (!loading && user) {
    return <Navigate to={from} replace />
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
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
          <button type="submit" className={`${btnPrimary} ${btnWide}`} disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

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
