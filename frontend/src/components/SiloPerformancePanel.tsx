import { useCallback, useEffect, useMemo, useState } from 'react'
import { projectsApi, siloApi } from '../api/endpoints'
import type { SiloSimulateResponse } from '../api/types'
import { PlotlyChart } from './PlotlyChart'
import { StatusMessage } from './StatusMessage'
import { buildSiloTimeResponseChart } from '../lib/siloPlotCharts'
import {
  buildMonitorSummary,
  getControllerType,
} from '../lib/monitorStateParser'
import { btnBase, cardPanel, mutedText } from '../lib/classes'

interface SiloPerformancePanelProps {
  jobId?: string | null
  projectId?: number | null
  currentState?: Record<string, unknown> | null
  /** Lock sliders while design optimization is running (Streamlit parity). */
  disabled?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function gainsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (Math.abs((a[key] ?? 0) - (b[key] ?? 0)) > 1e-6) return false
  }
  return true
}

export function SiloPerformancePanel({
  jobId,
  projectId,
  currentState,
  disabled = false,
}: SiloPerformancePanelProps) {
  const summary = useMemo(
    () => (currentState ? buildMonitorSummary(currentState) : null),
    [currentState],
  )
  const optimalGainsKey = JSON.stringify(summary?.params ?? {})
  const optimalGains = useMemo(
    () => summary?.params ?? {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optimalGainsKey],
  )
  const controllerType =
    summary?.controllerType
    ?? (currentState ? getControllerType(currentState) : 'Unknown')

  const [gains, setGains] = useState<Record<string, number>>(optimalGains)
  const [bounds, setBounds] = useState<Record<string, [number, number]>>({})
  const [result, setResult] = useState<SiloSimulateResponse | null>(null)
  const [testMode, setTestMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSimulate = Boolean(jobId || projectId)
  const hasGains = Object.keys(optimalGains).length > 0

  useEffect(() => {
    setGains(optimalGains)
    setTestMode(false)
    setResult(null)
    setError(null)
  }, [optimalGains])

  const runSimulation = useCallback(
    async (nextGains: Record<string, number>, asTest: boolean) => {
      if (!canSimulate || disabled) return
      setLoading(true)
      setError(null)
      try {
        const body = { gains: nextGains }
        let response: SiloSimulateResponse | null = null
        if (jobId) {
          try {
            response = await siloApi.simulate(jobId, body)
          } catch (jobErr) {
            if (!projectId) throw jobErr
          }
        }
        if (!response) {
          if (!projectId) {
            throw new Error('No job or project available for simulation')
          }
          response = await projectsApi.simulateSilo(projectId, body)
        }
        setResult(response)
        setBounds(response.param_bounds)
        setTestMode(asTest)
        if (!asTest) {
          setGains(response.optimal_gains)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Simulation failed')
      } finally {
        setLoading(false)
      }
    },
    [canSimulate, disabled, jobId, projectId],
  )

  useEffect(() => {
    if (!hasGains || !canSimulate || disabled) return
    void runSimulation(optimalGains, false)
    // Re-run when optimal gains identity changes (design finished / new best).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGains, canSimulate, disabled, optimalGainsKey, jobId, projectId])

  const updateGain = (name: string, value: number) => {
    setGains((prev) => ({ ...prev, [name]: value }))
  }

  const resetToOptimal = () => {
    const next = result?.optimal_gains ?? optimalGains
    setGains(next)
    void runSimulation(next, true)
  }

  const testCurrent = () => {
    void runSimulation(gains, true)
  }

  const chart = result ? buildSiloTimeResponseChart(result) : null
  const deltas =
    testMode && result
      ? Object.keys(gains)
          .map((key) => {
            const optimal = result.optimal_gains[key] ?? 0
            const diff = (gains[key] ?? 0) - optimal
            return Math.abs(diff) > 0.01 ? { key, diff } : null
          })
          .filter((item): item is { key: string; diff: number } => item !== null)
      : []

  if (!hasGains) {
    return (
      <p className={mutedText}>
        No controller gains available yet. Wait for the first successful simulation.
      </p>
    )
  }

  if (!canSimulate) {
    return (
      <p className={mutedText}>
        Gain simulation needs a live design job or saved project results.
      </p>
    )
  }

  const paramNames = Object.keys(gains).sort()

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,1fr)_2.5fr] gap-4">
      <div className={cardPanel}>
        <h4 className="mt-0 mb-2 text-foreground">Gain Controls</h4>
        <p className={`mt-0 mb-3 text-sm ${mutedText}`}>
          Controller: <strong className="text-foreground">{controllerType}</strong>
        </p>
        {disabled ? (
          <StatusMessage type="info" message="Sliders locked during optimization" />
        ) : (
          <StatusMessage type="success" message="Optimization complete — sliders active" />
        )}

        <div className="mt-4">
          {paramNames.map((name) => {
            const bound = bounds[name] ?? [0, 100]
            const min = Number(bound[0])
            const max = Number(bound[1])
            const value = clamp(Number(gains[name] ?? 0), min, max)
            const optimal = result?.optimal_gains[name] ?? optimalGains[name]
            const drifted =
              optimal !== undefined && Math.abs(value - optimal) > 0.01
            return (
              <label
                key={name}
                className="block mb-4 [&>input[type=range]]:accent-primary"
              >
                <span className="text-sm text-foreground-secondary">
                  {name}: {value.toFixed(2)}
                  {drifted ? ` (Optimal: ${Number(optimal).toFixed(2)})` : ''}
                </span>
                <input
                  type="range"
                  className="w-full"
                  min={min}
                  max={max}
                  step={0.01}
                  value={value}
                  disabled={disabled || loading}
                  onChange={(e) => updateGain(name, Number(e.target.value))}
                />
              </label>
            )
          })}
        </div>

        {!disabled && (
          <div className="flex flex-col gap-2 mt-2 sm:flex-row">
            <button
              type="button"
              className={`${btnBase} flex-1`}
              disabled={loading || !result}
              onClick={resetToOptimal}
            >
              Reset to Optimal
            </button>
            <button
              type="button"
              className={`${btnBase} flex-1`}
              disabled={loading}
              onClick={testCurrent}
            >
              Test Current
            </button>
          </div>
        )}

        {testMode && result && !gainsEqual(gains, result.optimal_gains) && (
          <p className={`mt-3 mb-0 text-sm ${mutedText}`}>Showing response with manual gains</p>
        )}
        {deltas.length > 0 && (
          <div className="mt-2 text-sm text-foreground-secondary">
            <div className="font-medium text-foreground">Δ from optimal</div>
            <ul className="mt-1 mb-0 pl-4">
              {deltas.map(({ key, diff }) => (
                <li key={key}>
                  {key}: {diff >= 0 ? '+' : ''}
                  {diff.toFixed(2)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {error && <StatusMessage type="error" message={error} />}
        {loading && <p className={mutedText}>Simulating system response...</p>}
        {chart && (
          <PlotlyChart
            data={chart.data}
            layout={chart.layout}
            height={520}
            revision={`${JSON.stringify(result?.manual_gains)}-${testMode}`}
          />
        )}
        {result?.optimal.metrics && (
          <div className={`${cardPanel} grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm`}>
            {(['mse', 'settling_time', 'overshoot', 'ss_error'] as const).map((key) => {
              const value = result.optimal.metrics[key]
              const label =
                key === 'settling_time'
                  ? 'Settling'
                  : key === 'ss_error'
                    ? 'SS Error'
                    : key.toUpperCase()
              return (
                <div key={key}>
                  <div className="text-xs uppercase tracking-wide text-label">{label}</div>
                  <div className="font-medium text-foreground">
                    {typeof value === 'number' && Number.isFinite(value)
                      ? value.toFixed(4)
                      : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
