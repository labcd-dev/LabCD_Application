import { useMemo } from 'react'
import {
  buildDevOpsKpiRows,
  buildSessionProfilingSummary,
  buildTokenCostRows,
  formatCost,
  formatScorePercent,
  formatSeconds,
  parseScenarioMetricsHistory,
} from '../lib/scenarioMetrics'
import { badgeStyles, cardPanel, mutedText } from '../lib/classes'

interface ComputationalProfilingPanelProps {
  scenarioMetricsHistory: unknown
}

export function ComputationalProfilingPanel({
  scenarioMetricsHistory,
}: ComputationalProfilingPanelProps) {
  const history = useMemo(
    () => parseScenarioMetricsHistory(scenarioMetricsHistory),
    [scenarioMetricsHistory],
  )
  const summary = useMemo(() => buildSessionProfilingSummary(history), [history])
  const kpiRows = useMemo(() => buildDevOpsKpiRows(history), [history])
  const tokenRows = useMemo(() => buildTokenCostRows(history), [history])

  if (history.length === 0) {
    return (
      <p className={mutedText}>No profiling data yet. Run a scenario to see metrics.</p>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="m-0 mb-3 text-base font-semibold text-foreground">
          Computational Profiling
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
          <MetricCard
            label="Scenarios Completed"
            value={`${summary.nSuccessful} / ${summary.nTotal}`}
          />
          <MetricCard
            label="Avg Success Score"
            value={formatScorePercent(summary.avgSuccessScore)}
          />
          <MetricCard label="Total API Failures" value={String(summary.totalApiFails)} />
          <MetricCard
            label="Avg Cost / Success"
            value={formatCost(summary.avgCostPerSuccess)}
          />
          <MetricCard label="Total Tokens In" value={String(summary.totalTokensIn)} />
          <MetricCard label="Total Tokens Out" value={String(summary.totalTokensOut)} />
          <MetricCard
            label="Total Wall-Clock Time"
            value={formatSeconds(summary.totalTime)}
          />
          <MetricCard label="Total Cost" value={formatCost(summary.totalCost)} />
        </div>
      </div>

      <section className={`${cardPanel} overflow-x-auto p-0`}>
        <div className="border-b border-border px-4 py-3">
          <h4 className="m-0 text-sm font-semibold text-foreground">
            Per-Scenario DevOps KPIs
          </h4>
        </div>
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-semibold">Level</th>
              <th className="px-4 py-2.5 font-semibold">Controller</th>
              <th className="px-4 py-2.5 font-semibold">Stable</th>
              <th className="px-4 py-2.5 font-semibold">Score</th>
              <th className="px-4 py-2.5 font-semibold">Latency (s)</th>
              <th className="px-4 py-2.5 font-semibold">API Fails</th>
              <th className="px-4 py-2.5 font-semibold">$/Success</th>
            </tr>
          </thead>
          <tbody>
            {kpiRows.map((row) => (
              <tr
                key={`kpi-${row.level}`}
                className="border-b border-border-subtle last:border-0"
              >
                <td className="px-4 py-2.5 text-foreground">{row.level}</td>
                <td className="px-4 py-2.5 text-foreground">{row.controller}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                      row.stable ? badgeStyles.continue : badgeStyles.terminate
                    }`}
                  >
                    {row.stable ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-foreground">
                  {formatScorePercent(row.score)}
                </td>
                <td className="px-4 py-2.5 text-foreground">{row.latency.toFixed(1)}</td>
                <td className="px-4 py-2.5 text-foreground">{row.apiFails}</td>
                <td className="px-4 py-2.5 text-foreground">
                  {formatCost(row.costPerSuccess)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${cardPanel} overflow-x-auto p-0`}>
        <div className="border-b border-border px-4 py-3">
          <h4 className="m-0 text-sm font-semibold text-foreground">
            Per-Scenario Token &amp; Cost Breakdown
          </h4>
        </div>
        <table className="w-full min-w-[480px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-semibold">Level</th>
              <th className="px-4 py-2.5 font-semibold">Tokens In</th>
              <th className="px-4 py-2.5 font-semibold">Tokens Out</th>
              <th className="px-4 py-2.5 font-semibold">Time (s)</th>
              <th className="px-4 py-2.5 font-semibold">Cost ($)</th>
            </tr>
          </thead>
          <tbody>
            {tokenRows.map((row) => (
              <tr
                key={`token-${row.level}`}
                className="border-b border-border-subtle last:border-0"
              >
                <td className="px-4 py-2.5 text-foreground">{row.level}</td>
                <td className="px-4 py-2.5 text-foreground">{row.tokensIn}</td>
                <td className="px-4 py-2.5 text-foreground">{row.tokensOut}</td>
                <td className="px-4 py-2.5 text-foreground">{row.time.toFixed(1)}</td>
                <td className="px-4 py-2.5 text-foreground">{formatCost(row.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${cardPanel} px-4 py-3`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-label">{label}</div>
      <div className="mt-1 text-xl font-bold text-foreground">{value}</div>
    </div>
  )
}
