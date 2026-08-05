import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Shield, Trash2, UserX } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { AdminUserDetail } from '../api/types'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import { btnBase, btnCompact, cardPanel } from '../lib/classes'
import { pipelineLabel, statusBadgeClass } from '../lib/projectLabels'

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function formatFailureReason(reason: string | null): string {
  if (!reason) return '—'
  if (reason === 'invalid_credentials') return 'Invalid credentials'
  if (reason === 'inactive') return 'Account inactive'
  if (reason === 'unknown_user') return 'Unknown user'
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
  const { user: currentUser } = useAuth()
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const loadDetail = async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true)
    setError(null)
    try {
      setDetail(await adminApi.getUser(id))
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
  }, [id])

  const projects = detail?.projects ?? []
  const errors = detail?.errors ?? []
  const loginHistory = detail?.login_history ?? []
  const projectsPagination = useClientPagination(projects)
  const errorsPagination = useClientPagination(errors)
  const loginPagination = useClientPagination(loginHistory)

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
        `Delete user "${detail.user.email}"? This permanently removes the account and related projects. This cannot be undone.`,
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
              {user.is_admin ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] px-2 py-0.5 text-xs font-semibold text-primary">
                  <Shield className="size-3" aria-hidden />
                  Admin
                </span>
              ) : (
                <span className="rounded-md bg-surface-elevated px-2 py-0.5 text-xs font-medium text-muted-text ring-1 ring-border">
                  User
                </span>
              )}
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                  user.is_active
                    ? 'bg-[var(--app-status-success-bg)] text-[var(--app-status-success-text)]'
                    : 'bg-[var(--app-status-warning-bg)] text-[var(--app-status-warning-text)]'
                }`}
              >
                {user.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <DetailRow label="Joined" value={formatWhen(user.created_at)} />
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

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">
          Login history ({loginHistory.length})
        </h2>
        {loginHistory.length === 0 ? (
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
                  {loginPagination.pageItems.map((entry) => (
                    <tr key={entry.id} className="border-b border-border-subtle align-top">
                      <td className="px-2 py-2 whitespace-nowrap text-muted-text">
                        {formatWhen(entry.created_at)}
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
            <DetailRow label="Completed" value={formatWhen(profile_survey.completed_at)} />
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
                  <DetailRow label="Submitted" value={formatWhen(feedback_survey.created_at)} />
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">
          Projects ({projects.length})
        </h2>
        {projects.length === 0 ? (
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
                  {projectsPagination.pageItems.map((project) => (
                    <tr key={project.id} className="border-b border-border-subtle">
                      <td className="px-2 py-2 font-medium text-foreground">{project.title}</td>
                      <td className="px-2 py-2">{pipelineLabel(project.pipeline_type)}</td>
                      <td className="px-2 py-2">
                        <span className={statusBadgeClass(project.status)}>{project.status}</span>
                      </td>
                      <td className="px-2 py-2 text-muted-text">{project.file_name || '—'}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-muted-text">
                        {formatWhen(project.updated_at)}
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
          Error tracking ({errors.length})
        </h2>
        {errors.length === 0 ? (
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
                  {errorsPagination.pageItems.map((event) => (
                    <tr key={event.id} className="border-b border-border-subtle align-top">
                      <td className="px-2 py-2 whitespace-nowrap text-muted-text">
                        {formatWhen(event.created_at)}
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
