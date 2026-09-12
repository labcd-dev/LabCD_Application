import { Link } from 'react-router-dom'
import type { JourneyDossier, JourneyUser } from '../../../api/types'
import { btnBase, btnCompact, btnPrimary, cardPanel } from '../../../lib/classes'
import { formatDateTime } from '../../../lib/formatDateTime'

function initials(name: string | null, email: string): string {
  const base = (name || email).trim()
  const parts = base.split(/[\s@.]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return base.slice(0, 2).toUpperCase()
}

function healthClass(health: JourneyDossier['health']): string {
  if (health === 'good') return 'text-emerald-600 dark:text-emerald-400'
  if (health === 'at_risk') return 'text-rose-600 dark:text-rose-400'
  return 'text-muted-text'
}

type Props = {
  user: JourneyUser
  dossier: JourneyDossier
}

export function JourneyHero({ user, dossier }: Props) {
  const name = user.display_name || user.email
  return (
    <section className={`${cardPanel} grid gap-4 sm:grid-cols-[1fr_auto]`}>
      <div className="flex min-w-0 gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/80 to-indigo-600 text-lg font-bold text-white">
          {initials(user.display_name, user.email)}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-lg font-semibold tracking-tight text-foreground">{name}</h2>
            {dossier.persona ? (
              <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                {dossier.persona.label}
                {dossier.persona.score > 0 ? (
                  <span className="ml-1 font-mono opacity-80">{dossier.persona.score}%</span>
                ) : null}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-xs text-muted-text">
            {user.email} · usr_{user.id}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-text">
            {dossier.joined_at ? <span>Joined {formatDateTime(dossier.joined_at)}</span> : null}
            {dossier.last_active_at ? (
              <span>Last active {formatDateTime(dossier.last_active_at)}</span>
            ) : null}
            {dossier.plan_name ? <span>Plan · {dossier.plan_name}</span> : null}
          </div>
          {dossier.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {dossier.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted-text"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <div className="text-[11px] font-semibold tracking-wide text-muted-text uppercase">
          Account health
        </div>
        <div className={`font-mono text-xl font-bold capitalize ${healthClass(dossier.health)}`}>
          {dossier.health === 'at_risk' ? 'At risk' : dossier.health}
        </div>
        <p className="max-w-[220px] text-xs text-muted-text sm:text-right">{dossier.health_detail}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Link to={`/admin/users/${user.id}`} className={`${btnBase} ${btnCompact}`}>
            User detail
          </Link>
          {dossier.latest_project_id != null ? (
            <Link
              to={`/admin/projects/${dossier.latest_project_id}`}
              className={`${btnPrimary} ${btnCompact}`}
            >
              Open latest project
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
