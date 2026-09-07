import { CheckCircle2, Cpu, Gauge, ShieldCheck, Workflow, Check, MessageSquare, Activity } from 'lucide-react'
import type { AdaptiveJobStage } from '../../api/types'

interface AdaptiveAgentFlowStripProps {
  currentStage?: AdaptiveJobStage | string | null
  isCompleted?: boolean
}

export function AdaptiveAgentFlowStrip({
  currentStage,
  isCompleted = false,
}: AdaptiveAgentFlowStripProps) {
  const getStageIndex = (stage?: string | null, done = false): number => {
    if (done) return 4
    if (!stage) return 0
    const s = stage.toLowerCase()
    if (s.includes('clarif')) return 0
    if (s.includes('design') || s.includes('synth')) return 1
    if (s.includes('build') || s.includes('simul')) return 2
    if (s.includes('tune') || s.includes('adapt') || s.includes('opt')) return 3
    if (s.includes('done') || s.includes('comp') || s.includes('certif') || s.includes('juror') || s.includes('judge')) return 4
    return 1
  }

  const activeIndex = getStageIndex(currentStage, isCompleted)

  const steps = [
    {
      index: 0,
      stepNum: '01',
      id: 'clarifier',
      name: 'Clarifier',
      role: 'System Formulation',
      desc: 'Infers dynamics & unmodeled friction',
      icon: MessageSquare,
      color: 'blue',
    },
    {
      index: 1,
      stepNum: '02',
      id: 'designer',
      name: 'Designer',
      role: 'Lyapunov Synthesizer',
      desc: 'Derives sliding manifold & backstepping',
      icon: Cpu,
      color: 'cyan',
    },
    {
      index: 2,
      stepNum: '03',
      id: 'simulator',
      name: 'Simulator',
      role: 'Nonlinear ODE Integrator',
      desc: 'Simulates tracking & boundary layer',
      icon: Gauge,
      color: 'teal',
    },
    {
      index: 3,
      stepNum: '04',
      id: 'tuner',
      name: 'Tuner',
      role: 'Adaptive Optimizer',
      desc: 'Refines adaptation gain Γ & boundary ϵ',
      icon: Activity,
      color: 'purple',
    },
    {
      index: 4,
      stepNum: '05',
      id: 'juror',
      name: 'Juror / Certified',
      role: 'Stability Authority',
      desc: 'Verifies dV/dt ≤ -η|s| bound guarantee',
      icon: ShieldCheck,
      color: 'emerald',
    },
  ]

  const getStepStatus = (idx: number) => {
    if (isCompleted || activeIndex > idx) return 'completed'
    if (activeIndex === idx) return 'active'
    return 'pending'
  }

  const activeStep = steps[activeIndex] || steps[0]

  return (
    <div className="rounded-2xl border border-border bg-surface-elevated p-3.5 sm:p-4 text-foreground shadow-sm flex flex-col justify-between h-full space-y-2.5 sm:space-y-3">
      {/* Top Header */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30">
            <Workflow className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-foreground truncate">
              Adaptive Agent Pipeline DAG
            </h3>
            <p className="text-[10px] text-muted-text truncate hidden xs:block">
              Multi-Agent Nonlinear Control Synthesis &amp; Stability Verification
            </p>
          </div>
        </div>

        {isCompleted ? (
          <span className="shrink-0 flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
            <CheckCircle2 className="size-3.5" /> Lyapunov Certified
          </span>
        ) : (
          <span className="shrink-0 flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[10.5px] font-bold text-cyan-600 dark:text-cyan-300 shadow-xs whitespace-nowrap">
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-cyan-500" />
            </span>
            Live: Step {activeStep.stepNum} · {activeStep.name}
          </span>
        )}
      </div>

      {/* Visual Connected Stepper Bar */}
      <div className="rounded-xl border border-border/70 bg-surface-muted/50 p-2 overflow-x-auto scrollbar-none">
        <div className="flex items-center justify-between min-w-[340px] sm:min-w-0">
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
                        ? 'bg-cyan-600 text-white shadow-sm ring-2 ring-cyan-400/60 animate-pulse'
                        : 'bg-surface text-muted-text border border-border'
                    }`}
                  >
                    {status === 'completed' ? <Check className="size-3 stroke-[3]" /> : step.index + 1}
                  </div>
                  <span
                    className={`text-[10.5px] font-semibold transition-colors whitespace-nowrap hidden sm:inline ${
                      status === 'completed'
                        ? 'text-foreground'
                        : status === 'active'
                        ? 'text-cyan-600 dark:text-cyan-300 font-bold'
                        : 'text-muted-text'
                    }`}
                  >
                    {step.name}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div className="flex-1 mx-2 h-0.5 min-w-[12px] bg-border overflow-hidden rounded-full">
                    <div
                      className={`h-full transition-all duration-300 ${
                        getStepStatus(idx + 1) !== 'pending' ? 'bg-emerald-500' : 'bg-transparent'
                      }`}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 5 Compact Agent Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {steps.map((step, idx) => {
          const status = getStepStatus(idx)
          const Icon = step.icon
          const isAct = status === 'active'
          const isDone = status === 'completed'

          return (
            <div
              key={step.id}
              className={`relative overflow-hidden rounded-xl border p-2.5 transition-all flex flex-col justify-between ${
                isAct
                  ? 'border-cyan-500/60 bg-cyan-500/10 shadow-xs ring-1 ring-cyan-500/30'
                  : isDone
                  ? 'border-border/60 bg-surface hover:border-emerald-500/30'
                  : 'border-border/40 bg-surface-muted/40 opacity-70'
              }`}
            >
              {isAct && (
                <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-cyan-400 to-teal-400 animate-pulse" />
              )}
              {isDone && (
                <div className="absolute top-0 inset-x-0 h-0.5 bg-emerald-500/60" />
              )}

              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-mono text-[9px] text-muted-text font-bold">
                    {step.stepNum}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                      isDone
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : isAct
                        ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                        : 'bg-surface text-muted-text'
                    }`}
                  >
                    {status}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <div
                    className={`flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] ${
                      isAct
                        ? 'bg-cyan-500 text-white'
                        : isDone
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-surface text-muted-text border border-border'
                    }`}
                  >
                    <Icon className="size-3" />
                  </div>
                  <h4 className="text-[11px] font-bold text-foreground truncate">
                    {step.name}
                  </h4>
                </div>

                <p className="mt-1 text-[9.5px] font-medium text-cyan-600 dark:text-cyan-300 truncate">
                  {step.role}
                </p>
                <p className="text-[9px] text-muted-text line-clamp-2 leading-tight mt-0.5">
                  {step.desc}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
