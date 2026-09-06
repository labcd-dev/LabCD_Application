import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Sparkles, X } from 'lucide-react'
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
  const [mode, setMode] = useState<'reg' | 'sin' | 'pulse'>(
    initialConfig?.trajectory_mode ?? 'reg'
  )
  const [amp, setAmp] = useState(initialConfig?.trajectory_amplitude ?? 1.0)
  const [freq, setFreq] = useState(initialConfig?.trajectory_frequency ?? 0.5)
  const [offset, setOffset] = useState(initialConfig?.trajectory_offset ?? 0.0)

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
  const [showPreview, setShowPreview] = useState(false)
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

  // Trajectory preview points (SVG)
  const previewPoints = useMemo(() => {
    const steps = 100
    const horizon = Math.max(tSim, 1)
    const points: { x: number; y: number }[] = []

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * horizon
      let val = offset
      if (mode === 'sin') {
        val = offset + amp * Math.sin(2 * Math.PI * freq * t)
      } else if (mode === 'pulse') {
        val = offset + (Math.sin(2 * Math.PI * freq * t) >= 0 ? amp : -amp)
      }
      points.push({ x: t, y: val })
    }

    const yMin = Math.min(-1, ...points.map((p) => p.y)) - 0.5
    const yMax = Math.max(1, ...points.map((p) => p.y)) + 0.5
    const rangeY = yMax - yMin || 1

    return points.map((p) => ({
      normX: (p.x / horizon) * 300,
      normY: 100 - ((p.y - yMin) / rangeY) * 90 - 5,
    }))
  }, [tSim, mode, amp, freq, offset])

  const pathD = useMemo(() => {
    if (!previewPoints.length) return ''
    return previewPoints.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.normX.toFixed(1)} ${p.normY.toFixed(1)}`, '')
  }, [previewPoints])

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
      trajectory_mode: mode,
      trajectory_amplitude: Number(amp),
      trajectory_frequency: Number(freq),
      trajectory_offset: Number(offset),
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#11161d] text-[#eef2f8] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
              <Sparkles className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-white">
                Pre-Launch Configuration: {systemName}
                {targetPipeline && (
                  <span className="ml-2 text-xs font-normal text-cyan-300">
                    ({targetPipeline === 'adaptiveDesign' ? 'Adaptive' : targetPipeline === 'mpcDesign' ? 'MPC' : 'PID'})
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Module-agnostic simulation settings & artifact compilation
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
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
              <span className="text-[11px] text-slate-400">Horizon for closed-loop evaluation</span>
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
              <span className="text-[11px] text-slate-400">Step size for RK4 / OSQP solver</span>
            </div>

            <div className="sm:col-span-2">
              <label className={fieldLabel}>Trajectory Reference Mode</label>
              <div className="grid grid-cols-3 gap-2">
                {(['reg', 'sin', 'pulse'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                      mode === m
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-300 shadow-sm'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20'
                    }`}
                  >
                    {m === 'reg' ? 'Regulation (Constant)' : m === 'sin' ? 'Sine Wave' : 'Pulse / Step'}
                  </button>
                ))}
              </div>
            </div>

            {mode !== 'reg' && (
              <>
                <div>
                  <label className={fieldLabel}>Amplitude</label>
                  <input
                    type="number"
                    step="0.1"
                    value={amp}
                    onChange={(e) => setAmp(parseFloat(e.target.value) || 0)}
                    className={fieldInput}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>Frequency (Hz)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={freq}
                    onChange={(e) => setFreq(parseFloat(e.target.value) || 0)}
                    className={fieldInput}
                  />
                </div>
                <div>
                  <label className={fieldLabel}>Offset</label>
                  <input
                    type="number"
                    step="0.1"
                    value={offset}
                    onChange={(e) => setOffset(parseFloat(e.target.value) || 0)}
                    className={fieldInput}
                  />
                </div>
              </>
            )}

            <div className="sm:col-span-2">
              <label className={fieldLabel}>Initial State Vector x0 (comma-separated)</label>
              <input
                type="text"
                value={x0Str}
                onChange={(e) => setX0Str(e.target.value)}
                placeholder="0, 0, 0, 0"
                className={`${fieldInput} font-mono text-xs`}
              />
              <span className="text-[11px] text-slate-400">
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
              <span className="text-[11px] text-slate-400">
                Setpoint destination for state regulation
              </span>
            </div>
          </div>

          {/* Reference Signal Preview Toggle */}
          <div className="rounded-xl border border-white/10 bg-black/20 p-3.5">
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="flex w-full items-center justify-between text-xs font-semibold text-slate-300 hover:text-white"
            >
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-cyan-400" />
                Preview Reference Trajectory Signal
              </span>
              {showPreview ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>

            {showPreview && (
              <div className="mt-3">
                <svg viewBox="0 0 300 100" className="w-full h-24 rounded-lg bg-[#0a0d12] border border-white/5">
                  <line x1="0" y1="50" x2="300" y2="50" stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                  <path d={pathD} fill="none" stroke="#35c9d6" strokeWidth="2" />
                </svg>
                <div className="mt-1 flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>t = 0 s</span>
                  <span>t = {tSim} s</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
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
            className={`${btnBase} ${btnCompact} ${btnPrimary} flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-teal-500 border-none text-black font-semibold`}
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
