import { Sliders, X, RotateCcw, ShieldAlert, Waves, Check } from 'lucide-react'
import { btnBase, btnCompact, btnPrimary } from '../../lib/classes'

export interface MpcTuningParams {
  np: number
  nc: number
  dtMpc: number
  simTime: number
  maxIterations: number
  qWeightsInput: string
  rWeightsInput: string
  scenarioLevel: 1 | 2 | 3
  customDriftPct: number
  disturbanceAmp: number
  trajectoryMode: 'reg' | 'sin' | 'pulse'
  trajectoryAmplitude: number
  trajectoryFrequency: number
  noiseStd: number
}

interface MpcParameterDrawerProps {
  isOpen: boolean
  onClose: () => void
  params: MpcTuningParams
  onChangeParams: (updated: Partial<MpcTuningParams>) => void
  onResetDefaults: () => void
}

export function MpcParameterDrawer({
  isOpen,
  onClose,
  params,
  onChangeParams,
  onResetDefaults,
}: MpcParameterDrawerProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in-50">
      <div
        className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-surface-elevated p-6 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg border border-purple-500/30 bg-purple-500/15 text-purple-400">
              <Sliders className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Controller Levers &amp; Horizon</h2>
              <p className="text-[11px] text-muted-text">Tune receding horizon &amp; penalty matrices</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-text hover:bg-surface-hover hover:text-foreground"
            aria-label="Close parameters drawer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 space-y-5 py-4 text-xs">
          {/* Horizons */}
          <div className="rounded-xl border border-border bg-surface p-3.5 space-y-3">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              Prediction &amp; Control Horizon
            </span>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-muted-text mb-1">
                  Prediction Horizon (Np): <strong className="text-foreground">{params.np}</strong>
                </label>
                <input
                  type="range"
                  min={4}
                  max={30}
                  step={1}
                  value={params.np}
                  onChange={(e) => onChangeParams({ np: Number(e.target.value) })}
                  className="w-full accent-purple-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-muted-text mb-1">
                  Control Horizon (Nc): <strong className="text-foreground">{params.nc}</strong>
                </label>
                <input
                  type="range"
                  min={1}
                  max={Math.min(params.np, 15)}
                  step={1}
                  value={params.nc}
                  onChange={(e) => onChangeParams({ nc: Number(e.target.value) })}
                  className="w-full accent-purple-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] text-muted-text mb-1">
                  Sample dt (s)
                </label>
                <input
                  type="number"
                  step="0.005"
                  min="0.001"
                  max="0.2"
                  value={params.dtMpc}
                  onChange={(e) => onChangeParams({ dtMpc: parseFloat(e.target.value) || 0.02 })}
                  className="w-full rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-foreground"
                />
              </div>

              <div>
                <label className="block text-[11px] text-muted-text mb-1">
                  Simulation Time (s)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="30"
                  value={params.simTime}
                  onChange={(e) => onChangeParams({ simTime: parseFloat(e.target.value) || 3.0 })}
                  className="w-full rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-foreground"
                />
              </div>
            </div>
          </div>

          {/* Weights Q & R */}
          <div className="rounded-xl border border-border bg-surface p-3.5 space-y-3">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              Weight Penalty Matrices (Q &amp; R)
            </span>

            <div>
              <label className="block text-[11px] text-muted-text mb-1">
                State Weights Q (diagonal elements, comma separated):
              </label>
              <input
                type="text"
                value={params.qWeightsInput}
                onChange={(e) => onChangeParams({ qWeightsInput: e.target.value })}
                placeholder="10.0, 1.0, 10.0, 1.0"
                className="w-full rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-foreground"
              />
              <span className="text-[10px] text-muted block mt-0.5">Higher values force strict state regulation</span>
            </div>

            <div>
              <label className="block text-[11px] text-muted-text mb-1">
                Actuator Penalty R (diagonal elements, comma separated):
              </label>
              <input
                type="text"
                value={params.rWeightsInput}
                onChange={(e) => onChangeParams({ rWeightsInput: e.target.value })}
                placeholder="0.1"
                className="w-full rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-foreground"
              />
              <span className="text-[10px] text-muted block mt-0.5">Higher values smooth control actions to prevent saturation</span>
            </div>
          </div>

          {/* Scenario & Robustness */}
          <div className="rounded-xl border border-border bg-surface p-3.5 space-y-3">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <ShieldAlert className="size-3.5 text-amber-500" />
              Scenario &amp; Disturbance Robustness
            </span>

            <div className="grid grid-cols-3 gap-1.5">
              {[
                { lvl: 1 as const, label: 'Nominal', desc: 'No disturbance' },
                { lvl: 2 as const, label: 'Param Drift', desc: '±20% inertia' },
                { lvl: 3 as const, label: 'Step Gust', desc: 'External force' },
              ].map((s) => (
                <button
                  key={s.lvl}
                  type="button"
                  onClick={() => onChangeParams({ scenarioLevel: s.lvl })}
                  className={`rounded-lg border p-2 text-left transition-all ${
                    params.scenarioLevel === s.lvl
                      ? 'border-purple-500 bg-purple-500/15 text-foreground font-semibold shadow-xs'
                      : 'border-border bg-surface-muted text-muted-text hover:text-foreground'
                  }`}
                >
                  <div className="text-xs">{s.label}</div>
                  <div className="text-[10px] opacity-75">{s.desc}</div>
                </button>
              ))}
            </div>

            {params.scenarioLevel >= 2 && (
              <div className="pt-2">
                <label className="block text-[11px] text-muted-text mb-1">
                  Model Parameter Drift: <strong className="text-foreground">{params.customDriftPct}%</strong>
                </label>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={params.customDriftPct}
                  onChange={(e) => onChangeParams({ customDriftPct: Number(e.target.value) })}
                  className="w-full accent-amber-500"
                />
              </div>
            )}

            {params.scenarioLevel === 3 && (
              <div className="pt-1">
                <label className="block text-[11px] text-muted-text mb-1">
                  Step Disturbance Amplitude: <strong className="text-foreground">{params.disturbanceAmp} N</strong>
                </label>
                <input
                  type="range"
                  min={0.2}
                  max={5.0}
                  step={0.2}
                  value={params.disturbanceAmp}
                  onChange={(e) => onChangeParams({ disturbanceAmp: Number(e.target.value) })}
                  className="w-full accent-rose-500"
                />
              </div>
            )}
          </div>

          {/* Reference Trajectory */}
          <div className="rounded-xl border border-border bg-surface p-3.5 space-y-2">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Waves className="size-3.5 text-cyan-500" />
              Reference Trajectory
            </span>

            <div className="flex gap-2">
              {[
                { mode: 'reg' as const, label: 'Setpoint Reg' },
                { mode: 'sin' as const, label: 'Sinusoid' },
                { mode: 'pulse' as const, label: 'Pulse Wave' },
              ].map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  onClick={() => onChangeParams({ trajectoryMode: m.mode })}
                  className={`flex-1 rounded-lg border py-1.5 text-center text-xs transition-all ${
                    params.trajectoryMode === m.mode
                      ? 'border-cyan-500 bg-cyan-500/15 text-cyan-300 font-semibold'
                      : 'border-border bg-surface-muted text-muted-text hover:text-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <button
            type="button"
            onClick={onResetDefaults}
            className="flex items-center gap-1.5 text-xs text-muted-text hover:text-foreground"
          >
            <RotateCcw className="size-3" /> Reset defaults
          </button>

          <button
            type="button"
            onClick={onClose}
            className={`${btnBase} ${btnCompact} ${btnPrimary} flex items-center gap-1.5 text-xs`}
          >
            <Check className="size-3.5" /> Apply &amp; Done
          </button>
        </div>
      </div>
    </div>
  )
}
