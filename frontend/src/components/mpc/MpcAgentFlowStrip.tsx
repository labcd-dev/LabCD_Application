import { CheckCircle2, ChevronRight, Cpu, Scale, ShieldAlert, Sparkles, Workflow, Check } from 'lucide-react'
import type { MPCJobStage } from '../../api/types'

interface MpcAgentFlowStripProps {
  currentStage?: MPCJobStage | string | null
  isCompleted?: boolean
}

export function MpcAgentFlowStrip({
  currentStage,
  isCompleted = false,
}: MpcAgentFlowStripProps) {
  const getStageIndex = (stage?: string | null, done = false): number => {
    if (done) return 4
    if (!stage) return 0
    const s = stage.toLowerCase()
    if (s.includes('actor') || s.includes('synth')) return 0
    if (s.includes('eval') || s.includes('simul')) return 1
    if (s.includes('term') || s.includes('watch') || s.includes('check')) return 2
    if (s.includes('crit') || s.includes('juror') || s.includes('pareto')) return 3
    if (s.includes('done') || s.includes('comp') || s.includes('converge')) return 4
    return 0
  }

  const activeIndex = getStageIndex(currentStage, isCompleted)

  const steps = [
    {
      index: 0,
      stepNum: '01',
      id: 'actor',
      name: 'Actor',
      role: 'Parameter Synthesizer',
      desc: 'Proposes Np, Nc, Q, R & dt',
      icon: Sparkles,
      color: 'blue',
    },
    {
      index: 1,
      stepNum: '02',
      id: 'evaluator',
      name: 'Evaluator',
      role: 'Nonlinear Simulator',
      desc: 'Solves OSQP active-set loop',
      icon: Cpu,
      color: 'cyan',
    },
    {
      index: 2,
      stepNum: '03',
      id: 'terminator',
      name: 'Terminator',
      role: 'Convergence Watchdog',
      desc: 'Checks stopping tolerance',
      icon: ShieldAlert,
      color: 'rose',
    },
    {
      index: 3,
      stepNum: '04',
      id: 'critic',
      name: 'Critic / Juror',
      role: 'Pareto Authority',
      desc: 'Scores trade-off optimality',
      icon: Scale,
      color: 'emerald',
    },
  ]

  const getStepStatus = (idx: number) => {
    if (isCompleted || activeIndex > idx) return 'completed'
    if (activeIndex === idx) return 'active'
    return 'pending'
  }

  // Active step for header badge
  const activeStep = steps[activeIndex] || steps[0]

  return (
    <div className="rounded-2xl border border-border bg-surface-elevated p-3.5 sm:p-4 text-foreground shadow-sm flex flex-col justify-between h-full space-y-2.5 sm:space-y-3">
      {/* Top Header */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30">
            <Workflow className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-foreground truncate">
              Agent Pipeline DAG
            </h3>
            <p className="text-[10px] text-muted-text truncate hidden xs:block">
              Autonomous Multi-Agent Orchestration &amp; Feedback Graph
            </p>
          </div>
        </div>

        {isCompleted ? (
          <span className="shrink-0 flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
            <CheckCircle2 className="size-3.5" /> Tuning Converged
          </span>
        ) : (
          <span className="shrink-0 flex items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-500/15 px-2 py-0.5 text-[10.5px] font-bold text-purple-600 dark:text-purple-300 shadow-xs whitespace-nowrap">
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-purple-500" />
            </span>
            Live: Step {activeStep.stepNum} · {activeStep.name}
          </span>
        )}
      </div>

      {/* Visual Connected Stepper Bar */}
      <div className="rounded-xl border border-border/70 bg-surface-muted/50 p-2 overflow-x-auto scrollbar-none">
        <div className="flex items-center justify-between min-w-[280px] sm:min-w-0">
          {steps.map((step, idx) => {
            const status = getStepStatus(idx)
            return (
              <div key={step.id} className="flex items-center flex-1 last:flex-initial">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
                      status === 'completed'
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : status === 'active'
                        ? 'bg-purple-600 text-white shadow-sm ring-2 ring-purple-400/60 animate-pulse'
                        : 'bg-surface text-muted-text border border-border'
                    }`}
                  >
                    {status === 'completed' ? <Check className="size-3 stroke-[3]" /> : step.index + 1}
                  </div>
                  <span
                    className={`text-[11px] whitespace-nowrap transition-colors ${
                      status === 'active'
                        ? 'font-bold text-purple-600 dark:text-purple-300'
                        : status === 'completed'
                        ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                        : 'font-medium text-muted-text'
                    }`}
                  >
                    {step.name}
                  </span>
                  {status === 'active' && (
                    <span className="relative flex size-1.5 shrink-0 ml-0.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-purple-500" />
                    </span>
                  )}
                </div>

                {idx < steps.length - 1 && (
                  <div className="flex-1 mx-1.5 sm:mx-2 flex items-center min-w-2">
                    <div
                      className={`h-0.5 w-full transition-all duration-300 ${
                        activeIndex > idx
                          ? 'bg-emerald-500'
                          : activeIndex === idx
                          ? 'bg-gradient-to-r from-purple-500 to-border'
                          : 'bg-border'
                      }`}
                    />
                    <ChevronRight
                      className={`size-3 shrink-0 -ml-1 transition-colors ${
                        activeIndex > idx
                          ? 'text-emerald-500'
                          : activeIndex === idx
                          ? 'text-purple-500'
                          : 'text-muted/40'
                      }`}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 4 Connected Step Cards: 2x2 on mobile, 4 cols on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {steps.map((step) => {
          const Icon = step.icon
          const status = getStepStatus(step.index)
          const isActive = status === 'active'
          const isDone = status === 'completed'

          return (
            <div
              key={step.id}
              className={`relative flex flex-col justify-between rounded-xl border p-2 sm:p-2.5 transition-all ${
                isActive
                  ? 'border-purple-500 bg-purple-500/15 shadow-sm ring-1 ring-purple-500/40'
                  : isDone
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-border bg-surface hover:border-border-strong opacity-80'
              }`}
            >
              {/* Card Step Badge Header */}
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-[9px] font-mono font-bold ${
                    isActive
                      ? 'text-purple-600 dark:text-purple-300'
                      : isDone
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-text'
                  }`}
                >
                  STEP {step.stepNum}
                </span>

                {isActive ? (
                  <span className="flex items-center gap-1 rounded-full bg-purple-600 px-1.5 py-0.2 text-[8px] font-bold text-white shadow-xs animate-pulse">
                    <span className="size-1 rounded-full bg-white animate-ping" />
                    LIVE
                  </span>
                ) : isDone ? (
                  <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[8px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <Check className="size-2.5" /> Done
                  </span>
                ) : (
                  <span className="text-[8px] text-muted font-medium">
                    Queued
                  </span>
                )}
              </div>

              {/* Main Agent Info */}
              <div className="flex items-start gap-1.5 sm:gap-2">
                <div
                  className={`flex size-6 sm:size-7 shrink-0 items-center justify-center rounded-lg text-sm border ${
                    isActive
                      ? 'bg-purple-500/25 text-purple-700 dark:text-purple-200 border-purple-500/50 shadow-xs'
                      : isDone
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                      : 'bg-surface-muted text-muted border-border'
                  }`}
                >
                  <Icon className="size-3 sm:size-3.5" />
                </div>
                <div className="min-w-0">
                  <span
                    className={`text-xs font-bold block leading-tight truncate ${
                      isActive ? 'text-purple-700 dark:text-purple-200' : 'text-foreground'
                    }`}
                  >
                    {step.name}
                  </span>
                  <span className="text-[9.5px] font-medium text-foreground/80 block leading-tight truncate">
                    {step.role}
                  </span>
                </div>
              </div>

              {/* Subtitle / Desc */}
              <div className="mt-1.5 pt-1.5 border-t border-border/50 text-[8.5px] text-muted-text truncate">
                {step.desc}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
