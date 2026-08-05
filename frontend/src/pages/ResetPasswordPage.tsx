import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import { StatusMessage } from '../components/StatusMessage'
import { btnPrimary, btnWide, cardPanel, fieldInput, fieldLabel, pageIntro } from '../lib/classes'
import { passwordMeetsPolicy, passwordPolicyError } from '../lib/passwordStrength'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token')?.trim() ?? ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
    <section className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-1">
      <div className={`${cardPanel} space-y-4`}>
        <header>
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">
            Reset password
          </h2>
          <p className={`${pageIntro} mt-2`}>Choose a new strong password for your account.</p>
        </header>

        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}

        {!success && (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-1">
            <label className={fieldLabel}>
              <span>New password</span>
              <input
                className={fieldInput}
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordStrengthMeter password={password} />
            </label>
            <label className={fieldLabel}>
              <span>Confirm password</span>
              <input
                className={fieldInput}
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
            <button type="submit" className={`${btnPrimary} ${btnWide}`} disabled={submitting}>
              {submitting ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        <p className="m-0 text-center text-sm text-muted-text">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </section>
  )
}
