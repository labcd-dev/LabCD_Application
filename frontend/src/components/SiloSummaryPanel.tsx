import { useMemo } from 'react'
import {
  extractScenarioBestResults,
  hasBestControllerData,
} from '../lib/bestControllers'
import {
  formatMetricValue,
  getControllerType,
  type StateHistoryEntry,
} from '../lib/monitorStateParser'
import {
  parseScenarioMetricsHistory,
  type ScenarioMetricsEntry,
} from '../lib/scenarioMetrics'
import { cardPanel, mutedText } from '../lib/classes'
import { BestControllersPanel } from './BestControllersPanel'
import { ComputationalProfilingPanel } from './ComputationalProfilingPanel'
import { StatusMessage } from './StatusMessage'

interface SiloSummaryPanelProps {
  scenarioMetricsHistory: unknown
  currentState?: Record<string, unknown> | null
  stateHistory?: StateHistoryEntry[] | unknown
  isRunning?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function SiloSummaryPanel({
  scenarioMetricsHistory,
  currentState,
  stateHistory,
  isRunning = false,
}: SiloSummaryPanelProps) {
  const history = useMemo(
    () => parseScenarioMetricsHistory(scenarioMetricsHistory),
    [scenarioMetricsHistory],
  )
  const bestResults = useMemo(
    () => extractScenarioBestResults(currentState, stateHistory),
    [currentState, stateHistory],
  )
  const showBestControllers = hasBestControllerData(bestResults) && !isRunning

  if (!currentState && history.length === 0) {
    return (
      <p className={mutedText}>
        No active design session. Start a run to see metrics.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {showBestControllers && (
        <StatusMessage
          type="success"
          message="Design complete! Export-ready best controller parameters are below."
        />
      )}

      {currentState && (
        <StatusRow
          state={currentState}
          history={history}
          isRunning={isRunning}
        />
      )}

      {currentState && <SimulationConfig state={currentState} />}

      <ComputationalProfilingPanel scenarioMetricsHistory={scenarioMetricsHistory} />

      {showBestControllers && (
        <BestControllersPanel
          currentState={currentState}
          stateHistory={stateHistory}
        />
      )}
    </div>
  )
}

function StatusRow({
  state,
  history,
  isRunning,
}: {
  state: Record<string, unknown>
  history: ScenarioMetricsEntry[]
  isRunning: boolean
}) {
  const last = history.length > 0 ? history[history.length - 1] : null
  const results = asRecord(state.results)
  const metrics = asRecord(results?.metrics)
  const mse = metrics?.mse

  if (last && !isRunning) {
    const controller =
      last.metrics.controller_type || getControllerType(state) || '—'
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Last Scenario" value={String(last.scenario_level)} />
        <MetricCard label="Status" value="Completed" />
        <MetricCard label="Controller" value={controller} />
        <MetricCard
          label="Final MSE"
          value={formatMetricValue('mse', typeof mse === 'number' ? mse : undefined)}
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MetricCard label="Iteration" value={String(asNumber(state.iteration, 0))} />
      <MetricCard
        label="Scenario Level"
        value={String(asNumber(state.scenario_level, 0))}
      />
      <MetricCard label="Current Controller" value={getControllerType(state)} />
      <MetricCard
        label="Current MSE"
        value={formatMetricValue('mse', typeof mse === 'number' ? mse : undefined)}
      />
    </div>
  )
}

function SimulationConfig({ state }: { state: Record<string, unknown> }) {
  const minCtrl = asNumber(state.min_ctrl, -10)
  const maxCtrl = asNumber(state.max_ctrl, 10)

  return (
    <div>
      <h3 className="m-0 mb-3 text-base font-semibold text-foreground">
        Simulation Configuration
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-3">
          <MetricCard
            label="Sample Time (dt)"
            value={`${asNumber(state.dt, 0.01).toFixed(3)} s`}
          />
          <MetricCard
            label="Target Setpoint"
            value={asNumber(state.target, 0).toFixed(2)}
          />
          <MetricCard label="Min Control" value={minCtrl.toFixed(2)} />
        </div>
        <div className="space-y-3">
          <MetricCard
            label="Max Time"
            value={`${asNumber(state.max_time, 5).toFixed(1)} s`}
          />
          <MetricCard
            label="Input Channel"
            value={String(asNumber(state.input_channel, 0))}
          />
          <MetricCard label="Max Control" value={maxCtrl.toFixed(2)} />
        </div>
        <div className="space-y-3">
          <MetricCard
            label="Number of Inputs"
            value={String(asNumber(state.num_inputs, 1))}
          />
          <MetricCard
            label="Output Channel"
            value={String(asNumber(state.output_channel, 0))}
          />
        </div>
      </div>
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
