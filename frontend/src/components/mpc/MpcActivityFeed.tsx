import { Terminal } from 'lucide-react'
import type { MPCJobProgressEvent } from '../../api/types'

interface MpcActivityFeedProps {
  events: MPCJobProgressEvent[]
  history?: Array<Record<string, unknown>>
}

export function MpcActivityFeed({ events }: MpcActivityFeedProps) {
  // Combine progress events and reasoning history
  const displayItems = events.length > 0 ? events : []

  const getAgentColor = (stage: string) => {
    switch (stage.toLowerCase()) {
      case 'actor':
        return 'text-purple-400 border-purple-500/30 bg-purple-500/10'
      case 'critic':
        return 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10'
      case 'juror':
        return 'text-amber-400 border-amber-500/30 bg-amber-500/10'
      case 'terminator':
        return 'text-rose-400 border-rose-500/30 bg-rose-500/10'
      case 'evaluator':
        return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
      default:
        return 'text-slate-400 border-white/10 bg-white/5'
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#11161d] p-5 shadow-xl text-[#eef2f8]">
      <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-purple-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Agent Reasoning Stream
          </h3>
        </div>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-mono text-slate-400">
          {displayItems.length} messages
        </span>
      </div>

      <div className="max-h-[580px] lg:max-h-[660px] overflow-y-auto space-y-2.5 pr-1 text-xs">
        {displayItems.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Awaiting multi-agent graph decisions...
          </div>
        ) : (
          displayItems.map((item, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-white/5 bg-[#0a0d12] p-3 text-xs leading-relaxed"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getAgentColor(
                    item.stage
                  )}`}
                >
                  {item.stage || 'Graph'}
                </span>
                <span className="font-mono text-[10px] text-slate-500">
                  {item.ts ? new Date(item.ts * 1000).toLocaleTimeString() : ''}
                </span>
              </div>
              <p className="text-slate-300 font-sans text-[11.5px] whitespace-pre-wrap">{item.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
