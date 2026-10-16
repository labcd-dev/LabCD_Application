import { useMemo, useState } from 'react'
import {
  Compass,
  Cpu,
  Play,
  UserCheck,
  Zap,
} from 'lucide-react'
import type { MPCDiagnosticsResponse } from '../../api/types'
import type { MpcTuningParams } from './MpcParameterDrawer'
import { btnPrimary } from '../../lib/classes'

export interface MpcHitlScenarioCardProps {
  systemName: string
  params: MpcTuningParams
  onChangeParams: (updated: Partial<MpcTuningParams>) => void
  diagnostics?: MPCDiagnosticsResponse | null
  isRunning?: boolean
  onStartTuning: (userGuidance: string) => void
  onDismiss?: () => void
  defaultCollapsed?: boolean
}

export function MpcHitlScenarioCard({
  systemName,
  params,
  onChangeParams,
  diagnostics,
  isRunning = false,
  onStartTuning,
  onDismiss,
  defaultCollapsed = false,
}: MpcHitlScenarioCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const [showCustomKnobs, setShowCustomKnobs] = useState(false)
  const [userGuidance, setUserGuidance] = useState('')
  const [selectedStates, setSelectedStates] = useState<number[]>([0])

  // Compute SVG trajectory preview path
  const trajectorySvgPath = useMemo(() => {
    const W = 320
    const H = 75
    const pointsCount = 60
    const coords: { x: number; y: number }[] = []

    for (let i = 0; i < pointsCount; i++) {
      const frac = i / (pointsCount - 1)
      const x = frac * W
      let yNorm = 0.5

      if (params.trajectoryMode === 'reg') {
        yNorm = 0.5
      } else if (params.trajectoryMode === 'sin') {
        yNorm =
          0.5 - 0.35 * Math.sin(frac * Math.PI * 4 * params.trajectoryFrequency) * params.trajectoryAmplitude
      } else if (params.trajectoryMode === 'pulse') {
        const pStart = 0.2
        const pEnd = 0.7
        if (frac >= pStart && frac <= pEnd) {
          yNorm = 0.5 - 0.35 * params.trajectoryAmplitude
        } else {
          yNorm = 0.5
        }
      }

      const y = yNorm * H
      coords.push({ x, y })
    }

    return coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ')
  }, [params.trajectoryMode, params.trajectoryAmplitude, params.trajectoryFrequency])

  const availableStateNames = useMemo(() => {
    if (diagnostics?.state_names && diagnostics.state_names.length > 0) {
      return diagnostics.state_names
    }
    return ['i_L', 'v_C']
  }, [diagnostics])

  const availableInputNames = useMemo(() => {
    if (diagnostics?.input_names && diagnostics.input_names.length > 0) {
      return diagnostics.input_names
    }
    return ['v_in', 'D']
  }, [diagnostics])

  const handleLaunch = () => {
    onStartTuning(userGuidance.trim())
  }

  return (
    <div
      className="rounded-2xl border border-purple-500/40 bg-gradient-to-b from-purple-500/5 via-surface-elevated to-surface-elevated p-4 sm:p-5 shadow-lg shadow-purple-500/5 space-y-4 animate-in fade-in-50 duration-200"
      role="region"
      aria-label="Human-in-the-Loop MPC Scenario Configuration"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/80 pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/40 bg-purple-500/15 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-300">
              <span className="size-1.5 rounded-full bg-purple-500 animate-pulse" />
              <UserCheck className="size-3" />
              Human-in-the-Loop
            </span>
            <span className="text-[11px] text-muted-text font-mono">
              Horizon: Np={params.np}, Nc={params.nc}
            </span>
          </div>

          <h3 className="text-sm sm:text-base font-bold text-foreground flex items-center gap-2">
            <Compass className="size-4 text-purple-500" />
            MPC Scenario &amp; Trajectory Configuration
          </h3>

          <p className="text-[11.5px] text-muted-text max-w-xl leading-relaxed">
            Specify the reference tracking waveform, sensor noise, and disturbance conditions for autonomous tuning of <span className="font-mono font-semibold text-foreground">{systemName}</span>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-[11px] text-muted-text hover:text-foreground px-2 py-1 rounded transition-colors"
            >
              Dismiss
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-[11px] font-mono text-purple-600 dark:text-purple-300 border border-purple-400/30 bg-purple-500/10 px-2.5 py-1 rounded-lg hover:bg-purple-500/20 transition-colors"
          >
            {isCollapsed ? 'Expand Configuration ▼' : 'Collapse ▲'}
          </button>
        </div>
      </div>

      {/* Target Plant Summary Pill */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-surface-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-text">Target Plant:</span>
          <span className="font-mono font-bold text-purple-600 dark:text-purple-300 text-xs">
            {systemName}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[10.5px] font-mono">
          <div className="flex items-center gap-1">
            <span className="text-muted-text">States:</span>
            <div className="flex gap-1">
              {availableStateNames.map((name, i) => (
                <span key={i} className="rounded border border-border bg-surface px-1.5 py-0.5 text-foreground font-semibold">
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-muted-text">Inputs:</span>
            <div className="flex gap-1">
              {availableInputNames.map((name, i) => (
                <span key={i} className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-600 dark:text-cyan-300 font-semibold">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!isCollapsed && (
        <div className="space-y-4 pt-1">
          {/* 1. Reference Trajectory Tracking Pattern */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-300 block">
              Reference Trajectory Tracking Pattern
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => onChangeParams({ trajectoryMode: 'reg' })}
                className={`rounded-xl border p-3 text-left transition-all ${
                  params.trajectoryMode === 'reg'
                    ? 'border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/40 shadow-xs'
                    : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-bold text-foreground">Regulation (Fixed Setpoint)</span>
                  {params.trajectoryMode === 'reg' && <span className="size-2 rounded-full bg-purple-500" />}
                </div>
                <div className="text-[11px] text-muted-text leading-snug">
                  Stabilize states to origin / trim equilibrium. Overshoot &amp; Settling time certified.
                </div>
              </button>

              <button
                type="button"
                onClick={() => onChangeParams({ trajectoryMode: 'sin' })}
                className={`rounded-xl border p-3 text-left transition-all ${
                  params.trajectoryMode === 'sin'
                    ? 'border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/40 shadow-xs'
                    : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-bold text-foreground">Sinusoidal Wave</span>
                  {params.trajectoryMode === 'sin' && <span className="size-2 rounded-full bg-purple-500" />}
                </div>
                <div className="text-[11px] text-muted-text leading-snug">
                  Continuous harmonic path tracking with velocity derivative matching.
                </div>
              </button>

              <button
                type="button"
                onClick={() => onChangeParams({ trajectoryMode: 'pulse' })}
                className={`rounded-xl border p-3 text-left transition-all ${
                  params.trajectoryMode === 'pulse'
                    ? 'border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/40 shadow-xs'
                    : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-bold text-foreground">Step Pulse Wave</span>
                  {params.trajectoryMode === 'pulse' && <span className="size-2 rounded-full bg-purple-500" />}
                </div>
                <div className="text-[11px] text-muted-text leading-snug">
                  Discrete displacement pulses with abrupt rising and falling edges.
                </div>
              </button>
            </div>
          </div>

          {/* 2. Trajectory Knobs & SVG Wave Preview Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Knobs */}
            <div className="rounded-xl border border-border bg-surface-muted/40 p-3.5 space-y-2.5 text-xs font-mono">
              <span className="font-bold text-foreground block text-[11px] uppercase tracking-wide">
                Trajectory Parameters
              </span>

              {params.trajectoryMode !== 'reg' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-muted-text text-[11px]">
                    <span>Amplitude</span>
                    <span className="text-purple-600 dark:text-purple-300 font-bold">
                      {params.trajectoryAmplitude.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={2.0}
                    step={0.05}
                    value={params.trajectoryAmplitude}
                    onChange={(e) => onChangeParams({ trajectoryAmplitude: Number(e.target.value) })}
                    className="w-full accent-purple-500 h-1.5"
                  />
                </div>
              )}

              {params.trajectoryMode === 'sin' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-muted-text text-[11px]">
                    <span>Frequency (Hz)</span>
                    <span className="text-purple-600 dark:text-purple-300 font-bold">
                      {params.trajectoryFrequency.toFixed(2)} Hz
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={2.0}
                    step={0.05}
                    value={params.trajectoryFrequency}
                    onChange={(e) => onChangeParams({ trajectoryFrequency: Number(e.target.value) })}
                    className="w-full accent-purple-500 h-1.5"
                  />
                </div>
              )}

              <div className="space-y-1 pt-1.5 border-t border-border/80">
                <div className="flex justify-between text-muted-text text-[11px]">
                  <span>Sensor Measurement Noise (&sigma;)</span>
                  <span className="text-cyan-600 dark:text-cyan-300 font-bold">
                    {params.noiseStd.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={0.1}
                  step={0.005}
                  value={params.noiseStd}
                  onChange={(e) => onChangeParams({ noiseStd: Number(e.target.value) })}
                  className="w-full accent-cyan-500 h-1.5"
                />
              </div>

              {/* Target States multi-select */}
              <div className="space-y-1.5 pt-1.5 border-t border-border/80">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-foreground">Target States for Tracking</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedStates(availableStateNames.map((_, i) => i))}
                      className="text-[9.5px] text-purple-600 dark:text-purple-400 hover:underline font-mono"
                    >
                      All
                    </button>
                    <span className="text-muted text-[9.5px]">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedStates([0])}
                      className="text-[9.5px] text-purple-600 dark:text-purple-400 hover:underline font-mono"
                    >
                      State 1
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {availableStateNames.map((name, idx) => {
                    const isSelected = selectedStates.includes(idx)
                    return (
                      <button
                        key={name + idx}
                        type="button"
                        onClick={() => {
                          setSelectedStates((prev) =>
                            isSelected
                              ? prev.length > 1
                                ? prev.filter((i) => i !== idx)
                                : prev
                              : [...prev, idx].sort((a, b) => a - b)
                          )
                        }}
                        className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-mono transition-all border ${
                          isSelected
                            ? 'border-purple-500 bg-purple-500/20 text-purple-600 dark:text-purple-300 font-bold'
                            : 'border-border bg-surface text-muted-text hover:border-border-input'
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${isSelected ? 'bg-purple-500' : 'bg-muted'}`} />
                        <span>x{idx + 1}: {name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Live Profile SVG Preview */}
            <div className="rounded-xl border border-border bg-surface-muted/40 p-3.5 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-bold text-foreground uppercase tracking-wide block mb-0.5">
                  Closed-Loop Reference Profile Preview
                </span>
                <p className="text-[10.5px] text-muted-text">
                  Reference path target waveform tracked across horizon window.
                </p>
              </div>

              <div className="h-24 w-full my-2 relative flex items-center justify-center bg-surface/60 rounded-lg p-2 border border-border/40">
                <svg viewBox="0 0 320 75" className="size-full overflow-visible">
                  <line x1="0" y1="37.5" x2="320" y2="37.5" stroke="var(--app-border)" strokeDasharray="3 3" />
                  <path
                    d={trajectorySvgPath}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="flex justify-between text-[9.5px] font-mono text-muted border-t border-border/60 pt-1.5">
                <span>t = 0.0s</span>
                <span className="text-purple-600 dark:text-purple-300 font-semibold">{params.trajectoryMode.toUpperCase()} Target Waveform</span>
                <span>t = {params.simTime}s</span>
              </div>
            </div>
          </div>

          {/* 3. Plant Uncertainty & Disturbance Injection */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-300 block">
              Plant Uncertainty &amp; Disturbance Injection
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => onChangeParams({ scenarioLevel: 1, customDriftPct: 0, disturbanceAmp: 0 })}
                className={`rounded-xl border p-3 text-left transition-all ${
                  params.scenarioLevel === 1
                    ? 'border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/40 shadow-xs'
                    : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-foreground">Level 1 · Nominal</span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-mono font-bold text-emerald-600 dark:text-emerald-300">
                    Clean
                  </span>
                </div>
                <p className="text-[11px] text-muted-text leading-snug">
                  Exact model dynamics without parameter drift or disturbance steps.
                </p>
              </button>

              <button
                type="button"
                onClick={() => onChangeParams({ scenarioLevel: 2, customDriftPct: 20, disturbanceAmp: 0 })}
                className={`rounded-xl border p-3 text-left transition-all ${
                  params.scenarioLevel === 2
                    ? 'border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/40 shadow-xs'
                    : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-foreground">Level 2 · Parameter Drift</span>
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-mono font-bold text-amber-600 dark:text-amber-300">
                    &plusmn;20%
                  </span>
                </div>
                <p className="text-[11px] text-muted-text leading-snug">
                  Uncertain mass, inertia, and joint friction variations.
                </p>
              </button>

              <button
                type="button"
                onClick={() => onChangeParams({ scenarioLevel: 3, customDriftPct: 20, disturbanceAmp: 1.0 })}
                className={`rounded-xl border p-3 text-left transition-all ${
                  params.scenarioLevel === 3
                    ? 'border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/40 shadow-xs'
                    : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-foreground">Level 3 · Force Step</span>
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9.5px] font-mono font-bold text-rose-600 dark:text-rose-300">
                    Disturbance
                  </span>
                </div>
                <p className="text-[11px] text-muted-text leading-snug">
                  External torque and wind-gust impulses injected during closed loop.
                </p>
              </button>
            </div>

            {/* Custom Knobs drawer */}
            <div className="rounded-xl border border-border/80 bg-surface p-3 space-y-2 mt-2">
              <button
                type="button"
                onClick={() => setShowCustomKnobs(!showCustomKnobs)}
                className="flex items-center gap-2 text-xs font-semibold text-foreground hover:text-purple-600 dark:hover:text-purple-400 transition-colors w-full justify-between"
              >
                <div className="flex items-center gap-1.5">
                  <Zap className="size-3.5 text-purple-500" />
                  <span>Advanced / Custom Uncertainty &amp; Disturbance Knobs</span>
                </div>
                <span className="text-[10px] font-mono text-muted-text bg-surface-muted px-2 py-0.5 rounded border border-border">
                  {showCustomKnobs ? 'Hide Knobs ▲' : 'Customize Sliders ▼'}
                </span>
              </button>

              {showCustomKnobs && (
                <div className="pt-2.5 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[10.5px] text-muted-text mb-1">
                      Disturbance Force Magnitude: <b>{params.disturbanceAmp}</b>
                    </label>
                    <input
                      type="range"
                      min={0.1}
                      max={3.0}
                      step={0.1}
                      value={params.disturbanceAmp}
                      onChange={(e) => onChangeParams({ disturbanceAmp: Number(e.target.value) })}
                      className="w-full accent-rose-500 h-1.5"
                    />
                  </div>

                  <div>
                    <label className="block text-[10.5px] text-muted-text mb-1">
                      Parameter Drift Percentage: <b>&plusmn;{params.customDriftPct}%</b>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={1}
                      value={params.customDriftPct}
                      onChange={(e) => onChangeParams({ customDriftPct: Number(e.target.value) })}
                      className="w-full accent-amber-500 h-1.5"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Optional Guidance Prompt */}
          <div className="rounded-xl border border-border bg-surface p-3 space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground block">
              Human Guidance / Directives for Copilot (Optional):
            </label>
            <input
              type="text"
              value={userGuidance}
              onChange={(e) => setUserGuidance(e.target.value)}
              placeholder="e.g. Optimize for rapid setpoint tracking with tight state bounds and no overshoot..."
              className="w-full rounded-lg border border-border bg-surface-muted px-3 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-purple-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="pt-2 border-t border-border/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-medium text-muted-text hover:text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-surface-elevated transition-colors"
            >
              &larr; Change Architecture
            </button>
          )}
          <span className="text-[11.5px] text-muted-text">
            Ready to synthesize. Click start to launch autonomous multi-agent MPC tuning.
          </span>
        </div>

        <button
          type="button"
          onClick={handleLaunch}
          disabled={isRunning}
          className={`${btnPrimary} flex items-center gap-2 text-xs shadow-md shadow-purple-500/20 px-5 py-2 font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500`}
        >
          {isRunning ? (
            <>
              <Cpu className="size-4 animate-spin" />
              <span>Optimizing Active Set...</span>
            </>
          ) : (
            <>
              <Play className="size-4" />
              <span>Start Autonomous Tuning &rarr;</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
