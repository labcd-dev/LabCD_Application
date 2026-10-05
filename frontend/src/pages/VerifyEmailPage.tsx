import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import { AuthPageFrame } from '../components/auth/AuthPageFrame'
import { StatusMessage } from '../components/StatusMessage'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token')?.trim() ?? ''
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Missing verification token')
      return
    }
    let cancelled = false
    const run = async () => {
      setBusy(true)
      setError(null)
      try {
        const result = await authApi.verifyEmail({ token })
        if (!cancelled) setSuccess(result.message)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Verification failed')
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <AuthPageFrame title="Verify email" subtitle="Confirming your LabCD account email address.">
      <div className="login-auth__messages">
        {busy && <p className="login-auth__subtitle">Verifying…</p>}
        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}
      </div>

      <div className="login-auth__form">
        <Link to="/login" className="login-auth__submit">
          Go to Log In
        </Link>
      </div>

      {error && (
        <p className="login-auth__footer">
          Need a new link?{' '}
          <Link to="/resend-verification" className="login-auth__link">
            Resend verification
          </Link>
        </p>
      )}
    </AuthPageFrame>
  )
}
