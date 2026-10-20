import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, KeyRound, Shield, Trash2, UserX } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type {
  AdminUserCredits,
  AdminUserDetail,
  DeveloperApiKeyMeta,
  ErrorEvent,
  LoginHistoryEntry,
  ProjectSummary,
} from '../api/types'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useServerPagination } from '../hooks/useServerPagination'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldInput,
  fieldLabel,
} from '../lib/classes'
import { pipelineLabel, statusBadgeClass } from '../lib/projectLabels'
import { formatDateTime } from '../lib/formatDateTime'

function formatFailureReason(reason: string | null): string {
  if (!reason) return '—'
  if (reason === 'invalid_credentials') return 'Invalid credentials'
  if (reason === 'inactive') return 'Account inactive'
  if (reason === 'unknown_user') return 'Unknown user'
  if (reason === 'unverified') return 'Email not verified'
  if (reason === 'locked') return 'Locked out'
  return reason
}

function truncateAgent(value: string | null, max = 64): string {
  if (!value) return '—'
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(8rem,12rem)_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-muted-text">{label}</dt>
      <dd className="m-0 text-sm text-foreground">{value}</dd>
    </div>
  )
}

export function AdminUserDetailPage() {
  const { userId } = useParams()
  const id = Number(userId)
  const navigate = useNavigate()
  const { user: currentUser, hasAction } = useAuth()
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [credits, setCredits] = useState<AdminUserCredits | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [adjustAmount, setAdjustAmount] = useState('10')
  const [adjustNote, setAdjustNote] = useState('')
  const [devKey, setDevKey] = useState<DeveloperApiKeyMeta | null>(null)
  const [freshApiKey, setFreshApiKey] = useState<string | null>(null)
  const canCredits = hasAction('admin:credits')
  const canManageUsers = hasAction('admin:users')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsTotal, setProjectsTotal] = useState(0)
  const [errors, setErrors] = useState<ErrorEvent[]>([])
  const [errorsTotal, setErrorsTotal] = useState(0)
  const [loginHistory, setLoginHistory] = useState<LoginHistoryEntry[]>([])
  const [loginTotal, setLoginTotal] = useState(0)
  const projectsPagination = useServerPagination({
    total: projectsTotal,
    resetKey: id,
  })
  const errorsPagination = useServerPagination({
    total: errorsTotal,
    resetKey: id,
  })
  const loginPagination = useServerPagination({
    total: loginTotal,
    resetKey: id,
  })

  const loadDetail = async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true)
    setError(null)
    try {
      setDetail(await adminApi.getUser(id))
      if (canManageUsers) {
        try {
          setDevKey(await adminApi.getUserDeveloperKey(id))
        } catch {
          setDevKey(null)
        }
      }
      if (canCredits) {
        try {
          setCredits(await adminApi.getUserCredits(id))
        } catch {
          setCredits(null)
        }
      }
    } catch (err) {
      setDetail(null)
      setError(err instanceof Error ? err.message : 'Failed to load user')
    } finally {
      if (!opts?.quiet) setLoading(false)
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setError('Invalid user id')
      setLoading(false)
      return
    }
    void loadDetail()
  }, [id, canCredits, canManageUsers])

  const loadProjects = useCallback(async () => {
    if (!Number.isFinite(id)) return
    try {
      const page = await adminApi.listUserProjects(id, {
        page: projectsPagination.page,
        page_size: projectsPagination.pageSize,
      })
      setProjects(page.items)
      setProjectsTotal(page.total)
    } catch {
      setProjects([])
      setProjectsTotal(0)
    }
  }, [id, projectsPagination.page, projectsPagination.pageSize])

  const loadErrors = useCallback(async () => {
    if (!Number.isFinite(id)) return
    try {
      const page = await adminApi.listUserErrors(id, {
        page: errorsPagination.page,
        page_size: errorsPagination.pageSize,
      })
      setErrors(page.items)
      setErrorsTotal(page.total)
    } catch {
      setErrors([])
      setErrorsTotal(0)
    }
  }, [id, errorsPagination.page, errorsPagination.pageSize])

  const loadLoginHistory = useCallback(async () => {
    if (!Number.isFinite(id)) return
    try {
      const page = await adminApi.listUserLoginHistory(id, {
        page: loginPagination.page,
        page_size: loginPagination.pageSize,
      })
      setLoginHistory(page.items)
      setLoginTotal(page.total)
    } catch {
      setLoginHistory([])
      setLoginTotal(0)
    }
  }, [id, loginPagination.page, loginPagination.pageSize])

  useEffect(() => {
    if (!Number.isFinite(id)) return
    void loadProjects()
  }, [id, loadProjects])

  useEffect(() => {
    if (!Number.isFinite(id)) return
    void loadErrors()
  }, [id, loadErrors])

  useEffect(() => {
    if (!Number.isFinite(id)) return
    void loadLoginHistory()
  }, [id, loadLoginHistory])

  const sessions = detail?.sessions ?? []

  const isSelf = detail != null && currentUser?.id === detail.user.id

  const handleToggleActive = async () => {
    if (!detail || isSelf) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const nextActive = !detail.user.is_active
      await adminApi.updateUser(detail.user.id, { is_active: nextActive })
      setMessage(nextActive ? 'Account reactivated' : 'Account suspended')
      await loadDetail({ quiet: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!detail || isSelf) return
    if (
      !window.confirm(
        `Permanently delete user "${detail.user.email}"? This removes the account and related projects. This cannot be undone.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await adminApi.deleteUser(detail.user.id)
      navigate('/admin/users', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(false)
    }
  }

  const handleRestore = async () => {
    if (!detail) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await adminApi.restoreUser(detail.user.id)
      setMessage('Account restored from trash')
      await loadDetail({ quiet: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const handleCancelSubscription = async () => {
    if (!detail) return
    if (
      !window.confirm(
        `Cancel ${detail.user.email}'s Stripe subscription at the end of the current period?`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await adminApi.cancelUserSubscription(detail.user.id, true)
      setMessage('Subscription set to cancel at period end')
      await loadDetail({ quiet: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel subscription')
    } finally {
      setBusy(false)
    }
  }

  const handleResumeSubscription = async () => {
    if (!detail) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await adminApi.resumeUserSubscription(detail.user.id)
      setMessage('Subscription resumed')
      await loadDetail({ quiet: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume subscription')
    } finally {
      setBusy(false)
    }
  }

  const handleSyncSubscription = async () => {
    if (!detail) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await adminApi.syncUserSubscription(detail.user.id)
      setMessage('Subscription synced from Stripe')
      await loadDetail({ quiet: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync subscription')
    } finally {
      setBusy(false)
    }
  }

  const handleRevokeSession = async (sessionId: number) => {
    if (!detail) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await adminApi.revokeUserSession(detail.user.id, sessionId)
      setMessage('Session revoked')
      await loadDetail({ quiet: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session')
    } finally {
      setBusy(false)
    }
  }

  const handleAdjustCredits = async () => {
    if (!detail || !canCredits) return
    const amount = Number(adjustAmount)
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Enter a non-zero adjust amount')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      setCredits(
        await adminApi.adjustUserCredits(detail.user.id, {
          amount,
          note: adjustNote.trim() || undefined,
        }),
      )
      setMessage(`Credits adjusted by ${amount}`)
      setAdjustNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credit adjust failed')
    } finally {
      setBusy(false)
    }
  }

  const handleGenerateDevKey = async () => {
    if (!detail || !canManageUsers) return
    const regenerating = Boolean(devKey?.is_active)
    if (
      regenerating &&
      !window.confirm(
        'Regenerate this developer API key? The previous key will stop working immediately.',
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const created = await adminApi.createUserDeveloperKey(detail.user.id)
      setDevKey(created)
      setFreshApiKey(created.api_key)
      setMessage(
        regenerating
          ? 'Developer API key regenerated — copy it now; it will not be shown again.'
          : 'Developer API key created — copy it now; it will not be shown again.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create developer key')
    } finally {
      setBusy(false)
    }
  }

  const handleRevokeDevKey = async () => {
    if (!detail || !canManageUsers || !devKey?.is_active) return
    if (!window.confirm('Revoke this developer API key? API calls with it will fail.')) {
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await adminApi.revokeUserDeveloperKey(detail.user.id)
      setDevKey(null)
      setFreshApiKey(null)
      setMessage('Developer API key revoked')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke developer key')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyApiKey = async () => {
    if (!freshApiKey) return
    try {
      await navigator.clipboard.writeText(freshApiKey)
      setMessage('API key copied to clipboard')
    } catch {
      setError('Could not copy to clipboard')
    }
  }

  if (loading) {
    return <p className="text-muted-text">Loading user…</p>
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        {error && <StatusMessage type="error" message={error} />}
        <Link to="/admin/users" className={btnBase}>
          <ArrowLeft className="size-4" />
          Back
        </Link>
      </div>
    )
  }

  const { user, profile_survey, feedback_surveys, allowed_models } = detail

  return (
    <div className="admin-fade-in space-y-6">
      <Link to="/admin/users" className={`${btnBase} ${btnCompact} w-fit`}>
        <ArrowLeft className="size-3.5" />
        All users
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-start gap-4">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="size-16 rounded-full border border-border object-cover"
            />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-full border border-border bg-surface-muted text-lg font-semibold text-primary">
              {(user.display_name?.trim() || user.email).slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 space-y-2">
            <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground">
              {user.display_name?.trim() || user.email}
            </h1>
            {user.display_name?.trim() && (
              <p className="m-0 text-muted-text">{user.email}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
                  user.is_admin
                    ? 'bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] text-primary'
                    : 'bg-surface-elevated font-medium text-muted-text ring-1 ring-border'
                }`}
              >
                {user.is_admin ? <Shield className="size-3" aria-hidden /> : null}
                {user.role_name || (user.is_admin ? 'Admin' : 'User')}
              </span>
              {user.deleted_at ? (
                <span className="rounded-md bg-[var(--app-status-error-bg)] px-2 py-0.5 text-xs font-medium text-[var(--app-status-error-text)]">
                  Closed
                </span>
              ) : (
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    user.is_active
                      ? 'bg-[var(--app-status-success-bg)] text-[var(--app-status-success-text)]'
                      : 'bg-[var(--app-status-warning-bg)] text-[var(--app-status-warning-text)]'
                  }`}
                >
                  {user.is_active ? 'Active' : 'Inactive'}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {user.deleted_at ? (
            <>
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                disabled={busy}
                onClick={() => void handleRestore()}
              >
                Restore
              </button>
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                disabled={busy || isSelf}
                title={isSelf ? 'You cannot delete your own account' : undefined}
                onClick={() => void handleDelete()}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete permanently
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                disabled={busy || isSelf}
                title={isSelf ? 'You cannot suspend your own account' : undefined}
                onClick={() => void handleToggleActive()}
              >
                <UserX className="size-3.5" aria-hidden />
                {user.is_active ? 'Suspend' : 'Reactivate'}
              </button>
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                disabled={busy || isSelf}
                title={isSelf ? 'You cannot delete your own account' : undefined}
                onClick={() => void handleDelete()}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete
              </button>
            </>
          )}
        </div>
      </header>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">Account</h2>
        <dl className="space-y-3">
          <DetailRow label="Plan" value={user.plan_name ?? 'None'} />
          <DetailRow
            label="Modules"
            value={
              user.actions.length === 0 ? (
                'None'
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {user.actions.map((code) => (
                    <span
                      key={code}
                      className="rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[0.68rem] text-foreground-secondary ring-1 ring-border-subtle"
                    >
                      {code}
                    </span>
                  ))}
                </div>
              )
            }
          />
          <DetailRow
            label="LLM models"
            value={
              allowed_models.length === 0 ? (
                'None'
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {allowed_models.map((model) => (
                    <span
                      key={model}
                      className="rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[0.68rem] text-foreground-secondary ring-1 ring-border-subtle"
                    >
                      {model}
                    </span>
                  ))}
                </div>
              )
            }
          />
          <DetailRow label="Theme" value={user.theme} />
          <DetailRow
            label="Model training data"
            value={user.allow_training_use === false ? 'Opted out' : 'Allowed'}
          />
          <DetailRow
            label="Email verified"
            value={user.email_verified === false ? 'No' : 'Yes'}
          />
          {user.deleted_at ? (
            <DetailRow label="Closed at" value={formatDateTime(user.deleted_at)} />
          ) : null}
          <DetailRow label="Joined" value={formatDateTime(user.created_at)} />
          <DetailRow
            label="Profile survey"
            value={user.profile_survey_completed ? 'Completed' : 'Not completed'}
          />
          <DetailRow
            label="Feedback surveys"
            value={
              [
                user.feedback_survey_completed_silo ? 'Single Loop ✓' : 'Single Loop —',
                user.feedback_survey_completed_mulo ? 'Multi Loop ✓' : 'Multi Loop —',
              ].join(' · ')
            }
          />
          <DetailRow
            label="Tutorial"
            value={user.tutorial_dont_show_again ? 'Hidden permanently' : 'May show on login'}
          />
        </dl>
      </div>

      {canManageUsers && (
        <div className={cardPanel}>
          <h2 className="m-0 mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
            <KeyRound className="size-4 text-primary" aria-hidden />
            Developer API key
          </h2>
          <p className="m-0 mb-4 text-sm leading-relaxed text-muted-text">
            Generate a key so this user can call the public developer API for Single Loop, Multi
            Loop, Adaptive, and MPC. The full secret is shown only once after create or regenerate.
          </p>
          {freshApiKey && (
            <div className="mb-4 rounded-lg border border-border bg-surface-muted px-3 py-3">
              <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Full key (copy now)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">
                  {freshApiKey}
                </code>
                <button
                  type="button"
                  className={`${btnBase} ${btnCompact}`}
                  onClick={() => void handleCopyApiKey()}
                >
                  <Copy className="size-3.5" aria-hidden />
                  Copy
                </button>
              </div>
            </div>
          )}
          <dl className="mb-4 space-y-3">
            <DetailRow
              label="Status"
              value={
                devKey?.is_active ? (
                  <span className="rounded-md bg-[var(--app-status-success-bg)] px-2 py-0.5 text-xs font-medium text-[var(--app-status-success-text)]">
                    Active · {devKey.masked_key}
                  </span>
                ) : (
                  <span className="text-muted-text">No active key</span>
                )
              }
            />
            {devKey?.is_active && (
              <>
                <DetailRow label="Created" value={formatDateTime(devKey.created_at)} />
                <DetailRow
                  label="Last used"
                  value={devKey.last_used_at ? formatDateTime(devKey.last_used_at) : 'Never'}
                />
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${btnBase} ${btnCompact} ${btnPrimary}`}
              disabled={busy}
              onClick={() => void handleGenerateDevKey()}
            >
              {devKey?.is_active ? 'Regenerate key' : 'Generate key'}
            </button>
            {devKey?.is_active && (
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                disabled={busy}
                onClick={() => void handleRevokeDevKey()}
              >
                Revoke
              </button>
            )}
          </div>
        </div>
      )}

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">Billing</h2>
        {user.stripe_customer_id ? (
          <>
            <dl className="space-y-3">
              <DetailRow label="Stripe customer" value={user.stripe_customer_id} />
              <DetailRow
                label="Stripe subscription"
                value={user.stripe_subscription_id ?? 'None'}
              />
              <DetailRow
                label="Status"
                value={user.stripe_subscription_status ?? 'Unknown'}
              />
              <DetailRow
                label="Billing interval"
                value={user.billing_interval ? `${user.billing_interval}ly` : '—'}
              />
              <DetailRow
                label={user.stripe_cancel_at_period_end ? 'Cancels on' : 'Renews on'}
                value={
                  user.stripe_current_period_end
                    ? formatDateTime(user.stripe_current_period_end)
                    : '—'
                }
              />
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                className={`${btnBase} ${btnCompact}`}
                href={`https://dashboard.stripe.com/customers/${user.stripe_customer_id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Stripe
              </a>
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                onClick={() => void handleSyncSubscription()}
                disabled={busy || !user.stripe_subscription_id}
              >
                Sync from Stripe
              </button>
              {user.stripe_cancel_at_period_end ? (
                <button
                  type="button"
                  className={`${btnBase} ${btnCompact}`}
                  onClick={() => void handleResumeSubscription()}
                  disabled={busy || !user.stripe_subscription_id}
                >
                  Resume subscription
                </button>
              ) : (
                <button
                  type="button"
                  className={`${btnBase} ${btnCompact}`}
                  onClick={() => void handleCancelSubscription()}
                  disabled={busy || !user.stripe_subscription_id}
                >
                  Cancel at period end
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="m-0 text-sm text-muted-text">
            This user has no Stripe customer yet — they haven&apos;t started a paid
            subscription. Change their plan above to grant access manually, or they can
            subscribe from the Plans &amp; Billing page.
          </p>
        )}
      </div>

      {canCredits && credits && (
        <div className={cardPanel}>
          <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">Credits</h2>
          {credits.used_up && credits.used_up_message && (
            <StatusMessage type="warning" message={credits.used_up_message} />
          )}
          <dl className="mb-4 space-y-3">
            <DetailRow label="Spendable" value={String(credits.spendable)} />
            <DetailRow label="Daily" value={String(credits.daily_balance)} />
            <DetailRow label="Bonus" value={String(credits.bonus_balance)} />
            <DetailRow
              label="Daily reset"
              value={credits.daily_reset_at ? formatDateTime(credits.daily_reset_at) : '—'}
            />
            <DetailRow label="Referral code" value={credits.referral_code ?? '—'} />
            <DetailRow
              label="Referred by"
              value={credits.referred_by_user_id != null ? `#${credits.referred_by_user_id}` : '—'}
            />
            <DetailRow
              label="New-user bonus"
              value={
                credits.new_user_bonus_granted_at
                  ? formatDateTime(credits.new_user_bonus_granted_at)
                  : 'Not granted'
              }
            />
          </dl>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className={`${fieldLabel} m-0 min-w-[8rem]`}>
              <span>Adjust amount</span>
              <input
                className={fieldInput}
                type="number"
                step="0.01"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
              />
            </label>
            <label className={`${fieldLabel} m-0 min-w-[12rem] flex-1`}>
              <span>Note</span>
              <input
                className={fieldInput}
                type="text"
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                maxLength={500}
              />
            </label>
            <button
              type="button"
              className={btnPrimary}
              disabled={busy}
              onClick={() => void handleAdjustCredits()}
            >
              Apply
            </button>
          </div>
          <h3 className="m-0 mb-2 text-sm font-semibold text-foreground">
            Recent ledger ({credits.ledger.length})
          </h3>
          {credits.ledger.length === 0 ? (
            <p className="m-0 text-sm text-muted-text">No ledger entries.</p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {credits.ledger.slice(0, 10).map((row) => (
                <li key={row.id} className="text-sm text-foreground">
                  {Number(row.amount) > 0 ? '+' : ''}
                  {String(row.amount)} · {row.entry_type} · bal {String(row.balance_after)} ·{' '}
                  {formatDateTime(row.created_at)}
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-4 mb-2 text-sm font-semibold text-foreground">
            Usage sessions ({credits.sessions.length})
          </h3>
          {credits.sessions.length === 0 ? (
            <p className="m-0 text-sm text-muted-text">No usage sessions.</p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {credits.sessions.slice(0, 10).map((row) => (
                <li key={row.id} className="text-sm text-foreground">
                  {row.module} · {row.status} · {row.duration_seconds}s · charged{' '}
                  {String(row.credits_charged)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">
          Active sessions ({sessions.length})
        </h2>
        {sessions.length === 0 ? (
          <p className="m-0 text-sm text-muted-text">No active sessions for this user.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-text">
                  <th className="px-2 py-2 font-medium">IP</th>
                  <th className="px-2 py-2 font-medium">User agent</th>
                  <th className="px-2 py-2 font-medium">Created</th>
                  <th className="px-2 py-2 font-medium">Last seen</th>
                  <th className="px-2 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-border-subtle align-top">
                    <td className="px-2 py-2 font-mono text-[0.75rem]">
                      {session.ip_address || '—'}
                    </td>
                    <td
                      className="max-w-[16rem] px-2 py-2 text-muted-text"
                      title={session.user_agent ?? undefined}
                    >
                      {truncateAgent(session.user_agent)}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-muted-text">
                      {formatDateTime(session.created_at)}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-muted-text">
                      {formatDateTime(session.last_seen_at)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        className={`${btnBase} ${btnCompact}`}
                        disabled={busy}
                        onClick={() => void handleRevokeSession(session.id)}
                      >
                        Log out
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">
          Login history ({loginTotal})
        </h2>
        {loginTotal === 0 ? (
          <p className="m-0 text-sm text-muted-text">No login attempts recorded for this user.</p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-text">
                    <th className="px-2 py-2 font-medium">When</th>
                    <th className="px-2 py-2 font-medium">Result</th>
                    <th className="px-2 py-2 font-medium">IP</th>
                    <th className="px-2 py-2 font-medium">User agent</th>
                    <th className="px-2 py-2 font-medium">Failure reason</th>
                  </tr>
                </thead>
                <tbody>
                  {loginHistory.map((entry) => (
                    <tr key={entry.id} className="border-b border-border-subtle align-top">
                      <td className="px-2 py-2 whitespace-nowrap text-muted-text">
                        {formatDateTime(entry.created_at)}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                            entry.success
                              ? 'bg-[var(--app-status-success-bg)] text-[var(--app-status-success-text)]'
                              : 'bg-[var(--app-status-warning-bg)] text-[var(--app-status-warning-text)]'
                          }`}
                        >
                          {entry.success ? 'Success' : 'Failed'}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-mono text-[0.75rem] text-foreground-secondary">
                        {entry.ip_address || '—'}
                      </td>
                      <td
                        className="max-w-[16rem] px-2 py-2 text-muted-text"
                        title={entry.user_agent ?? undefined}
                      >
                        {truncateAgent(entry.user_agent)}
                      </td>
                      <td className="px-2 py-2 text-muted-text">
                        {formatFailureReason(entry.failure_reason)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AdminPagination
              page={loginPagination.page}
              totalPages={loginPagination.totalPages}
              total={loginPagination.total}
              from={loginPagination.from}
              to={loginPagination.to}
              onPageChange={loginPagination.setPage}
            />
          </div>
        )}
      </div>

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">Profile survey</h2>
        {!profile_survey ? (
          <p className="m-0 text-sm text-muted-text">This user has not completed the profile survey.</p>
        ) : (
          <dl className="space-y-3">
            <DetailRow label="University" value={profile_survey.university ?? '—'} />
            <DetailRow label="Degree" value={profile_survey.degree ?? '—'} />
            <DetailRow label="Major" value={profile_survey.major ?? '—'} />
            <DetailRow label="MATLAB experience" value={profile_survey.matlab_experience ?? '—'} />
            <DetailRow
              label="Control design experience"
              value={profile_survey.control_design_experience ?? '—'}
            />
            <DetailRow label="Completed" value={formatDateTime(profile_survey.completed_at)} />
          </dl>
        )}
      </div>

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">Feedback surveys</h2>
        {feedback_surveys.length === 0 ? (
          <p className="m-0 text-sm text-muted-text">This user has not submitted feedback yet.</p>
        ) : (
          <div className="space-y-6">
            {feedback_surveys.map((feedback_survey) => (
              <div key={`${feedback_survey.pipeline_type}-${feedback_survey.created_at}`}>
                <h3 className="m-0 mb-3 text-base font-semibold text-foreground">
                  {pipelineLabel(feedback_survey.pipeline_type)}
                </h3>
                <dl className="space-y-3">
                  <DetailRow label="Satisfaction" value={`${feedback_survey.satisfaction} / 5`} />
                  <DetailRow label="Ease of use" value={`${feedback_survey.ease_of_use} / 5`} />
                  <DetailRow label="Product value" value={`${feedback_survey.product_value} / 5`} />
                  <DetailRow label="Confidence" value={`${feedback_survey.confidence} / 5`} />
                  <DetailRow label="Reuse intention" value={`${feedback_survey.reuse_intention} / 5`} />
                  <DetailRow
                    label="Willingness to pay"
                    value={`${feedback_survey.willingness_to_pay} / 5`}
                  />
                  <DetailRow
                    label="Main problems"
                    value={
                      feedback_survey.main_problems.trim() ? (
                        <span className="whitespace-pre-wrap">{feedback_survey.main_problems}</span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <DetailRow label="Submitted" value={formatDateTime(feedback_survey.created_at)} />
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">
          Projects ({projectsTotal})
        </h2>
        {projectsTotal === 0 ? (
          <p className="m-0 text-sm text-muted-text">No projects created by this user.</p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-text">
                    <th className="px-2 py-2 font-medium">Title</th>
                    <th className="px-2 py-2 font-medium">Pipeline</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">File</th>
                    <th className="px-2 py-2 font-medium">Updated</th>
                    <th className="px-2 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id} className="border-b border-border-subtle">
                      <td className="px-2 py-2 font-medium text-foreground">{project.title}</td>
                      <td className="px-2 py-2">{pipelineLabel(project.pipeline_type)}</td>
                      <td className="px-2 py-2">
                        <span className={statusBadgeClass(project.status)}>{project.status}</span>
                      </td>
                      <td className="px-2 py-2 text-muted-text">{project.file_name || '—'}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-muted-text">
                        {formatDateTime(project.updated_at)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Link
                          to={`/admin/projects/${project.id}`}
                          className={`${btnBase} ${btnCompact}`}
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AdminPagination
              page={projectsPagination.page}
              totalPages={projectsPagination.totalPages}
              total={projectsPagination.total}
              from={projectsPagination.from}
              to={projectsPagination.to}
              onPageChange={projectsPagination.setPage}
            />
          </div>
        )}
      </div>

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">
          Error tracking ({errorsTotal})
        </h2>
        {errorsTotal === 0 ? (
          <p className="m-0 text-sm text-muted-text">No errors recorded for this user.</p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-text">
                    <th className="px-2 py-2 font-medium">When</th>
                    <th className="px-2 py-2 font-medium">Source</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Message</th>
                    <th className="px-2 py-2 font-medium">Path</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((event) => (
                    <tr key={event.id} className="border-b border-border-subtle align-top">
                      <td className="px-2 py-2 whitespace-nowrap text-muted-text">
                        {formatDateTime(event.created_at)}
                      </td>
                      <td className="px-2 py-2">{event.source}</td>
                      <td className="px-2 py-2">{event.status_code ?? '—'}</td>
                      <td className="max-w-xs px-2 py-2">
                        <p className="m-0 line-clamp-2 text-foreground">{event.message}</p>
                        {event.stack_trace && (
                          <p className="mt-1 line-clamp-2 font-mono text-[0.68rem] text-muted-text">
                            {event.stack_trace}
                          </p>
                        )}
                      </td>
                      <td className="max-w-[12rem] px-2 py-2 break-all text-muted-text">
                        {event.path || event.page_url || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AdminPagination
              page={errorsPagination.page}
              totalPages={errorsPagination.totalPages}
              total={errorsPagination.total}
              from={errorsPagination.from}
              to={errorsPagination.to}
              onPageChange={errorsPagination.setPage}
            />
          </div>
        )}
      </div>
    </div>
  )
}
