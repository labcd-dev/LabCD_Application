import { useCallback, useEffect, useMemo, useState } from 'react'
import { muloApi } from '../api/endpoints'
import type { MuloDesignerStateResponse, MuloSimulateResponse } from '../api/types'
import { PlotlyChart } from './PlotlyChart'
import { StatusMessage } from './StatusMessage'
import { buildPerformanceChart } from '../lib/muloPlotCharts'
import { btnBase, cardPanel, fieldInput, fieldLabel, mutedText } from '../lib/classes'

const SIGNAL_TYPES = ['Step', 'Ramp', 'Sine'] as const

interface MuloPerformancePanelProps {
  jobId: string
  designerState: MuloDesignerStateResponse
}

function activeController(designerState: MuloDesignerStateResponse): Record<string, unknown> | null {
  const structure = designerState.modified_controller_structure.length
    ? designerState.modified_controller_structure
    : designerState.controller_structure
  const contIndex = Math.max(0, designerState.controller_index - 1)
  const loop = structure[contIndex] as { controllers?: Array<Record<string, unknown>> } | undefined
  return loop?.controllers?.[0] ?? null
}

function targetAmplitudeBounds(controller: Record<string, unknown> | null): {
  min: number
  max: number
  defaultValue: number
} {
  const target = (controller?.target as Record<string, unknown> | undefined) ?? {}
  const min = Number(target.min_value ?? -1)
  const max = Number(target.max_value ?? 1)
  // Match Streamlit/backend generate_target default used in PR #11.
  const defaultValue = Math.min(max, Math.max(min, 0.1))
  return { min, max, defaultValue }
}

export function MuloPerformancePanel({ jobId, designerState }: MuloPerformancePanelProps) {
  const bounds = designerState.pid_gain_bounds
  const initialGains = designerState.pid_gains
  const amplitudeBounds = useMemo(
    () => targetAmplitudeBounds(activeController(designerState)),
    [designerState],
  )

  const [kp, setKp] = useState(initialGains.Kp)
  const [ki, setKi] = useState(initialGains.Ki)
  const [kd, setKd] = useState(initialGains.Kd)
  const [amplitude, setAmplitude] = useState(amplitudeBounds.defaultValue)
  const [modifiedCode, setModifiedCode] = useState(designerState.modified_code)
  const [modifiedStructure, setModifiedStructure] = useState(
    designerState.modified_controller_structure,
  )
  const [simulations, setSimulations] = useState<Record<string, MuloSimulateResponse>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setKp(initialGains.Kp)
    setKi(initialGains.Ki)
    setKd(initialGains.Kd)
    setAmplitude(amplitudeBounds.defaultValue)
    setModifiedCode(designerState.modified_code)
    setModifiedStructure(designerState.modified_controller_structure)
    setSimulations({})
  }, [designerState, initialGains.Kd, initialGains.Ki, initialGains.Kp, amplitudeBounds.defaultValue])

  const runSimulations = useCallback(
    async (nextKp: number, nextKi: number, nextKd: number, nextAmplitude: number) => {
      setLoading(true)
      setError(null)
      try {
        const results: Record<string, MuloSimulateResponse> = {}
        for (const signalType of SIGNAL_TYPES) {
          results[signalType] = await muloApi.simulate(jobId, {
            kp: nextKp,
            ki: nextKi,
            kd: nextKd,
            signal_type: signalType,
            amplitude: nextAmplitude,
          })
        }
        setSimulations(results)
        if (results.Step?.code) {
          setModifiedCode(results.Step.code)
        }
        return results
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Simulation failed')
        return null
      } finally {
        setLoading(false)
      }
    },
    [jobId],
  )

  useEffect(() => {
    if (designerState.controller_designed) {
      void runSimulations(
        initialGains.Kp,
        initialGains.Ki,
        initialGains.Kd,
        amplitudeBounds.defaultValue,
      )
    }
    // Only re-run when designer state identity changes, not on slider moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designerState.job_id, designerState.controller_index, designerState.controller_designed])

  const applyGains = async () => {
    const updatedStructure = modifiedStructure.map((loop, index) => {
      const activeIndex = Math.max(0, designerState.controller_index - 1)
      if (index !== activeIndex) return loop
      const controllers = [...((loop.controllers as Array<Record<string, unknown>>) ?? [])]
      if (controllers[0]) {
        controllers[0] = { ...controllers[0], kp, ki, kd }
      }
      return { ...loop, controllers }
    })
    setModifiedStructure(updatedStructure)
    const simResult = await runSimulations(kp, ki, kd, amplitude)
    const nextCode = simResult?.Step?.code ?? modifiedCode
    setModifiedCode(nextCode)
    await muloApi.scratchpad(jobId, {
      modified_code: nextCode,
      modified_controller_structure: updatedStructure,
    })
  }

  const resetGains = () => {
    setKp(initialGains.Kp)
    setKi(initialGains.Ki)
    setKd(initialGains.Kd)
    setAmplitude(amplitudeBounds.defaultValue)
    setModifiedCode(designerState.modified_code)
    setModifiedStructure(designerState.modified_controller_structure)
    void runSimulations(
      initialGains.Kp,
      initialGains.Ki,
      initialGains.Kd,
      amplitudeBounds.defaultValue,
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,1fr)_2.5fr] gap-4">
      <div className={cardPanel}>
        <h4 className="mt-0 mb-3 text-foreground">PID Gain Sliders</h4>
        <label className={`${fieldLabel} mb-4`}>
          <span>Test Signal Amplitude</span>
          <input
            type="number"
            className={fieldInput}
            min={amplitudeBounds.min}
            max={amplitudeBounds.max}
            step={0.01}
            value={amplitude}
            onChange={(e) => setAmplitude(Number(e.target.value))}
          />
        </label>
        <GainSlider
          label="Proportional Gain (Kp)"
          value={kp}
          bound={bounds.Kp}
          onChange={setKp}
        />
        <GainSlider
          label="Integral Gain (Ki)"
          value={ki}
          bound={bounds.Ki}
          onChange={setKi}
        />
        <GainSlider
          label="Derivative Gain (Kd)"
          value={kd}
          bound={bounds.Kd}
          onChange={setKd}
        />

        <div className="flex flex-col gap-2 mt-4">
          <button type="button" className={btnBase} disabled={loading} onClick={() => void applyGains()}>
            Apply New Values To Controller
          </button>
          <button type="button" className={btnBase} disabled={loading} onClick={resetGains}>
            Reset To Original Values
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {error && <StatusMessage type="error" message={error} />}
        {loading && <p className={mutedText}>Simulating system response...</p>}

        {SIGNAL_TYPES.map((signalType) => {
          const result = simulations[signalType]
          if (!result) return null
          const chart = buildPerformanceChart(
            result.time,
            result.actual,
            result.reference,
            result.signal_type,
            result.y_label,
            result.unit,
          )
          return (
            <PlotlyChart
              key={signalType}
              data={chart.data}
              layout={chart.layout}
              height={380}
              revision={`${kp}-${ki}-${kd}-${amplitude}-${signalType}`}
            />
          )
        })}
      </div>
    </div>
  )
}

function GainSlider({
  label,
  value,
  bound,
  onChange,
}: {
  label: string
  value: number
  bound: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block mb-4 [&>input[type=range]]:accent-primary">
      <span className="text-sm text-foreground-secondary">
        {label}: {value.toFixed(2)}
      </span>
      <input
        type="range"
        className="w-full"
        min={-bound}
        max={bound}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
