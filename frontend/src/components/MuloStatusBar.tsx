import type { MuloPlotData, MuloRunConfig } from '../lib/muloDesignConfig'
import { latestPlotMetrics } from '../lib/muloPlotCharts'

interface MuloStatusBarProps {
  plotData: MuloPlotData | null
  runConfig?: MuloRunConfig | null
  isRunning: boolean
  isDone: boolean
  isFailed: boolean
}

export function MuloStatusBar({
  plotData,
  runConfig,
  isRunning,
  isDone,
  isFailed,
}: MuloStatusBarProps) {
  const metrics = latestPlotMetrics(plotData)

  const statusLabel = isFailed
    ? 'Failed'
    : isRunning
      ? 'Running…'
      : isDone
        ? 'Complete'
        : 'Waiting…'

  const statusClass = isFailed
    ? 'bg-[var(--app-status-error-bg)] text-[var(--app-status-error-text)]'
    : isRunning
      ? 'bg-[#FF9800] text-white'
      : isDone
        ? 'bg-[#4CAF50] text-white'
        : 'bg-muted text-foreground-secondary'

  const configChips = runConfig
    ? [
        ['Model', runConfig.llm_model],
        ['Max Attempts', String(runConfig.max_attempts)],
        ['Wall Clock', `${runConfig.max_wall_clock} s`],
        ['Cost Budget', `$${runConfig.max_cost_budget.toFixed(3)}`],
        ['Variant', runConfig.prompt_variant],
      ]
    : []

  return (
    <div className="flex flex-col gap-4">
      {configChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {configChips.map(([label, value]) => (
            <span
              key={label}
              className="inline-flex items-center rounded-md border border-border bg-surface-elevated px-2.5 py-1 text-xs font-medium text-foreground-secondary"
            >
              {label}: {value}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className={`rounded-md px-3 py-2 text-center text-sm font-semibold ${statusClass}`}>
          {statusLabel}
        </div>
        <MetricCard label="Attempt" value={metrics.attempt ?? '—'} />
        <MetricCard
          label="Cumulative NFE"
          value={metrics.nfe !== null ? metrics.nfe.toLocaleString() : '—'}
        />
        <MetricCard
          label="Best Baseline Cost"
          value={metrics.bestCost !== null ? metrics.bestCost.toFixed(4) : '—'}
        />
        <MetricCard
          label="Success Score"
          value={metrics.successScore !== null ? `${metrics.successScore}/100` : '—'}
        />
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-xs text-foreground-secondary">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  )
}
