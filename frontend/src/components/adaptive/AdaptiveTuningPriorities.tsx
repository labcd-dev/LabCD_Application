import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  BatteryCharging,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Crosshair,
  Info,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Sparkles,
  Target,
  Timer,
  Waves,
  Zap,
} from 'lucide-react'
import { btnBase, btnCompact } from '../../lib/classes'

export interface TuningObjectiveDefinition {
  key: string
  label: string
  category: 'tracking' | 'actuator' | 'robustness'
  description: string
  icon: typeof Target
  badgeColor: string
}

export const TUNING_OBJECTIVES: TuningObjectiveDefinition[] = [
  {
    key: 'steady_state_error',
    label: 'Steady-State Error',
    category: 'tracking',
    description: 'Minimizes steady-state tracking offset after settling',
    icon: Target,
    badgeColor: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  },
  {
    key: 'tracking_mse',
    label: 'Overall Tracking Accuracy',
    category: 'tracking',
    description: 'Minimizes continuous reference tracking error throughout the simulation',
    icon: Crosshair,
    badgeColor: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20',
  },
  {
    key: 'overshoot',
    label: 'Overshoot Suppression',
    category: 'tracking',
    description: 'Limits peak deviation beyond reference step/signal',
    icon: ArrowUpRight,
    badgeColor: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
  {
    key: 'settling_time',
    label: 'Settling Time (Ts)',
    category: 'tracking',
    description: 'Accelerates convergence into the Lyapunov boundary layer',
    icon: Timer,
    badgeColor: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  },
  {
    key: 'transient_error',
    label: 'Transient Error',
    category: 'tracking',
    description: 'Penalizes large dynamic deviations during the initial rise phase',
    icon: Zap,
    badgeColor: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/20',
  },
  {
    key: 'control_effort',
    label: 'Control Effort (RMS)',
    category: 'actuator',
    description: 'Minimizes average energy and actuator power consumption',
    icon: BatteryCharging,
    badgeColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  },
  {
    key: 'control_max',
    label: 'Peak Control Force |u|',
    category: 'actuator',
    description: 'Prevents actuator saturation and hard physical limit violations',
    icon: ShieldAlert,
    badgeColor: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20',
  },
  {
    key: 'control_smoothness',
    label: 'Control Smoothness',
    category: 'actuator',
    description: 'Dampens high-frequency jumps and mechanical actuator wear',
    icon: Waves,
    badgeColor: 'text-teal-600 dark:text-teal-400 bg-teal-500/10 border-teal-500/20',
  },
  {
    key: 'chattering',
    label: 'Chattering (SMC)',
    category: 'robustness',
    description: 'Attenuates high-frequency discontinuous switching on the sliding manifold',
    icon: Activity,
    badgeColor: 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20',
  },
  {
    key: 'estimator_accuracy',
    label: 'Estimator & RBF Accuracy',
    category: 'robustness',
    description: 'Maximizes neural weight adaptation fidelity for unmodeled disturbances',
    icon: Cpu,
    badgeColor: 'text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20',
  },
]

export const TUNING_PRESETS: Record<string, { label: string; icon: string; weights: Record<string, number> }> = {
  balanced: {
    label: 'Balanced Default',
    icon: '🎯',
    weights: {
      steady_state_error: 3,
      tracking_mse: 3,
      control_smoothness: 3,
    },
  },
  aggressive: {
    label: 'Aggressive Tracking',
    icon: '⚡',
    weights: {
      tracking_mse: 5,
      settling_time: 4,
      steady_state_error: 4,
      overshoot: 4,
    },
  },
  smooth: {
    label: 'Smooth & Chattering-Free',
    icon: '🌊',
    weights: {
      control_smoothness: 5,
      chattering: 5,
      control_max: 4,
    },
  },
  low_effort: {
    label: 'Minimal Control Effort',
    icon: '🔋',
    weights: {
      control_effort: 5,
      control_max: 5,
      control_smoothness: 3,
    },
  },
}

function getWeightLabel(weight: number): { label: string; color: string } {
  switch (weight) {
    case 1:
      return { label: 'Minor (1)', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' }
    case 2:
      return { label: 'Low (2)', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' }
    case 3:
      return { label: 'Balanced (3)', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' }
    case 4:
      return { label: 'High (4)', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' }
    case 5:
      return { label: 'Critical (5)', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' }
    default:
      return { label: `Level (${weight})`, color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' }
  }
}

interface AdaptiveTuningPrioritiesProps {
  weights: Record<string, number>
  onChange: (weights: Record<string, number>) => void
  disabled?: boolean
}

export function AdaptiveTuningPriorities({
  weights,
  onChange,
  disabled = false,
}: AdaptiveTuningPrioritiesProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [filterCategory, setFilterCategory] = useState<'all' | 'tracking' | 'actuator' | 'robustness'>('all')

  const activeCount = Object.keys(weights).length

  const handleToggle = (key: string) => {
    if (disabled) return
    const next = { ...weights }
    if (key in next) {
      delete next[key]
    } else {
      next[key] = 3
    }
    onChange(next)
  }

  const handleWeightChange = (key: string, value: number) => {
    if (disabled) return
    onChange({
      ...weights,
      [key]: value,
    })
  }

  const handleApplyPreset = (presetKey: string) => {
    if (disabled) return
    const preset = TUNING_PRESETS[presetKey]
    if (preset) {
      onChange({ ...preset.weights })
    }
  }

  const handleClear = () => {
    if (disabled) return
    onChange({})
  }

  const filteredObjectives = useMemo(() => {
    if (filterCategory === 'all') return TUNING_OBJECTIVES
    return TUNING_OBJECTIVES.filter((obj) => obj.category === filterCategory)
  }, [filterCategory])

  return (
    <div className="rounded-xl border border-border bg-surface-elevated/70 shadow-xs overflow-hidden transition-all duration-200">
      {/* Header Toggle */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-hover/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30">
            <Sliders className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Tuning Priorities &amp; Objective Weights
              </span>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-600 dark:text-cyan-300">
                {activeCount > 0 ? `${activeCount} Active` : 'Auto (Tuner Decides)'}
              </span>
            </div>
            <p className="text-[11px] text-muted-text mt-0.5">
              Guide the Lyapunov Tuner Agent by prioritizing smoothness, settling time, or chatter reduction (1 to 5)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-muted-text">
          <span className="text-xs font-medium hidden sm:inline">
            {isOpen ? 'Collapse' : 'Customize Priorities'}
          </span>
          {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </div>
      </button>

      {/* Expanded Content Area */}
      {isOpen && (
        <div className="border-t border-border p-4 space-y-4 bg-surface/40 animate-in fade-in-50 duration-150">
          {/* Tuner Engine Transparency Callout (FR17) */}
          <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3 text-xs text-muted-text space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-cyan-600 dark:text-cyan-400">
              <Info className="size-3.5" />
              <span>How Priority Weights Guide the Tuner Engine</span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted-text">
              Assigned weights (1 to 5) configure the Tuner Agent’s badness objective function{' '}
              <code className="px-1.5 py-0.5 rounded bg-surface border border-border font-mono text-foreground text-[10.5px]">
                J = &sum; w_i &times; badness_i
              </code>. High weights steer the optimizer to dynamically calibrate Lyapunov boundary layer width (&phi;), adaptation learning rate (&Gamma;), and sliding surface slope (&lambda;) to prioritize chosen tracking and actuator metrics.
            </p>
          </div>

          {/* Presets Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-muted-text flex items-center gap-1.5">
                <Sparkles className="size-3 text-cyan-500" /> Quick Engineering Presets:
              </label>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={disabled}
                  className={`${btnBase} ${btnCompact} text-[10.5px] text-muted-text hover:text-rose-400 gap-1`}
                >
                  <RotateCcw className="size-3" /> Clear All
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(TUNING_PRESETS).map(([k, p]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleApplyPreset(k)}
                  disabled={disabled}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface hover:bg-surface-hover px-2.5 py-1.5 text-xs text-foreground font-medium transition-all shadow-2xs hover:border-cyan-500/40"
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 border-b border-border/70 pb-3 overflow-x-auto scrollbar-none">
            <span className="text-[10.5px] text-muted font-medium mr-1">Filter:</span>
            {[
              { id: 'all', label: 'All 10 Objectives' },
              { id: 'tracking', label: 'Tracking & Precision' },
              { id: 'actuator', label: 'Actuator & Energy' },
              { id: 'robustness', label: 'Robustness & SMC' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterCategory(tab.id as typeof filterCategory)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap ${
                  filterCategory === tab.id
                    ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30'
                    : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Objectives Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredObjectives.map((obj) => {
              const Icon = obj.icon
              const isSelected = obj.key in weights
              const weight = weights[obj.key] ?? 3
              const weightInfo = getWeightLabel(weight)

              return (
                <div
                  key={obj.key}
                  className={`rounded-xl border p-3 transition-all duration-150 flex flex-col justify-between ${
                    isSelected
                      ? 'border-cyan-500/40 bg-surface-elevated/90 shadow-xs ring-1 ring-cyan-500/20'
                      : 'border-border/70 bg-surface hover:border-border hover:bg-surface-hover/60'
                  } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`flex size-7 shrink-0 items-center justify-center rounded-lg border ${obj.badgeColor}`}
                        >
                          <Icon className="size-3.5" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-foreground truncate">
                            {obj.label}
                          </h4>
                          <p className="text-[10.5px] text-muted-text leading-tight mt-0.5 line-clamp-1">
                            {obj.description}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggle(obj.key)}
                        disabled={disabled}
                        className={`size-5 shrink-0 rounded-md border flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-cyan-500 border-cyan-500 text-white shadow-2xs'
                            : 'border-border bg-surface hover:border-cyan-500/50 text-transparent'
                        }`}
                        title={isSelected ? 'Remove priority' : 'Enable priority'}
                      >
                        <Check className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Weight Slider (Visible only when selected) */}
                  {isSelected && (
                    <div className="mt-3 pt-2.5 border-t border-border/60 space-y-1.5 animate-in fade-in-30">
                      <div className="flex items-center justify-between text-[10.5px]">
                        <span className="text-muted-text font-medium">Importance Weight:</span>
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold border ${weightInfo.color}`}
                        >
                          {weightInfo.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-muted">1</span>
                        <input
                          type="range"
                          min="1"
                          max="5"
                          step="1"
                          value={weight}
                          onChange={(e) => handleWeightChange(obj.key, parseInt(e.target.value, 10))}
                          disabled={disabled}
                          className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-muted accent-cyan-500 focus:outline-none"
                        />
                        <span className="text-[10px] font-mono text-muted">5</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Active Summary Banner */}
          {activeCount > 0 && (
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5 text-[11px] text-muted-text flex flex-wrap items-center gap-1.5 font-mono">
              <span className="font-bold text-cyan-600 dark:text-cyan-400">Active Guidance:</span>
              {Object.entries(weights).map(([k, v]) => {
                const label = TUNING_OBJECTIVES.find((o) => o.key === k)?.label || k
                return (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded bg-surface-elevated border border-border px-1.5 py-0.5 text-[10px] text-foreground"
                  >
                    {label}: <b className="text-cyan-500">{v}</b>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
