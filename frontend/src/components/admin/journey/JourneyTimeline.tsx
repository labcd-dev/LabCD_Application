import type { JourneyStep } from '../../../api/types'
import { btnBase, btnCompact, cardPanel } from '../../../lib/classes'
import { formatDateTime } from '../../../lib/formatDateTime'

export type TimelineKindGroup = 'all' | 'auth' | 'project' | 'pipeline' | 'error' | 'feedback' | 'other'

const KIND_GROUPS: { id: TimelineKindGroup; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'auth', label: 'Auth' },
  { id: 'project', label: 'Project' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'error', label: 'Errors' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'other', label: 'Other' },
]

const AUTH_KINDS = new Set([
  'registered',
  'email_verified',
  'login',
  'login_failed',
  'auth_lockout',
  'auth_forgot_password',
  'auth_reset_password',
  'auth_change_password',
  'auth_session_revoke',
  'auth_sso_start',
  'auth_sso_callback',
])

function kindGroup(kind: string): Exclude<TimelineKindGroup, 'all'> {
  if (AUTH_KINDS.has(kind) || kind.startsWith('auth_')) return 'auth'
  if (kind === 'project' || kind === 'module' || kind === 'credit_session') return 'project'
  if (kind === 'pipeline_stage') return 'pipeline'
  if (kind === 'error' || kind === 'bug_report') return 'error'
  if (kind === 'feedback' || kind === 'profile_survey') return 'feedback'
  return 'other'
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem ? `${hours}h ${rem}m` : `${hours}h`
}

function stepStatusClass(status: JourneyStep['status']): string {
  if (status === 'ok') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'fail') return 'text-rose-600 dark:text-rose-400'
  return 'text-muted-text'
}

function TimelineStep({ step }: { step: JourneyStep }) {
  const duration = formatDuration(step.duration_seconds)
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <div className="flex flex-col items-center">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            step.status === 'ok'
              ? 'bg-emerald-500'
              : step.status === 'fail'
                ? 'bg-rose-500'
                : 'bg-primary/70'
          }`}
        />
        <span className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-foreground">{step.title}</p>
          <time className="font-mono text-[11px] text-muted-text">
            {formatDateTime(step.timestamp)}
          </time>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-text">
          <span className={stepStatusClass(step.status)}>{step.status}</span>
          {duration ? <span>{duration}</span> : null}
          {step.detail ? <span>{step.detail}</span> : null}
        </div>
        {step.error ? (
          <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{step.error}</p>
        ) : null}
      </div>
    </li>
  )
}

type Props = {
  steps: JourneyStep[]
  loading: boolean
  kindFilter: TimelineKindGroup
  onKindFilterChange: (group: TimelineKindGroup) => void
  projectFilterId: number | null
  onClearProjectFilter: () => void
}

export function JourneyTimeline({
  steps,
  loading,
  kindFilter,
  onKindFilterChange,
  projectFilterId,
  onClearProjectFilter,
}: Props) {
  const filtered = steps.filter((step) => {
    if (kindFilter !== 'all' && kindGroup(step.kind) !== kindFilter) return false
    if (projectFilterId != null && step.source_id !== String(projectFilterId)) return false
    return true
  })

  return (
    <section className={cardPanel}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="m-0 text-sm font-semibold text-foreground">Full journey</h2>
          <p className="mt-0.5 text-xs text-muted-text">
            Steps ordered by timestamp (jobs, audit, survey, errors)
          </p>
        </div>
        {projectFilterId != null ? (
          <button type="button" className={`${btnBase} ${btnCompact}`} onClick={onClearProjectFilter}>
            Clear session filter (#{projectFilterId})
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {KIND_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`${btnCompact} rounded-lg border px-2.5 py-1 text-xs font-semibold ${
              kindFilter === g.id
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-surface-elevated text-muted-text hover:text-foreground'
            }`}
            onClick={() => onKindFilterChange(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-muted-text">Loading timeline…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-4 text-sm text-muted-text">
          {steps.length === 0 ? 'No journey steps for this user.' : 'No steps match the current filters.'}
        </p>
      ) : (
        <ol className="mt-4">
          {filtered.map((step) => (
            <TimelineStep key={step.id} step={step} />
          ))}
        </ol>
      )}
    </section>
  )
}
