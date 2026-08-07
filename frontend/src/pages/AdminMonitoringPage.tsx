import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Data } from 'plotly.js'
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
  Timer,
} from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { MonitoringResponse, MonitoringSnapshot } from '../api/types'
import { AdminDownloadCsvButton } from '../components/admin/AdminDownloadCsvButton'
import { PlotlyChart } from '../components/PlotlyChart'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { downloadCsv } from '../lib/downloadCsv'
import { btnBase, btnCompact, cardPanel } from '../lib/classes'
import { Navigate } from 'react-router-dom'

const POLL_MS = 5000

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exp
  return `${value.toFixed(value >= 10 || exp === 0 ? 0 : 1)} ${units[exp]}`
}

function formatRate(bps: number): string {
  return `${formatBytes(bps)}/s`
}

function formatAgo(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  const secs = Math.floor(ms / 1000)
  if (secs < 2) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

function UsageBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const tone =
    clamped >= 90
      ? 'bg-[var(--app-status-error-text)]'
      : clamped >= 75
        ? 'bg-[var(--app-status-warning-text)]'
        : 'bg-primary'
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${tone}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function sparklineData(
  history: MonitoringSnapshot[],
  pick: (s: MonitoringSnapshot) => number,
  name: string,
): Data[] {
  return [
    {
      type: 'scatter',
      mode: 'lines',
      name,
      x: history.map((s) => s.collected_at),
      y: history.map(pick),
      line: { width: 2, shape: 'spline' },
      fill: 'tozeroy',
      fillcolor: 'rgba(37, 99, 235, 0.08)',
      hovertemplate: '%{y:.2f}<extra></extra>',
    },
  ]
}

const sparkLayout = {
  margin: { l: 36, r: 8, t: 8, b: 28 },
  showlegend: false,
  xaxis: { showticklabels: false, showgrid: false, zeroline: false },
}

export function AdminMonitoringPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:monitoring')
  const [data, setData] = useState<MonitoringResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    setError(null)
    try {
      const response = await adminApi.getMonitoring()
      setData(response)
      setUpdatedAt(response.current.collected_at)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitoring data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    void load()
    const poll = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(poll)
  }, [load, canManage])

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const current = data?.current
  const history = data?.history ?? []
  void tick

  return (
    <div className="admin-fade-in space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Administration
          </p>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Monitoring
          </h1>
          <p className="m-0 max-w-xl text-muted-text leading-relaxed">
            Live server health, resource usage, API latency, and error rate for this API process.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-text">Updated {formatAgo(updatedAt)}</span>
          <AdminDownloadCsvButton
            onClick={async () => {
              setError(null)
              try {
                await downloadCsv(
                  () => adminApi.downloadMonitoringCsv(),
                  'monitoring_history.csv',
                )
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to download CSV')
              }
            }}
            disabled={loading}
          />
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
          label="Server uptime"
          value={loading || !current ? '—' : formatUptime(current.uptime_seconds)}
          hint="API process uptime"
          icon={Server}
        />
        <MetricCard
          label="CPU"
          value={loading || !current ? '—' : `${current.cpu_percent.toFixed(1)}%`}
          hint="Host CPU utilization"
          icon={Cpu}
          barPercent={current?.cpu_percent}
        />
        <MetricCard
          label="RAM"
          value={loading || !current ? '—' : `${current.memory.percent.toFixed(1)}%`}
          hint={
            current
              ? `${formatBytes(current.memory.used_bytes)} / ${formatBytes(current.memory.total_bytes)}`
              : 'Memory used'
          }
          icon={MemoryStick}
          barPercent={current?.memory.percent}
        />
        <MetricCard
          label="Disk"
          value={loading || !current ? '—' : `${current.disk.percent.toFixed(1)}%`}
          hint={
            current
              ? `${formatBytes(current.disk.used_bytes)} / ${formatBytes(current.disk.total_bytes)}`
              : 'Disk used'
          }
          icon={HardDrive}
          barPercent={current?.disk.percent}
        />
        <MetricCard
          label="Network"
          value={
            loading || !current
              ? '—'
              : `↓ ${formatRate(current.network.recv_rate_bps)}`
          }
          hint={
            current
              ? `↑ ${formatRate(current.network.sent_rate_bps)} · total ↓ ${formatBytes(current.network.bytes_recv)} ↑ ${formatBytes(current.network.bytes_sent)}`
              : 'Throughput'
          }
          icon={Network}
        />
        <MetricCard
          label="API latency"
          value={loading || !current ? '—' : `${current.api.avg_latency_ms.toFixed(1)} ms`}
          hint={
            current
              ? `p50 ${current.api.p50_latency_ms.toFixed(1)} · p95 ${current.api.p95_latency_ms.toFixed(1)} · ${current.api.requests_in_window} reqs`
              : 'Average response time'
          }
          icon={Timer}
        />
        <MetricCard
          label="Error rate"
          value={loading || !current ? '—' : `${current.api.error_rate_percent.toFixed(2)}%`}
          hint={
            current
              ? `5xx share over last ${current.api.requests_in_window} requests`
              : 'Server errors'
          }
          icon={Activity}
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="CPU history" empty={history.length < 2}>
          <PlotlyChart
            data={sparklineData(history, (s) => s.cpu_percent, 'CPU %')}
            layout={{
              ...sparkLayout,
              yaxis: { title: { text: '%' }, rangemode: 'tozero' },
            }}
            height={200}
            revision={history.length}
          />
        </ChartCard>
        <ChartCard title="RAM history" empty={history.length < 2}>
          <PlotlyChart
            data={sparklineData(history, (s) => s.memory.percent, 'RAM %')}
            layout={{
              ...sparkLayout,
              yaxis: { title: { text: '%' }, rangemode: 'tozero' },
            }}
            height={200}
            revision={history.length}
          />
        </ChartCard>
        <ChartCard title="API latency history" empty={history.length < 2}>
          <PlotlyChart
            data={sparklineData(history, (s) => s.api.avg_latency_ms, 'Latency ms')}
            layout={{
              ...sparkLayout,
              yaxis: { title: { text: 'ms' }, rangemode: 'tozero' },
            }}
            height={200}
            revision={history.length}
          />
        </ChartCard>
        <ChartCard title="Error rate history" empty={history.length < 2}>
          <PlotlyChart
            data={sparklineData(history, (s) => s.api.error_rate_percent, 'Errors %')}
            layout={{
              ...sparkLayout,
              yaxis: { title: { text: '%' }, rangemode: 'tozero' },
            }}
            height={200}
            revision={history.length}
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
  barPercent,
}: {
  label: string
  value: string
  hint: string
  icon: typeof Server
  barPercent?: number
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
      {barPercent != null && <UsageBar percent={barPercent} />}
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
          Collecting samples… charts appear after a few refreshes.
        </p>
      ) : (
        children
      )}
    </div>
  )
}
