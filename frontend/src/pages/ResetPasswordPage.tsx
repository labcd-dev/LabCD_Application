import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import { AuthPageFrame } from '../components/auth/AuthPageFrame'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import { StatusMessage } from '../components/StatusMessage'
import { passwordMeetsPolicy, passwordPolicyError } from '../lib/passwordStrength'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token')?.trim() ?? ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!token) {
      setError('Missing reset token')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    const policyError = passwordPolicyError(password)
    if (policyError || !passwordMeetsPolicy(password)) {
      setError(policyError ?? 'Password does not meet requirements')
      return
    }

    setSubmitting(true)
    try {
      const result = await authApi.resetPassword({ token, new_password: password })
      setSuccess(result.message)
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthPageFrame title="Reset password" subtitle="Choose a new strong password for your account.">
      <div className="login-auth__messages">
        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}
      </div>

      {!success && (
        <form onSubmit={(e) => void handleSubmit(e)} className="login-auth__form">
          <label className="login-auth__label">
            <span>New password *</span>
            <div className="login-auth__password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={12}
                placeholder="Enter new password"
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
            <PasswordStrengthMeter password={password} />
          </div>

          <label className="login-auth__label">
            <span>Confirm password *</span>
            <div className="login-auth__password-wrap">
              <input
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={12}
                placeholder="Re-enter new password"
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

          <button type="submit" className="login-auth__submit" disabled={submitting}>
            {submitting ? 'Updating…' : 'Update password'}
          </button>
        </form>
      )}

      <p className="login-auth__footer">
        <Link to="/login" className="login-auth__link">
          Back to Log In
        </Link>
      </p>
    </AuthPageFrame>
  )
}
