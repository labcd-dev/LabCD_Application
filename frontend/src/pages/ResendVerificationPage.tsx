import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import { AuthPageFrame } from '../components/auth/AuthPageFrame'
import { StatusMessage } from '../components/StatusMessage'

export function ResendVerificationPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      const result = await authApi.resendVerification({ email: email.trim() })
      setSuccess(result.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend verification')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthPageFrame
      title="Resend verification"
      subtitle="Enter your email and we will send a new verification link if your account needs one."
    >
      <div className="login-auth__messages">
        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}
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
        <button type="submit" className="login-auth__submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Resend verification'}
        </button>
      </form>

      <p className="login-auth__footer">
        Already verified?{' '}
        <Link to="/login" className="login-auth__link">
          Back to Log In
        </Link>
      </p>
      <p className="login-auth__footer">
        Don&apos;t have an account ?{' '}
        <Link to="/register" className="login-auth__link">
          Register here
        </Link>
      </p>
    </AuthPageFrame>
  )
}
