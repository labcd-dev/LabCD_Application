import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { AuthPageFrame } from '../components/auth/AuthPageFrame'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { passwordMeetsPolicy, passwordPolicyError } from '../lib/passwordStrength'

export function RegisterPage() {
  const { user, loading, register } = useAuth()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [referralCode, setReferralCode] = useState(
    () => (searchParams.get('ref') || '').trim().toUpperCase(),
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) {
    return <Navigate to="/design" replace />
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    const policyError = passwordPolicyError(password, { email })
    if (policyError || !passwordMeetsPolicy(password, { email })) {
      setError(policyError ?? 'Password does not meet requirements')
      return
    }

    setSubmitting(true)
    try {
      const result = await register(email.trim(), password, referralCode.trim() || null)
      setSuccess(result.message)
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthPageFrame
      title="Create account"
      subtitle="Register with your email. We will send a verification link before you can sign in."
    >
      <div className="login-auth__messages">
        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}
      </div>

      {!success && (
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
                autoComplete="new-password"
                required
                placeholder="Create a password"
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
          <div className="login-auth__meter">
            <PasswordStrengthMeter password={password} email={email} />
          </div>

          <label className="login-auth__label">
            <span>Confirm password *</span>
            <div className="login-auth__password-wrap">
              <input
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                required
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button
                type="button"
                className="login-auth__eye"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
                onClick={() => setShowConfirm((v) => !v)}
              >
                {showConfirm ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
          </label>

          <label className="login-auth__label">
            <span>Referral code (optional)</span>
            <input
              className="login-auth__input"
              type="text"
              autoComplete="off"
              placeholder="Enter referral code"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              maxLength={32}
            />
          </label>

          <button type="submit" className="login-auth__submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>
      )}

      <p className="login-auth__footer">
        Already have an account?{' '}
        <Link to="/login" className="login-auth__link">
          Log In
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
