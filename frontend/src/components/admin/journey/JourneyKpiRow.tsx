import type { ReactNode } from 'react'
import type { JourneyKpis } from '../../../api/types'
import { cardPanel } from '../../../lib/classes'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem ? `${hours}h ${rem}m` : `${hours}h`
}

type TileProps = {
  label: string
  value: ReactNode
  sub: string
  tone?: 'good' | 'info' | 'warn' | 'muted'
}

function Tile({ label, value, sub, tone = 'muted' }: TileProps) {
  const bar =
    tone === 'good'
      ? 'bg-emerald-500'
      : tone === 'info'
        ? 'bg-primary'
        : tone === 'warn'
          ? 'bg-amber-500'
          : 'bg-border'
  return (
    <div className={`${cardPanel} relative overflow-hidden !p-3`}>
      <span className={`absolute inset-x-0 top-0 h-0.5 ${bar}`} />
      <div className="text-[11px] font-semibold text-muted-text">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold text-foreground">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-text">{sub}</div>
    </div>
  )
}

type Props = { kpis: JourneyKpis }

export function JourneyKpiRow({ kpis }: Props) {
  const errorSources = Object.entries(kpis.error_by_source)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ')

  return (
    <section className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        label="Sessions"
        value={kpis.sessions}
        sub={`${kpis.sessions_completed} completed · ${kpis.sessions_abandoned} abandoned`}
        tone="good"
      />
      <Tile
        label="Success rate"
        value={
          kpis.success_rate != null ? (
            <>
              {kpis.success_rate}
              <span className="ml-0.5 text-xs font-sans font-medium text-muted-text">%</span>
            </>
          ) : (
            '—'
          )
        }
        sub={
          kpis.sessions
            ? `${kpis.sessions_completed} / ${kpis.sessions_completed + kpis.sessions_abandoned} terminal`
            : 'No terminal sessions'
        }
        tone="good"
      />
      <Tile
        label="Avg score"
        value={kpis.avg_score ?? '—'}
        sub={
          kpis.best_score != null
            ? `best ${kpis.best_score} · worst ${kpis.worst_score}`
            : 'No scores yet'
        }
        tone="info"
      />
      <Tile
        label="Tokens (life)"
        value={
          <>
            {formatTokens(kpis.tokens_total)}
            <span className="ml-1 text-xs font-sans font-medium text-muted-text">
              {kpis.credits_charged > 0 ? `${kpis.credits_charged} cr` : ''}
            </span>
          </>
        }
        sub="Lifetime credit sessions"
        tone="info"
      />
      <Tile
        label="Errors"
        value={kpis.error_count}
        sub={errorSources || 'None recorded'}
        tone={kpis.error_count > 0 ? 'warn' : 'muted'}
      />
      <Tile
        label="Time in product"
        value={kpis.time_seconds > 0 ? formatDuration(kpis.time_seconds) : '—'}
        sub={
          kpis.median_session_seconds != null
            ? `median session ${formatDuration(kpis.median_session_seconds)}`
            : 'No duration data'
        }
        tone="muted"
      />
    </section>
  )
}
