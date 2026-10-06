import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  Gauge,
  Play,
  Sliders,
  Zap,
} from 'lucide-react'
import type { MPCDiagnosticsResponse } from '../../api/types'
import type { MpcTuningParams } from './MpcParameterDrawer'
import { btnBase, btnCompact, btnPrimary } from '../../lib/classes'

interface MpcSetupSectionProps {
  systemName: string
  params: MpcTuningParams
  onChangeParams: (updated: Partial<MpcTuningParams>) => void
  diagnostics: MPCDiagnosticsResponse | null
  testingDynamics: boolean
  onTestDynamics: () => void
  onStartTuning: (userGuidance: string) => void
  onOpenWorkspaceDirectly?: () => void
  isRunning?: boolean
}

export function MpcSetupSection({
  systemName,
  params,
  onChangeParams,
  diagnostics,
  testingDynamics,
  onTestDynamics,
  onStartTuning,
  onOpenWorkspaceDirectly,
  isRunning = false,
}: MpcSetupSectionProps) {
  const [setupTab, setSetupTab] = useState<'scenario' | 'tuning'>('scenario')
  const [showCustomScenario, setShowCustomScenario] = useState(false)
  const [userGuidance, setUserGuidance] = useState('')
  const [selectedStates, setSelectedStates] = useState<number[]>([0])

  // Compute SVG trajectory preview path
  const trajectorySvgPath = useMemo(() => {
    const W = 360
    const H = 90
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
    return ['x1 (pos)', 'x2 (vel)', 'x3 (angle)', 'x4 (ang_vel)']
  }, [diagnostics])

  const availableInputNames = useMemo(() => {
    if (diagnostics?.input_names && diagnostics.input_names.length > 0) {
      return diagnostics.input_names
    }
    return ['u1 (force/voltage)']
  }, [diagnostics])

  const handleLaunch = () => {
    onStartTuning(userGuidance.trim())
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-5 p-4 sm:p-6 lg:p-8 animate-in fade-in-50 duration-200">
      {/* Title Header Card */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated p-6 sm:p-7 shadow-sm backdrop-blur-md">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-purple-500/80 to-transparent" />

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 text-purple-600 dark:text-purple-400">
              <Compass className="size-5" />
              <span className="text-xs font-bold uppercase tracking-wider">
                Full-Scope Autonomous MPC Tuning
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              Model Predictive Control Optimization Suite
            </h1>
            <p className="text-xs text-muted-text max-w-2xl leading-relaxed">
              Configure plant dynamics, trajectory tracking scenarios, and initial constraints before launching the multi-agent optimization loop.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {onOpenWorkspaceDirectly && (
              <button
                type="button"
                onClick={onOpenWorkspaceDirectly}
                className={`${btnBase} ${btnCompact} border border-border bg-surface-muted text-muted-text hover:text-foreground text-xs font-medium`}
              >
                Direct Chat Workspace &rarr;
              </button>
            )}

            <button
              type="button"
              onClick={handleLaunch}
              disabled={isRunning}
              className={`${btnPrimary} flex items-center gap-2 text-xs shadow-[0_0_20px_rgba(168,85,247,0.35)] px-4 py-2.5 font-bold`}
            >
              {isRunning ? (
                <>
                  <Cpu className="size-4 animate-spin" /> Optimizing Active Set...
                </>
              ) : (
                <>
                  <Play className="size-4" /> Start Autonomous Tuning
                </>
              )}
            </button>
          </div>
        </div>

        {/* Target Plant Banner */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface-muted/50 p-3.5 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-muted-text">Target Plant:</span>
            <span className="font-mono font-bold text-purple-600 dark:text-purple-300 text-sm">
              {systemName}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-text">States:</span>
              <div className="flex gap-1">
                {availableStateNames.map((name, i) => (
                  <span
                    key={i}
                    className="rounded border border-border bg-surface px-1.5 py-0.5 text-foreground"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-muted-text">Inputs:</span>
              <div className="flex gap-1">
                {availableInputNames.map((name, i) => (
                  <span
                    key={i}
                    className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-600 dark:text-cyan-300"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 2 Navigation Tabs */}
        <div className="mt-6 flex border-b border-border text-xs font-semibold">
          <button
            type="button"
            onClick={() => setSetupTab('scenario')}
            className={`border-b-2 px-5 py-3 transition-all ${
              setupTab === 'scenario'
                ? 'border-purple-500 text-purple-600 dark:text-purple-300 font-bold bg-surface-muted/60'
                : 'border-transparent text-muted-text hover:text-foreground'
            }`}
          >
            1 · Scenario &amp; Trajectory
          </button>
          <button
            type="button"
            onClick={() => setSetupTab('tuning')}
            className={`border-b-2 px-5 py-3 transition-all ${
              setupTab === 'tuning'
                ? 'border-purple-500 text-purple-600 dark:text-purple-300 font-bold bg-surface-muted/60'
                : 'border-transparent text-muted-text hover:text-foreground'
            }`}
          >
            2 · Tuning &amp; Diagnostics
          </button>
        </div>

        {/* TAB 1: SCENARIO & TRAJECTORY */}
        {setupTab === 'scenario' && (
          <div className="mt-6 space-y-6">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-300 block mb-2">
                Reference Trajectory Tracking Pattern
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => onChangeParams({ trajectoryMode: 'reg' })}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    params.trajectoryMode === 'reg'
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                      : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                  }`}
                >
                  <div className="text-xs font-bold text-foreground mb-1">Regulation (Fixed Setpoint)</div>
                  <div className="text-[11.5px] text-muted-text">
                    Stabilize states to origin / trim equilibrium. Overshoot &amp; Settling time certified.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onChangeParams({ trajectoryMode: 'sin' })}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    params.trajectoryMode === 'sin'
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                      : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                  }`}
                >
                  <div className="text-xs font-bold text-foreground mb-1">Sinusoidal Wave</div>
                  <div className="text-[11.5px] text-muted-text">
                    Continuous harmonic path tracking with velocity derivative matching.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onChangeParams({ trajectoryMode: 'pulse' })}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    params.trajectoryMode === 'pulse'
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                      : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                  }`}
                >
                  <div className="text-xs font-bold text-foreground mb-1">Step Pulse Wave</div>
                  <div className="text-[11.5px] text-muted-text">
                    Discrete displacement pulses with abrupt rising and falling edges.
                  </div>
                </button>
              </div>
            </div>

            {/* Trajectory Knobs & SVG Wave Preview */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-3 text-xs font-mono">
                <span className="font-bold text-foreground block uppercase tracking-wide">
                  Trajectory Parameters
                </span>

                {params.trajectoryMode !== 'reg' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-muted-text">
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
                      className="w-full accent-purple-500"
                    />
                  </div>
                )}

                {params.trajectoryMode === 'sin' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-muted-text">
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
                      className="w-full accent-purple-500"
                    />
                  </div>
                )}

                <div className="space-y-1 pt-2 border-t border-border">
                  <div className="flex justify-between text-muted-text">
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
                    className="w-full accent-cyan-500"
                  />
                </div>

                {/* Target States Multi-Select */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      Target States for Trajectory Tracking
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedStates(availableStateNames.map((_, i) => i))}
                        className="text-[10px] text-purple-600 dark:text-purple-400 hover:underline font-mono"
                      >
                        All States
                      </button>
                      <span className="text-muted text-[10px]">|</span>
                      <button
                        type="button"
                        onClick={() => setSelectedStates([0])}
                        className="text-[10px] text-purple-600 dark:text-purple-400 hover:underline font-mono"
                      >
                        State 1 Only
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
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
                          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-mono transition-all border ${
                            isSelected
                              ? 'border-purple-500 bg-purple-500/15 text-purple-600 dark:text-purple-300 ring-1 ring-purple-500/30 font-semibold'
                              : 'border-border bg-surface-muted/60 text-muted-text hover:border-border-input'
                          }`}
                        >
                          <span className={`size-1.5 rounded-full ${isSelected ? 'bg-purple-500' : 'bg-muted'}`} />
                          <span>
                            x{idx + 1}: {name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* SVG Preview Card */}
              <div className="rounded-xl border border-border bg-surface-elevated p-4 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-foreground uppercase tracking-wide block mb-1">
                    Closed-Loop Reference Profile Preview
                  </span>
                  <p className="text-[11px] text-muted-text">
                    Reference path target waveform tracked across horizon window.
                  </p>
                </div>

                <div className="h-28 w-full my-2 relative flex items-center justify-center">
                  <svg viewBox="0 0 360 90" className="size-full overflow-visible">
                    <line x1="0" y1="45" x2="360" y2="45" stroke="var(--app-border)" strokeDasharray="3 3" />
                    <path
                      d={trajectorySvgPath}
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

                <div className="flex justify-between text-[10px] font-mono text-muted border-t border-border/80 pt-2">
                  <span>t = 0.0s</span>
                  <span>Target Waveform</span>
                  <span>t = {params.simTime}s</span>
                </div>
              </div>
            </div>

            {/* Scenario Uncertainty Level */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-300 block mb-2">
                Plant Uncertainty &amp; Disturbance Injection
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => onChangeParams({ scenarioLevel: 1, customDriftPct: 0, disturbanceAmp: 0 })}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    params.scenarioLevel === 1
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                      : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-foreground">Level 1 · Nominal</span>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-mono text-emerald-600 dark:text-emerald-300">
                      Clean
                    </span>
                  </div>
                  <p className="text-[11.5px] text-muted-text">
                    Exact model dynamics without parameter drift or disturbance steps.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onChangeParams({ scenarioLevel: 2, customDriftPct: 20, disturbanceAmp: 0 })}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    params.scenarioLevel === 2
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                      : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-foreground">Level 2 · Parameter Drift</span>
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono text-amber-600 dark:text-amber-300">
                      &plusmn;20%
                    </span>
                  </div>
                  <p className="text-[11.5px] text-muted-text">
                    Uncertain mass, inertia, and joint friction variations.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onChangeParams({ scenarioLevel: 3, customDriftPct: 20, disturbanceAmp: 1.0 })}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    params.scenarioLevel === 3
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                      : 'border-border bg-surface-muted/50 text-muted-text hover:border-border-input hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-foreground">Level 3 · Force Step</span>
                    <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-mono text-rose-600 dark:text-rose-300">
                      Disturbance
                    </span>
                  </div>
                  <p className="text-[11.5px] text-muted-text">
                    External torque and wind-gust impulses injected during closed loop.
                  </p>
                </button>
              </div>

              {/* Advanced Uncertainty & Disturbance Tuning Drawer */}
              <div className="mt-3 rounded-xl border border-border bg-surface-elevated/60 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowCustomScenario(!showCustomScenario)}
                    className="flex items-center gap-2 text-xs font-bold text-foreground hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                  >
                    <Zap className="size-3.5 text-purple-500" />
                    <span>Advanced / Custom Uncertainty &amp; Disturbance Knobs</span>
                    <span className="text-[10px] font-mono text-muted bg-surface-muted px-1.5 py-0.5 rounded border border-border">
                      {showCustomScenario ? 'Hide Knobs ▲' : 'Customize Sliders ▼'}
                    </span>
                  </button>
                </div>

                {showCustomScenario && (
                  <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] text-muted-text mb-1">
                        Disturbance Force Magnitude: <b>{params.disturbanceAmp}</b>
                      </label>
                      <input
                        type="range"
                        min={0.1}
                        max={3.0}
                        step={0.1}
                        value={params.disturbanceAmp}
                        onChange={(e) => onChangeParams({ disturbanceAmp: Number(e.target.value) })}
                        className="w-full accent-rose-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-muted-text mb-1">
                        Parameter Drift Percentage: <b>&plusmn;{params.customDriftPct}%</b>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={50}
                        step={1}
                        value={params.customDriftPct}
                        onChange={(e) => onChangeParams({ customDriftPct: Number(e.target.value) })}
                        className="w-full accent-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: TUNING, CONSTRAINTS & PRE-FLIGHT DIAGNOSTICS */}
        {setupTab === 'tuning' && (
          <div className="mt-6 space-y-6">
            {/* Pre-flight Dynamics Diagnostics Panel */}
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Gauge className="size-4 text-cyan-500" />
                    <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Pre-Flight Dynamics Diagnostics &amp; Bryson Seed Estimation
                    </h4>
                    {diagnostics && (
                      <span className="rounded bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 px-2 py-0.5 text-[10px] font-mono font-semibold border border-cyan-500/30">
                        Auto-Probed
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-text mt-1">
                    Runs open-loop step response probe, checks linearized eigenvalues, verifies controllability rank, and calculates Bryson seed weights Q and R.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onTestDynamics}
                  disabled={testingDynamics}
                  className={`${btnBase} ${btnCompact} border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 hover:bg-cyan-500/20 flex items-center gap-1.5 text-xs font-semibold`}
                >
                  {testingDynamics ? (
                    <>
                      <Cpu className="size-3.5 animate-spin" /> Probing Dynamics...
                    </>
                  ) : (
                    <>
                      <Zap className="size-3.5 text-cyan-500" />{' '}
                      {diagnostics ? 'Re-run Dynamics & Bryson Probe' : 'Test Dynamics & Bryson Probe'}
                    </>
                  )}
                </button>
              </div>

              {/* Diagnostics Results Cards */}
              {diagnostics && (
                <div className="space-y-4 pt-2 border-t border-cyan-500/20">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="rounded-lg border border-border bg-surface-elevated p-3">
                      <span className="text-[10.5px] text-muted-text block mb-1">Open-Loop Stability</span>
                      <span
                        className={`font-bold flex items-center gap-1 text-sm ${
                          diagnostics.is_stable ? 'text-emerald-500 dark:text-emerald-400' : 'text-amber-500 dark:text-amber-400'
                        }`}
                      >
                        {diagnostics.is_stable ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                        {diagnostics.is_stable ? 'Stable' : 'Unstable Mode'}
                      </span>
                    </div>

                    <div className="rounded-lg border border-border bg-surface-elevated p-3">
                      <span className="text-[10.5px] text-muted-text block mb-1">Suggested Sample Time</span>
                      <span className="font-bold text-cyan-600 dark:text-cyan-300 text-sm">
                        dt = {diagnostics.suggested_dt ? diagnostics.suggested_dt.toFixed(4) : '0.02'}s
                      </span>
                    </div>

                    <div className="rounded-lg border border-border bg-surface-elevated p-3">
                      <span className="text-[10.5px] text-muted-text block mb-1">Eigenvalues Count</span>
                      <span className="font-bold text-purple-600 dark:text-purple-300 text-sm">
                        {diagnostics.eigenvalues?.length ?? 4} poles
                      </span>
                    </div>

                    <div className="rounded-lg border border-border bg-surface-elevated p-3">
                      <span className="text-[10.5px] text-muted-text block mb-1">Bryson Q Matrix</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-300 text-xs truncate block">
                        Seeded &amp; Applied
                      </span>
                    </div>
                  </div>

                  {diagnostics.notes && diagnostics.notes.length > 0 && (
                    <div className="rounded-lg border border-border bg-surface-muted p-3 text-[11px] font-mono text-muted-text space-y-1">
                      {diagnostics.notes.map((note, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-cyan-500">&gt;</span>
                          <span>{note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Agentic MPC Tuning Knobs */}
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Sliders className="size-3.5 text-purple-500" />
                  Agentic MPC Horizons &amp; Weights
                </span>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-surface-muted text-[11px] font-mono text-muted-text">
                  <Clock className="size-3" />
                  <span>
                    Total Sim Time: <b className="font-bold text-foreground">{params.simTime}s</b>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
                <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-1">
                  <div className="flex justify-between text-muted-text">
                    <span>Prediction Horizon (Np)</span>
                    <span className="text-foreground font-bold">{params.np}</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={30}
                    step={1}
                    value={params.np}
                    onChange={(e) => onChangeParams({ np: Number(e.target.value) })}
                    className="w-full accent-purple-500"
                  />
                  <span className="text-[10.5px] text-muted block">Lookahead prediction steps</span>
                </div>

                <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-1">
                  <div className="flex justify-between text-muted-text">
                    <span>Control Horizon (Nc)</span>
                    <span className="text-foreground font-bold">{params.nc}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={Math.min(params.np, 15)}
                    step={1}
                    value={params.nc}
                    onChange={(e) => onChangeParams({ nc: Number(e.target.value) })}
                    className="w-full accent-purple-500"
                  />
                  <span className="text-[10.5px] text-muted block">Free control trajectory moves</span>
                </div>

                <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-1">
                  <span className="text-muted-text block">Discretization Step (dt)</span>
                  <input
                    type="number"
                    step="0.005"
                    min="0.001"
                    max="0.2"
                    value={params.dtMpc}
                    onChange={(e) => onChangeParams({ dtMpc: parseFloat(e.target.value) || 0.02 })}
                    className="w-full rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-foreground"
                  />
                  <span className="text-[10.5px] text-muted block">Discrete integration step</span>
                </div>

                <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-1">
                  <span className="text-muted-text block">Simulation Time (s)</span>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="30"
                    value={params.simTime}
                    onChange={(e) => onChangeParams({ simTime: parseFloat(e.target.value) || 3.0 })}
                    className="w-full rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 font-mono text-xs text-foreground"
                  />
                  <span className="text-[10.5px] text-muted block">Total validation window</span>
                </div>
              </div>

              {/* Penalty Matrices Q & R */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2">
                  <label className="text-xs font-semibold text-foreground block">
                    State Weights Q (diagonal elements, comma separated):
                  </label>
                  <input
                    type="text"
                    value={params.qWeightsInput}
                    onChange={(e) => onChangeParams({ qWeightsInput: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface px-4 py-2 text-xs font-mono text-foreground"
                    placeholder="10.0, 1.0, 10.0, 1.0"
                  />
                  <span className="text-[10.5px] text-muted block">
                    Penalizes deviation of state channels from reference setpoint.
                  </span>
                </div>

                <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2">
                  <label className="text-xs font-semibold text-foreground block">
                    Actuator Penalty R (diagonal elements, comma separated):
                  </label>
                  <input
                    type="text"
                    value={params.rWeightsInput}
                    onChange={(e) => onChangeParams({ rWeightsInput: e.target.value })}
                    className="w-full rounded-xl border border-border bg-surface px-4 py-2 text-xs font-mono text-foreground"
                    placeholder="0.1"
                  />
                  <span className="text-[10.5px] text-muted block">
                    Penalizes aggressive actuator moves to avoid input saturation.
                  </span>
                </div>
              </div>

              {/* User Guidance Prompt */}
              <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2">
                <label className="text-xs font-semibold text-foreground block">
                  User Directive / Agent Guidance Prompt (Optional):
                </label>
                <input
                  type="text"
                  value={userGuidance}
                  onChange={(e) => setUserGuidance(e.target.value)}
                  placeholder="e.g. Optimize for rapid setpoint tracking with tight state bounds and no overshoot..."
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2 text-xs text-foreground placeholder:text-muted"
                />
              </div>
            </div>
          </div>
        )}

        {/* Bottom Action Footer */}
        <div className="mt-8 pt-5 border-t border-border flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-muted-text">
            <span>Ready to synthesize. Click start to launch autonomous multi-agent MPC tuning.</span>
          </div>

          <button
            type="button"
            onClick={handleLaunch}
            disabled={isRunning}
            className={`${btnPrimary} flex items-center gap-2 text-xs shadow-md px-6 py-2.5 font-bold`}
          >
            {isRunning ? (
              <>
                <Cpu className="size-4 animate-spin" /> Synthesizing...
              </>
            ) : (
              <>
                <Play className="size-4" /> Start Autonomous Tuning &rarr;
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
