import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import { StatusMessage } from '../components/StatusMessage'
import { btnPrimary, btnWide, cardPanel, pageIntro } from '../lib/classes'

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
    <section className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-1">
      <div className={`${cardPanel} space-y-4`}>
        <header>
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-foreground">
            Verify email
          </h2>
          <p className={`${pageIntro} mt-2`}>Confirming your LabCD account email address.</p>
        </header>

        {busy && <p className="m-0 text-sm text-muted-text">Verifying…</p>}
        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}

        <Link to="/login" className={`${btnPrimary} ${btnWide} inline-flex justify-center`}>
          Go to sign in
        </Link>
      </div>
    </section>
  )
}
