import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Data } from 'plotly.js'
import {
  BarChart3,
  CalendarDays,
  RefreshCw,
  Repeat2,
  Users,
} from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { adminApi } from '../api/endpoints'
import type { AnalyticsResponse } from '../api/types'
import { PlotlyChart } from '../components/PlotlyChart'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { btnBase, btnCompact, cardPanel } from '../lib/classes'

const RANGE_OPTIONS = [7, 30, 90] as const

const MODULE_LABELS: Record<string, string> = {
  silo: 'Silo',
  mulo: 'Mulo',
  recommender: 'Recommender',
  trimmer: 'Trimmer',
  regularize: 'Regularizer',
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function formatCount(value: number | undefined, loading: boolean): string {
  if (loading || value == null) return '—'
  return value.toLocaleString()
}

export function AdminAnalyticsPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:analytics')
  const [days, setDays] = useState<(typeof RANGE_OPTIONS)[number]>(30)
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true)
      setError(null)
      try {
        const response = await adminApi.getAnalytics(days)
        setData(response)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load analytics')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [days],
  )

  useEffect(() => {
    if (!canManage) return
    setLoading(true)
    void load()
  }, [load, canManage])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const dauSeries = data?.dau_series ?? []
  const mauSeries = data?.mau_series ?? []
  const modules = data?.modules ?? []

  const activityChart: Data[] = [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'DAU',
      x: dauSeries.map((p) => p.date),
      y: dauSeries.map((p) => p.count),
      line: { width: 2, shape: 'spline' },
      hovertemplate: '%{x}<br>DAU: %{y}<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'MAU (trailing 30d)',
      x: mauSeries.map((p) => p.date),
      y: mauSeries.map((p) => p.count),
      line: { width: 2, shape: 'spline' },
      hovertemplate: '%{x}<br>MAU: %{y}<extra></extra>',
    },
  ]

  const moduleChart: Data[] = [
    {
      type: 'bar',
      name: 'Runs',
      x: modules.map((m) => MODULE_LABELS[m.module] ?? m.module),
      y: modules.map((m) => m.count),
      hovertemplate: '%{x}: %{y}<extra></extra>',
    },
  ]

  return (
    <div className="admin-fade-in space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Administration
          </p>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Analytics
          </h1>
          <p className="m-0 max-w-xl text-muted-text leading-relaxed">
            Daily and monthly active users, retention, and most-used product modules.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${btnCompact} border-0 ${
                  days === option
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-text hover:bg-surface-muted'
                }`}
                onClick={() => setDays(option)}
                disabled={loading || refreshing}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${btnBase} ${btnCompact}`}
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      </header>

      {error && <StatusMessage type="error" message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Daily active users"
          value={formatCount(data?.dau_today, loading)}
          hint="Distinct users active today (UTC)"
          icon={Users}
        />
        <MetricCard
          label="Monthly active users"
          value={formatCount(data?.mau, loading)}
          hint="Distinct users in last 30 days"
          icon={CalendarDays}
        />
        <MetricCard
          label="D7 retention"
          value={loading ? '—' : formatPercent(data?.retention_d7)}
          hint="Cohort return rate on/after day 7"
          icon={Repeat2}
        />
        <MetricCard
          label="D30 retention"
          value={loading ? '—' : formatPercent(data?.retention_d30)}
          hint="Cohort return rate on/after day 30"
          icon={BarChart3}
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Active users" empty={!loading && dauSeries.length === 0}>
          <PlotlyChart
            data={activityChart}
            layout={{
              margin: { l: 40, r: 12, t: 12, b: 40 },
              legend: { orientation: 'h', y: 1.15 },
              xaxis: { title: { text: 'Date' } },
              yaxis: { title: { text: 'Users' }, rangemode: 'tozero' },
            }}
            height={280}
            revision={dauSeries.length + mauSeries.length}
          />
        </ChartCard>
        <ChartCard title="Most used modules" empty={!loading && modules.length === 0}>
          <PlotlyChart
            data={moduleChart}
            layout={{
              margin: { l: 40, r: 12, t: 12, b: 60 },
              showlegend: false,
              xaxis: { title: { text: 'Module' } },
              yaxis: { title: { text: 'Runs' }, rangemode: 'tozero' },
            }}
            height={280}
            revision={modules.length}
          />
        </ChartCard>
      </section>
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string
  hint: string
  icon: typeof Users
}) {
  return (
    <div
      className={`${cardPanel} relative overflow-hidden transition-transform duration-200 hover:-translate-y-0.5`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {value}
          </div>
          <div className="mt-1 text-sm text-muted-text">{hint}</div>
        </div>
        <div className="rounded-xl bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] p-2.5 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
      </div>
    </div>
  )
}

function ChartCard({
  title,
  empty,
  children,
}: {
  title: string
  empty: boolean
  children: ReactNode
}) {
  return (
    <div className={cardPanel}>
      <h2 className="m-0 mb-2 text-sm font-semibold text-foreground">{title}</h2>
      {empty ? (
        <p className="m-0 py-12 text-center text-sm text-muted-text">
          No data yet for this range. Metrics start after users are active or modules run.
        </p>
      ) : (
        children
      )}
    </div>
  )
}
