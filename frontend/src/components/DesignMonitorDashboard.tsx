import { useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js'
import { PlotlyChart } from './PlotlyChart'
import {
  buildMonitorSummary,
  buildTimePoints,
  extractSimulationSteps,
  formatMetricValue,
  paramsSummary,
  type SimulationStep,
  type StateHistoryEntry,
} from '../lib/monitorStateParser'
import { badgeStyles, cardPanel, fieldInput, mutedText } from '../lib/classes'

interface DesignMonitorDashboardProps {
  stateHistory: StateHistoryEntry[]
  currentState?: Record<string, unknown> | null
}

const METRIC_COLORS = {
  mse: '#e45756',
  settling: '#4c78a8',
  overshoot: '#f58518',
  trajectory: '#e45756',
  control: '#f58518',
  error: '#72b7b2',
  target: '#54a24b',
} as const

const PARAM_COLORS = ['#4c78a8', '#f58518', '#e45756', '#72b7b2', '#b279a2', '#ff9da6']

export function DesignMonitorDashboard({
  stateHistory,
  currentState,
}: DesignMonitorDashboardProps) {
  const steps = useMemo(
    () => extractSimulationSteps(stateHistory, currentState),
    [stateHistory, currentState],
  )
  const summary = useMemo(
    () => buildMonitorSummary(currentState ?? null),
    [currentState],
  )
  const [selectedStep, setSelectedStep] = useState<number | null>(null)
  const [followLatest, setFollowLatest] = useState(true)

  useEffect(() => {
    if (followLatest) return
    if (selectedStep !== null && selectedStep >= steps.length) {
      setSelectedStep(steps.length - 1)
    }
  }, [steps.length, selectedStep, followLatest])

  useEffect(() => {
    if (followLatest && steps.length > 0) {
      setSelectedStep(steps.length - 1)
    }
  }, [followLatest, steps.length, steps.at(-1)?.metrics])

  const chartRevision =
    steps.length > 0 ? `${steps.length}-${JSON.stringify(steps.at(-1)?.metrics)}` : '0'

  const activeStepIndex =
    selectedStep !== null && selectedStep >= 0 && selectedStep < steps.length
      ? selectedStep
      : steps.length - 1

  const activeStep = steps[activeStepIndex]

  if (steps.length === 0) {
    return (
      <p className={mutedText}>
        No simulation metrics yet. Metrics and plots will appear after the first simulation run.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {summary && <SummaryCards summary={summary} stepCount={steps.length} />}

      <MetricsProgressPanel steps={steps} revision={chartRevision} />
      <ParametersPanel steps={steps} revision={chartRevision} />
      <SimulationPanel
        steps={steps}
        step={activeStep}
        stepIndex={activeStepIndex}
        revision={chartRevision}
        onSelectStep={(index) => {
          setFollowLatest(index === steps.length - 1)
          setSelectedStep(index)
        }}
      />
      <IterationsTable
        steps={steps}
        selectedIndex={activeStepIndex}
        onSelectStep={(index) => {
          setFollowLatest(index === steps.length - 1)
          setSelectedStep(index)
        }}
      />
    </div>
  )
}

function SummaryCards({
  summary,
  stepCount,
}: {
  summary: NonNullable<ReturnType<typeof buildMonitorSummary>>
  stepCount: number
}) {
  const stable = summary.metrics?.stable

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
      <MetricCard label="Iteration" value={`${summary.iteration} / ${summary.maxIterations}`} />
      <MetricCard
        label="Controller"
        value={summary.controllerType}
        hint={`${summary.currentControllerIndex + 1} of ${summary.controllersList.length || '?'}`}
      />
      <MetricCard
        label="Scenario"
        value={`${summary.scenarioLevel} / ${summary.maxScenarios}`}
      />
      <MetricCard
        label="Current MSE"
        value={formatMetricValue('mse', summary.metrics?.mse)}
      />
      <MetricCard
        label="Stable"
        value={stable === undefined ? '—' : stable ? 'Yes' : 'No'}
        tone={stable ? 'success' : stable === false ? 'error' : undefined}
      />
      <MetricCard label="Simulations" value={String(stepCount)} />
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'success' | 'error'
}) {
  const valueClass =
    tone === 'success'
      ? 'text-[var(--app-status-success-text)]'
      : tone === 'error'
        ? 'text-[var(--app-status-error-text)]'
        : 'text-foreground'

  return (
    <div className={`${cardPanel} px-4 py-3`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-label">{label}</div>
      <div className={`mt-1 text-xl font-bold ${valueClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-foreground-subtle">{hint}</div>}
    </div>
  )
}

function MetricsProgressPanel({
  steps,
  revision,
}: {
  steps: SimulationStep[]
  revision: string
}) {
  const x = steps.map((step) => step.globalStep)

  const traces: Data[] = [
    {
      x,
      y: steps.map((step) => step.metrics.mse ?? null) as (number | null)[],
      type: 'scatter',
      mode: 'lines+markers',
      name: 'MSE',
      line: { color: METRIC_COLORS.mse, width: 2 },
      marker: { size: 6 },
      xaxis: 'x',
      yaxis: 'y',
    },
    {
      x,
      y: steps.map((step) =>
        step.metrics.settling_time === null || step.metrics.settling_time === undefined
          ? null
          : step.metrics.settling_time,
      ) as (number | null)[],
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Settling',
      line: { color: METRIC_COLORS.settling, width: 2 },
      marker: { size: 6 },
      xaxis: 'x2',
      yaxis: 'y2',
    },
    {
      x,
      y: steps.map((step) => step.metrics.overshoot ?? null) as (number | null)[],
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Overshoot',
      line: { color: METRIC_COLORS.overshoot, width: 2 },
      marker: { size: 6 },
      xaxis: 'x3',
      yaxis: 'y3',
    },
  ]

  return (
    <section className={cardPanel}>
      <SectionHeader
        title="Performance Progress"
        subtitle="MSE, settling time, and overshoot across simulation steps"
      />
      <PlotlyChart
        data={traces}
        height={320}
        revision={revision}
        layout={{
          grid: { rows: 1, columns: 3, pattern: 'independent' },
          xaxis: { title: { text: 'Step' } },
          yaxis: { title: { text: 'MSE' } },
          xaxis2: { title: { text: 'Step' } },
          yaxis2: { title: { text: 'Settling (s)' } },
          xaxis3: { title: { text: 'Step' } },
          yaxis3: { title: { text: 'Overshoot (%)' } },
          showlegend: false,
        }}
      />
    </section>
  )
}

function ParametersPanel({
  steps,
  revision,
}: {
  steps: SimulationStep[]
  revision: string
}) {
  const paramNames = useMemo(() => {
    const names = new Set<string>()
    for (const step of steps) {
      for (const key of Object.keys(step.params)) names.add(key)
    }
    return [...names].sort()
  }, [steps])

  const traces: Data[] = paramNames.map((name, index) => ({
    x: steps.map((step) => step.globalStep),
    y: steps.map((step) => step.params[name] ?? null) as (number | null)[],
    type: 'scatter',
    mode: 'lines+markers',
    name,
    line: { color: PARAM_COLORS[index % PARAM_COLORS.length], width: 2 },
    marker: { size: 5 },
  }))

  if (paramNames.length === 0) return null

  return (
    <section className={cardPanel}>
      <SectionHeader
        title="Parameter History"
        subtitle="Controller gains proposed at each simulation step"
      />
      <PlotlyChart
        data={traces}
        height={320}
        revision={revision}
        layout={{
          xaxis: { title: { text: 'Simulation step' } },
          yaxis: { title: { text: 'Parameter value' } },
        }}
      />
    </section>
  )
}

function SimulationPanel({
  steps,
  step,
  stepIndex,
  revision,
  onSelectStep,
}: {
  steps: SimulationStep[]
  step: SimulationStep | undefined
  stepIndex: number
  revision: string
  onSelectStep: (index: number) => void
}) {
  if (!step) return null

  const timePoints = buildTimePoints(step.dt, step.maxTime, step.trajectory.length)
  const traces: Data[] = []

  if (step.trajectory.length > 0) {
    traces.push({
      x: timePoints,
      y: step.trajectory,
      type: 'scatter',
      mode: 'lines',
      name: 'Output',
      line: { color: METRIC_COLORS.trajectory, width: 2 },
      xaxis: 'x',
      yaxis: 'y',
    })
  }

  if (step.controlSignals.length > 0) {
    traces.push({
      x: buildTimePoints(step.dt, step.maxTime, step.controlSignals.length),
      y: step.controlSignals,
      type: 'scatter',
      mode: 'lines',
      name: 'Control',
      line: { color: METRIC_COLORS.control, width: 2 },
      xaxis: 'x2',
      yaxis: 'y2',
    })
  }

  if (step.errors.length > 0) {
    traces.push({
      x: buildTimePoints(step.dt, step.maxTime, step.errors.length),
      y: step.errors,
      type: 'scatter',
      mode: 'lines',
      name: 'Error',
      line: { color: METRIC_COLORS.error, width: 2, dash: 'dot' },
      xaxis: 'x',
      yaxis: 'y',
    })
  }

  return (
    <section className={cardPanel}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <SectionHeader
          title="Simulation Response"
          subtitle={`Step ${step.globalStep} · ${step.controllerType} · iteration ${step.iteration}`}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-label font-medium">View step</span>
          <select
            className={`${fieldInput} w-full min-w-0 sm:min-w-[220px] py-2`}
            value={stepIndex}
            onChange={(event) => onSelectStep(Number(event.target.value))}
          >
            {steps.map((item, index) => (
              <option key={`${item.globalStep}-${item.timestamp}`} value={index}>
                Step {item.globalStep} · {item.controllerType} · MSE{' '}
                {formatMetricValue('mse', item.metrics.mse)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
        {Object.entries(step.params).map(([key, value]) => (
          <div
            key={key}
            className="px-3 py-2 rounded-lg border border-param-border bg-param-bg"
          >
            <div className="text-[0.72rem] uppercase tracking-wide text-param-key">{key}</div>
            <div className="font-mono font-bold text-param-value">{value.toFixed(4)}</div>
          </div>
        ))}
      </div>

      <PlotlyChart
        data={traces}
        height={420}
        revision={`${revision}-${stepIndex}`}
        layout={{
          grid: { rows: 2, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
          xaxis: { title: { text: 'Time (s)' }, anchor: 'y' },
          yaxis: {
            title: { text: 'Output / Error' },
            domain: [0.55, 1],
          },
          xaxis2: { title: { text: 'Time (s)' }, anchor: 'y2' },
          yaxis2: {
            title: { text: 'Control input' },
            domain: [0, 0.45],
          },
          shapes: [
            {
              type: 'line',
              xref: 'x',
              yref: 'y',
              x0: timePoints[0] ?? 0,
              x1: timePoints[timePoints.length - 1] ?? step.maxTime,
              y0: step.target,
              y1: step.target,
              line: { color: METRIC_COLORS.target, dash: 'dash', width: 1.5 },
            },
          ],
          annotations: [
            {
              xref: 'paper',
              yref: 'y',
              x: 1,
              y: step.target,
              xanchor: 'right',
              text: `Target ${step.target}`,
              showarrow: false,
              font: { size: 11, color: METRIC_COLORS.target },
            },
          ],
        }}
      />
    </section>
  )
}

function IterationsTable({
  steps,
  selectedIndex,
  onSelectStep,
}: {
  steps: SimulationStep[]
  selectedIndex: number
  onSelectStep: (index: number) => void
}) {
  return (
    <section className={cardPanel}>
      <SectionHeader
        title="Simulation History"
        subtitle="Click a row to inspect trajectory and control signals"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-label">
              <th className="py-2 pr-3 font-semibold">Step</th>
              <th className="py-2 pr-3 font-semibold">Iter</th>
              <th className="py-2 pr-3 font-semibold">Controller</th>
              <th className="py-2 pr-3 font-semibold">Parameters</th>
              <th className="py-2 pr-3 font-semibold">MSE</th>
              <th className="py-2 pr-3 font-semibold">Settling</th>
              <th className="py-2 pr-3 font-semibold">Overshoot</th>
              <th className="py-2 pr-3 font-semibold">Stable</th>
              <th className="py-2 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, index) => {
              const isSelected = index === selectedIndex
              return (
                <tr
                  key={`${step.globalStep}-${step.timestamp}`}
                  className={`border-b border-border-subtle cursor-pointer transition-colors ${
                    isSelected ? 'bg-surface-hover' : 'hover:bg-surface-muted'
                  }`}
                  onClick={() => onSelectStep(index)}
                >
                  <td className="py-2.5 pr-3 font-medium text-primary">{step.globalStep}</td>
                  <td className="py-2.5 pr-3">{step.iteration}</td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[0.72rem] font-bold uppercase ${badgeStyles.strategy}`}
                    >
                      {step.controllerType}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs text-foreground-secondary max-w-[220px] truncate">
                    {paramsSummary(step.params)}
                  </td>
                  <td className="py-2.5 pr-3 font-mono">
                    {formatMetricValue('mse', step.metrics.mse)}
                  </td>
                  <td className="py-2.5 pr-3 font-mono">
                    {formatMetricValue('settling_time', step.metrics.settling_time)}
                  </td>
                  <td className="py-2.5 pr-3 font-mono">
                    {formatMetricValue('overshoot', step.metrics.overshoot)}
                  </td>
                  <td className="py-2.5 pr-3">
                    {step.metrics.stable ? (
                      <span className="text-[var(--app-status-success-text)]">Yes</span>
                    ) : (
                      <span className="text-[var(--app-status-error-text)]">No</span>
                    )}
                  </td>
                  <td className="py-2.5 font-mono text-xs text-foreground-subtle">
                    {step.timestamp || '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3 className="m-0 text-base font-semibold text-foreground">{title}</h3>
      {subtitle && <p className="mt-1 mb-0 text-sm text-muted-text">{subtitle}</p>}
    </div>
  )
}
