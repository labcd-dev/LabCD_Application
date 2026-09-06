import { CheckCircle2, Cpu, Scale, ShieldAlert, Sparkles } from 'lucide-react'
import type { MPCJobStage } from '../../api/types'

interface MpcAgentFlowStripProps {
  currentStage: MPCJobStage
  isCompleted: boolean
}

export function MpcAgentFlowStrip({ currentStage, isCompleted }: MpcAgentFlowStripProps) {
  const nodes = [
    {
      id: 'actor',
      name: 'Actor',
      desc: 'Proposes Np, Nc, Q, R',
      icon: Sparkles,
      active: currentStage === 'actor',
    },
    {
      id: 'evaluator',
      name: 'Evaluator',
      desc: 'Simulates OSQP loop',
      icon: Cpu,
      active: currentStage === 'evaluator',
    },
    {
      id: 'terminator',
      name: 'Terminator',
      desc: 'Checks stopping rule',
      icon: ShieldAlert,
      active: currentStage === 'terminator',
    },
    {
      id: 'critic',
      name: 'Critic / Juror',
      desc: 'Scores performance',
      icon: Scale,
      active: currentStage === 'critic' || currentStage === 'juror',
    },
  ]

  return (
    <div className="rounded-2xl border border-white/10 bg-[#11161d] p-4 text-[#eef2f8] shadow-xl">
      <div className="flex items-center justify-between mb-3 text-xs font-semibold text-slate-400">
        <span className="uppercase tracking-wider text-[10px]">Multi-Agent Tuning Graph</span>
        {isCompleted ? (
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="size-3" /> Tuning Converged
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-purple-300">
            <span className="size-2 rounded-full bg-purple-400 animate-ping" />
            Graph Active
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-1">
        {nodes.map((node, i) => {
          const Icon = node.icon
          return (
            <div key={node.id} className="flex items-center flex-1">
              <div
                className={`relative flex flex-col items-center flex-1 rounded-xl border p-2.5 transition-all text-center ${
                  node.active
                    ? 'border-purple-400/50 bg-purple-500/15 shadow-md shadow-purple-500/20'
                    : isCompleted
                    ? 'border-emerald-500/20 bg-emerald-500/5 text-slate-300'
                    : 'border-white/5 bg-white/5 text-slate-400'
                }`}
              >
                {node.active && (
                  <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(185,139,255,0.8)] animate-pulse" />
                )}
                <div
                  className={`flex size-7 items-center justify-center rounded-lg text-xs mb-1.5 ${
                    node.active
                      ? 'bg-purple-500/30 text-purple-200'
                      : 'bg-white/5 text-slate-400'
                  }`}
                >
                  <Icon className="size-3.5" />
                </div>
                <span className={`text-[11px] font-bold ${node.active ? 'text-white' : 'text-slate-300'}`}>
                  {node.name}
                </span>
                <span className="text-[9.5px] text-slate-500 hidden sm:block mt-0.5">{node.desc}</span>
              </div>

              {i < nodes.length - 1 && (
                <div
                  className={`h-0.5 w-3 shrink-0 mx-1 transition-colors ${
                    node.active ? 'bg-purple-400' : 'bg-white/10'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
