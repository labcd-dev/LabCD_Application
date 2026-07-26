import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { btnPrimary, btnWide, cardPanel, fieldInput, fieldLabel, pageIntro } from '../lib/classes'

export function RegisterPage() {
  const { user, loading, register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) {
    return <Navigate to="/studio" replace />
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setSubmitting(true)
    try {
      await register(email.trim(), password)
      navigate('/studio', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-1">
      <div className={`${cardPanel} space-y-4`}>
        <header>
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">
            Create account
          </h2>
          <p className={`${pageIntro} mt-2`}>
            Register with your email. You receive the default plan set by an administrator.
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
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className={fieldLabel}>
            <span>Confirm password</span>
            <input
              className={fieldInput}
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <button type="submit" className={`${btnPrimary} ${btnWide}`} disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="m-0 text-center text-sm text-muted-text">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </section>
  )
}
