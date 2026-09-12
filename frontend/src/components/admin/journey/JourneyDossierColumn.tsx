import type { ReactNode } from 'react'
import type { JourneyDossier, JourneySession } from '../../../api/types'
import { cardPanel } from '../../../lib/classes'
import { formatDateTime } from '../../../lib/formatDateTime'
import { pipelineBadgeClass, statusBadgeClass } from '../../../lib/projectLabels'

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem ? `${hours}h ${rem}m` : `${hours}h`
}

function Card({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: ReactNode
}) {
  return (
    <section className={cardPanel}>
      <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
      {sub ? <p className="mt-0.5 text-xs text-muted-text">{sub}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function priorityClass(priority: string): string {
  if (priority === 'high') return 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
  if (priority === 'med') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
  return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
}

type Props = {
  dossier: JourneyDossier
  onSelectSession: (session: JourneySession) => void
}

export function JourneyDossierColumn({ dossier, onSelectSession }: Props) {
  const { persona, profile, pipeline_mix, recent_sessions, usage, flags, actions } = dossier

  return (
    <div className="flex flex-col gap-3.5">
      {persona ? (
        <Card title="Persona classification" sub="Heuristic from email domain and profile survey">
          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <div className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-xl bg-violet-500/15 px-2 text-center text-[11px] font-bold text-violet-700 dark:text-violet-300">
              {persona.label}
            </div>
            <div className="flex flex-col gap-1.5">
              {persona.signals.map((s) => (
                <div
                  key={s.key}
                  className="flex justify-between gap-2 rounded-lg border border-border bg-surface/60 px-2.5 py-1.5 text-xs"
                >
                  <span className="text-muted-text">{s.key}</span>
                  <span
                    className={`text-right font-semibold ${s.positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}
                  >
                    {s.value}
                  </span>
                </div>
              ))}
              {persona.alts.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {persona.alts.map((alt) => (
                    <span
                      key={alt.label}
                      className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-text"
                    >
                      Alt: <strong className="font-semibold text-foreground/80">{alt.label}</strong>{' '}
                      {alt.score}%
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card title="Profile snapshot" sub="Onboarding survey fields">
        {profile ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['University', profile.university],
                ['Degree', profile.degree],
                ['Major', profile.major],
                ['MATLAB experience', profile.matlab_experience],
                ['Control experience', profile.control_design_experience],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-border bg-surface/60 px-2.5 py-2"
              >
                <div className="text-[10.5px] font-semibold text-muted-text">{label}</div>
                <div className="mt-0.5 text-sm font-semibold text-foreground">{value || '—'}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-text">Profile survey not completed.</p>
        )}
      </Card>

      <Card title="Recent sessions" sub="Click a session to filter the timeline">
        {recent_sessions.length === 0 ? (
          <p className="text-sm text-muted-text">No projects yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {recent_sessions.map((sess) => {
              const duration = formatDuration(sess.duration_seconds)
              return (
                <button
                  key={sess.id}
                  type="button"
                  className="flex w-full items-center gap-2 py-2.5 text-left first:pt-0 last:pb-0 hover:bg-surface-hover/50"
                  onClick={() => onSelectSession(sess)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-foreground">
                      {sess.title}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-text">
                      {formatDateTime(sess.updated_at)}
                      {duration ? ` · ${duration}` : ''}
                      {sess.tokens != null ? ` · ${sess.tokens} tok` : ''}
                    </div>
                  </div>
                  <span className={pipelineBadgeClass(sess.pipeline_type)}>{sess.pipeline}</span>
                  <div className="w-16 shrink-0 text-right">
                    <span className={statusBadgeClass(sess.status)}>{sess.status}</span>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-text">
                      {sess.score != null ? `${sess.score}%` : '—'}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      <Card title="Pipeline mix" sub="Share of design projects">
        <div className="flex flex-col gap-2">
          {pipeline_mix.map((row) => (
            <div key={row.pipeline_type} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2">
              <span className="text-xs font-semibold text-muted-text">{row.name}</span>
              <div className="h-1.5 overflow-hidden rounded bg-surface-muted">
                <div
                  className="h-full rounded bg-primary"
                  style={{ width: `${Math.min(100, row.pct)}%` }}
                />
              </div>
              <span className="text-right font-mono text-[11px] text-muted-text">{row.pct}%</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Usage & cost" sub="Lifetime credit sessions">
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-text">Token total</dt>
          <dd className="m-0 text-right font-mono text-foreground">
            {usage.tokens_total.toLocaleString()}
          </dd>
          <dt className="text-muted-text">Credits charged</dt>
          <dd className="m-0 text-right font-mono text-foreground">{usage.credits_charged}</dd>
          <dt className="text-muted-text">Avg credits / success</dt>
          <dd className="m-0 text-right font-mono text-foreground">
            {usage.avg_credits_per_success ?? '—'}
          </dd>
          <dt className="text-muted-text">API / backend errors</dt>
          <dd
            className={`m-0 text-right font-semibold ${usage.api_errors ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}
          >
            {usage.api_errors}
          </dd>
          <dt className="text-muted-text">Other errors</dt>
          <dd className="m-0 text-right font-semibold text-foreground">{usage.other_errors}</dd>
          <dt className="text-muted-text">Avg rating given</dt>
          <dd className="m-0 text-right font-semibold text-emerald-600 dark:text-emerald-400">
            {usage.avg_rating != null ? `${usage.avg_rating} / 5` : '—'}
          </dd>
        </dl>
      </Card>

      <Card title="Recommended actions" sub="Rule-based from usage signals">
        <div className="flex flex-col gap-2">
          {actions.map((action) => (
            <div
              key={action.title}
              className="flex gap-2.5 rounded-lg border border-border bg-surface/60 p-2.5"
            >
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${priorityClass(action.priority)}`}
              >
                {action.priority}
              </span>
              <div>
                <strong className="block text-[13px] font-semibold text-foreground">
                  {action.title}
                </strong>
                <span className="text-xs text-muted-text">{action.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Account flags" sub="Support & risk">
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-text">Email verified</dt>
          <dd
            className={`m-0 text-right font-semibold ${flags.email_verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}
          >
            {flags.email_verified ? 'Yes' : 'No'}
          </dd>
          <dt className="text-muted-text">Active</dt>
          <dd className="m-0 text-right font-semibold text-foreground">
            {flags.is_active ? 'Yes' : 'No'}
          </dd>
          <dt className="text-muted-text">Profile survey</dt>
          <dd className="m-0 text-right font-semibold text-foreground">
            {flags.profile_survey_complete ? 'Complete' : 'Missing'}
          </dd>
          <dt className="text-muted-text">Bug reports filed</dt>
          <dd className="m-0 text-right font-mono text-foreground">{flags.bug_report_count}</dd>
        </dl>
      </Card>
    </div>
  )
}
