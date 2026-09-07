import { useMemo, useState } from 'react'
import { AlertCircle, Loader2, Sparkles, X } from 'lucide-react'
import { plantArtifactApi } from '../api/endpoints'
import type { PlantPayload, PreLaunchConfig } from '../api/types'
import { btnBase, btnCompact, btnPrimary, fieldInput, fieldLabel } from '../lib/classes'

interface PreLaunchModalProps {
  isOpen: boolean
  onClose: () => void
  plant?: PlantPayload | null
  conversationId?: number | null
  systemName?: string
  initialConfig?: Partial<PreLaunchConfig>
  targetPipeline?: 'adaptiveDesign' | 'mpcDesign' | 'siloDesign' | 'muloDesign' | null
  onSuccess: (artifactId: string, preLaunch: PreLaunchConfig) => void
}

export function PreLaunchModal({
  isOpen,
  onClose,
  plant,
  conversationId,
  systemName = 'Plant System',
  initialConfig,
  targetPipeline,
  onSuccess,
}: PreLaunchModalProps) {
  const [tSim, setTSim] = useState(initialConfig?.total_simulation_time ?? 10)
  const [dt, setDt] = useState(initialConfig?.solver_sample_time ?? 0.01)

  // Default initial states & target
  const defaultStatesStr = useMemo(() => {
    if (initialConfig?.initial_state?.length) {
      return initialConfig.initial_state.join(', ')
    }
    const numStates = (plant?.metadata?.states as string[])?.length || 2
    return new Array(numStates).fill(0).join(', ')
  }, [initialConfig, plant])

  const defaultTargetStr = useMemo(() => {
    if (initialConfig?.default_target?.length) {
      return initialConfig.default_target.join(', ')
    }
    const numStates = (plant?.metadata?.states as string[])?.length || 2
    return new Array(numStates).fill(0).join(', ')
  }, [initialConfig, plant])

  const [x0Str, setX0Str] = useState(defaultStatesStr)
  const [targetStr, setTargetStr] = useState(defaultTargetStr)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  // Parse arrays
  const parseVector = (str: string): number[] => {
    return str
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number)
  }

  if (!isOpen) return null

  const handleSave = async () => {
    setError(null)
    setWarnings([])
    const parsedX0 = parseVector(x0Str)
    const parsedTarget = parseVector(targetStr)

    if (parsedX0.some(isNaN)) {
      setError('Initial state contains non-numeric values')
      return
    }
    if (parsedTarget.some(isNaN)) {
      setError('Target contains non-numeric values')
      return
    }

    const preLaunch: PreLaunchConfig = {
      total_simulation_time: Number(tSim),
      solver_sample_time: Number(dt),
      initial_state: parsedX0,
      default_target: parsedTarget,
    }

    setSubmitting(true)
    try {
      const res = await plantArtifactApi.createArtifact({
        pre_launch: preLaunch,
        plant: plant ?? undefined,
        conversation_id: conversationId ?? undefined,
      })
      if (res.warnings?.length) {
        setWarnings(res.warnings)
      }
      onSuccess(res.artifact_id, preLaunch)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create plant artifact'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface-elevated text-foreground shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500 dark:text-cyan-400">
              <Sparkles className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Pre-Launch Configuration: {systemName}
                {targetPipeline && (
                  <span className="ml-2 text-xs font-normal text-cyan-600 dark:text-cyan-300">
                    ({targetPipeline === 'adaptiveDesign' ? 'Adaptive' : targetPipeline === 'mpcDesign' ? 'MPC' : 'PID'})
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted">
                Module-agnostic simulation settings & artifact compilation
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-300 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="size-3.5" /> Compiler warnings:
              </div>
              {warnings.map((w, idx) => (
                <div key={idx}>• {w}</div>
              ))}
            </div>
          )}

          {/* Grid fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={fieldLabel}>Total Simulation Time (s)</label>
              <input
                type="number"
                min="0.1"
                step="0.5"
                value={tSim}
                onChange={(e) => setTSim(parseFloat(e.target.value) || 0)}
                className={fieldInput}
              />
              <span className="text-[11px] text-muted">Horizon for closed-loop evaluation</span>
            </div>

            <div>
              <label className={fieldLabel}>Solver Sample Time dt (s)</label>
              <input
                type="number"
                min="0.0001"
                step="0.005"
                value={dt}
                onChange={(e) => setDt(parseFloat(e.target.value) || 0)}
                className={fieldInput}
              />
              <span className="text-[11px] text-muted">Step size for RK4 / OSQP solver</span>
            </div>

            <div className="sm:col-span-2">
              <label className={fieldLabel}>Initial State Vector x0 (comma-separated)</label>
              <input
                type="text"
                value={x0Str}
                onChange={(e) => setX0Str(e.target.value)}
                placeholder="0, 0, 0, 0"
                className={`${fieldInput} font-mono text-xs`}
              />
              <span className="text-[11px] text-muted">
                Initial condition for simulation states at t=0
              </span>
            </div>

            <div className="sm:col-span-2">
              <label className={fieldLabel}>Default Target Vector (comma-separated)</label>
              <input
                type="text"
                value={targetStr}
                onChange={(e) => setTargetStr(e.target.value)}
                placeholder="0, 0, 0, 0"
                className={`${fieldInput} font-mono text-xs`}
              />
              <span className="text-[11px] text-muted">
                Setpoint destination for state regulation
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={`${btnBase} ${btnCompact}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            className={`${btnBase} ${btnCompact} ${btnPrimary} flex items-center gap-2 border-none font-semibold text-white shadow-md`}
          >
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Compiling Artifact...
              </>
            ) : (
              <>Save & Proceed →</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
