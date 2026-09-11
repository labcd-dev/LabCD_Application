import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { btnPrimary, btnWide, cardPanel, fieldInput, fieldLabel, pageIntro } from '../lib/classes'
import { passwordMeetsPolicy, passwordPolicyError } from '../lib/passwordStrength'

export function RegisterPage() {
  const { user, loading, register } = useAuth()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
    <section className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-1">
      <div className={`${cardPanel} space-y-4`}>
        <header>
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">
            Create account
          </h2>
          <p className={`${pageIntro} mt-2`}>
            Register with your email. We will send a verification link before you can sign in.
          </p>
        </header>

        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}

        {!success && (
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <PasswordStrengthMeter password={password} email={email} />
            <label className={fieldLabel}>
              <span>Confirm password</span>
              <input
                className={fieldInput}
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
            <label className={fieldLabel}>
              <span>Referral code (optional)</span>
              <input
                className={fieldInput}
                type="text"
                autoComplete="off"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                maxLength={32}
              />
            </label>
            <button type="submit" className={`${btnPrimary} ${btnWide}`} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create account'}
            </button>
          </form>
        )}

        <p className="mb-0 text-sm text-muted-text">
          Already have an account?{' '}
          <Link className="font-medium text-accent hover:underline" to="/login">
            Sign in
          </Link>
        </p>
      </div>
    </section>
  )
}
