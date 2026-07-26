import { useEffect, useMemo, useState } from 'react'
import type { MuloLoopMetrics, MuloPidLoop } from '../lib/muloDesignConfig'
import { StatusMessage } from './StatusMessage'
import { btnBase, btnPrimary, cardPanel, fieldInput, fieldLabel } from '../lib/classes'

interface MuloCaseStudyEditorProps {
  controllerStructure: MuloPidLoop[]
  simulationParams: { dt: number; max_time: number }
  loopIndex: number
  onBack: () => void
  onReset: () => void
  onRun: (structure: MuloPidLoop[], simulationParams: { dt: number; max_time: number }) => void
  loading?: boolean
}

function defaultMetrics(): MuloLoopMetrics {
  return { mse: 0.001, settling_time: 7, overshoot: 15, control_effort: 0.25 }
}

function getControllerOutput(loop: MuloPidLoop): Record<string, unknown> {
  const controller = loop.controllers?.[0]
  const output = controller?.controller_output
  return output && typeof output === 'object' ? (output as Record<string, unknown>) : {}
}

function isBoundedOutput(loop: MuloPidLoop): boolean {
  return Boolean(getControllerOutput(loop).is_bounded)
}

export function MuloCaseStudyEditor({
  controllerStructure,
  simulationParams,
  loopIndex,
  onBack,
  onReset,
  onRun,
  loading = false,
}: MuloCaseStudyEditorProps) {
  const [structure, setStructure] = useState(controllerStructure)
  const [simParams, setSimParams] = useState(simulationParams)

  useEffect(() => {
    setStructure(controllerStructure)
    setSimParams(simulationParams)
  }, [controllerStructure, simulationParams])

  const updateMetric = (loopIdx: number, key: keyof MuloLoopMetrics, value: number) => {
    setStructure((prev) =>
      prev.map((loop, index) =>
        index === loopIdx
          ? {
              ...loop,
              metrics: { ...(loop.metrics ?? defaultMetrics()), [key]: value },
            }
          : loop,
      ),
    )
  }

  const updateOutputBound = (loopIdx: number, key: 'min_bound' | 'max_bound', value: number) => {
    setStructure((prev) =>
      prev.map((loop, index) => {
        if (index !== loopIdx) return loop
        const controllers = [...(loop.controllers ?? [])]
        const controller = { ...(controllers[0] ?? {}) }
        const controllerOutput = {
          ...((controller.controller_output as Record<string, unknown> | undefined) ?? {}),
          [key]: value,
        }
        controller.controller_output = controllerOutput
        controllers[0] = controller
        return { ...loop, controllers }
      }),
    )
  }

  const boundsError = useMemo(() => {
    for (const loop of structure) {
      if (!isBoundedOutput(loop)) continue
      const output = getControllerOutput(loop)
      const minBound = Number(output.min_bound ?? -1)
      const maxBound = Number(output.max_bound ?? 1)
      if (minBound >= maxBound) {
        return `Minimum Output Bound (${minBound}) must be strictly less than Maximum Output Bound (${maxBound}).`
      }
    }
    return null
  }, [structure])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button type="button" className={btnBase} onClick={onBack}>
          Back to Parameter Configurations
        </button>
        <button type="button" className={btnBase} onClick={onReset}>
          Reset to Default Values
        </button>
      </div>

      <div className={cardPanel}>
        <h3 className="mt-0 mb-3 text-foreground">Simulation Parameters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className={fieldLabel}>
            <span>Time Step Size Delta (dt)</span>
            <input
              type="number"
              className={fieldInput}
              min={0.0001}
              max={0.1}
              step={0.0005}
              value={simParams.dt}
              onChange={(e) => setSimParams((prev) => ({ ...prev, dt: Number(e.target.value) }))}
            />
          </label>
          <label className={fieldLabel}>
            <span>Maximum Processing Epoch Run Time (s)</span>
            <input
              type="number"
              className={fieldInput}
              min={1}
              max={300}
              step={1}
              value={simParams.max_time}
              onChange={(e) =>
                setSimParams((prev) => ({ ...prev, max_time: Number(e.target.value) }))
              }
            />
          </label>
        </div>
      </div>

      <div className={cardPanel}>
        <h3 className="mt-0 mb-3 text-foreground">Fixed Performance Targets</h3>
        {structure.map((loop, index) => {
          const output = getControllerOutput(loop)
          const showBounds = isBoundedOutput(loop)
          return (
            <div key={loop.loop_number} className="mb-5 last:mb-0">
              <h4 className="text-sm font-semibold text-foreground mb-3 capitalize">
                Loop Context: {loop.loop_name.replace(/_/g, ' ')}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className={fieldLabel}>
                  <span>Mean Squared Error (mse)</span>
                  <input
                    type="number"
                    className={fieldInput}
                    min={0}
                    step={0.001}
                    value={loop.metrics?.mse ?? 0.001}
                    onChange={(e) => updateMetric(index, 'mse', Number(e.target.value))}
                  />
                </label>
                <label className={fieldLabel}>
                  <span>Settling Time Threshold (s)</span>
                  <input
                    type="number"
                    className={fieldInput}
                    min={0}
                    step={0.5}
                    value={loop.metrics?.settling_time ?? 7}
                    onChange={(e) => updateMetric(index, 'settling_time', Number(e.target.value))}
                  />
                </label>
                <label className={fieldLabel}>
                  <span>Maximum Percentage Overshoot (%)</span>
                  <input
                    type="number"
                    className={fieldInput}
                    min={0}
                    max={100}
                    step={0.5}
                    value={loop.metrics?.overshoot ?? 15}
                    onChange={(e) => updateMetric(index, 'overshoot', Number(e.target.value))}
                  />
                </label>
                <label className={fieldLabel}>
                  <span>Control Effort Penalty Weight</span>
                  <input
                    type="number"
                    className={fieldInput}
                    min={0}
                    step={0.1}
                    value={loop.metrics?.control_effort ?? 0.25}
                    onChange={(e) => updateMetric(index, 'control_effort', Number(e.target.value))}
                  />
                </label>
                {showBounds && (
                  <>
                    <label className={fieldLabel}>
                      <span>Minimum Output Bound</span>
                      <input
                        type="number"
                        className={fieldInput}
                        step={0.1}
                        value={Number(output.min_bound ?? -1)}
                        onChange={(e) =>
                          updateOutputBound(index, 'min_bound', Number(e.target.value))
                        }
                      />
                    </label>
                    <label className={fieldLabel}>
                      <span>Maximum Output Bound</span>
                      <input
                        type="number"
                        className={fieldInput}
                        step={0.1}
                        value={Number(output.max_bound ?? 1)}
                        onChange={(e) =>
                          updateOutputBound(index, 'max_bound', Number(e.target.value))
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {boundsError && <StatusMessage type="error" message={boundsError} />}

      <button
        type="button"
        className={btnPrimary}
        disabled={loading || Boolean(boundsError)}
        onClick={() => onRun(structure, simParams)}
      >
        Run Controller Design Optimization (Loop {loopIndex + 1})
      </button>
    </div>
  )
}
