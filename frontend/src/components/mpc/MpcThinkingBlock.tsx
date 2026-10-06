import { useEffect, useRef, useState } from 'react'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Cpu,
  Layers,
  Sparkles,
  Terminal,
} from 'lucide-react'

interface ReasoningLogItem {
  id: number
  agent: string
  badgeColor: string
  text: string
  round: number | null
}

interface MpcThinkingBlockProps {
  isRunning: boolean
  elapsedSec: number
  iteration: number
  maxIterations: number
  currentStage?: string
  logs: ReasoningLogItem[]
  defaultExpanded?: boolean
  durationSec?: number
}

const STAGES = [
  { id: 'actor', label: 'Actor', desc: 'Synthesizer' },
  { id: 'evaluator', label: 'Evaluator', desc: 'Active-Set QP Solver' },
  { id: 'terminator', label: 'Terminator', desc: 'Convergence' },
  { id: 'critic', label: 'Critic / Juror', desc: 'Pareto Certified' },
]

export function MpcThinkingBlock({
  isRunning,
  elapsedSec,
  iteration,
  maxIterations,
  currentStage = 'actor',
  logs,
  defaultExpanded = true,
  durationSec,
}: MpcThinkingBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs as new reasoning comes in while expanded
  useEffect(() => {
    if (expanded && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs.length, expanded])

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const stageIndex = STAGES.findIndex((s) =>
    currentStage.toLowerCase().includes(s.id)
  )
  const activeIdx = stageIndex >= 0 ? stageIndex : isRunning ? 0 : 3

  return (
    <div className="my-2.5 overflow-hidden rounded-2xl border border-purple-200/90 dark:border-purple-500/30 bg-purple-50/50 dark:bg-surface-elevated shadow-xs backdrop-blur-md transition-all">
      {/* Thinking Header Bar */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-purple-500/5 dark:hover:bg-purple-500/10 focus:outline-none"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`flex size-6 shrink-0 items-center justify-center rounded-lg border ${
              isRunning
                ? 'border-purple-300 dark:border-purple-500/40 bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 animate-pulse'
                : 'border-purple-200 dark:border-purple-500/30 bg-purple-100/70 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400'
            }`}
          >
            {isRunning ? (
              <Brain className="size-3.5 animate-[spin_4s_linear_infinite]" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
          </div>

          <div className="flex items-center gap-2 truncate text-xs">
            <span className="font-semibold text-purple-700 dark:text-purple-300">
              {isRunning ? 'Thinking & Synthesizing...' : `Thought for ${durationSec ?? elapsedSec}s`}
            </span>

            {isRunning && (
              <span className="flex items-center gap-1 rounded-full border border-purple-300 dark:border-purple-500/30 bg-purple-100/80 dark:bg-purple-900/40 px-2 py-0.5 font-mono text-[10.5px] text-purple-700 dark:text-purple-300">
                <span className="size-1.5 rounded-full bg-purple-500 dark:bg-purple-400 animate-ping" />
                {formatTimer(elapsedSec)}
              </span>
            )}

            <span className="rounded-md border border-border bg-surface-muted px-2 py-0.5 font-mono text-[10.5px] text-muted-text">
              Iter {iteration}/{maxIterations}
            </span>

            {currentStage && (
              <span className="hidden sm:inline-block truncate rounded-md border border-purple-200 dark:border-purple-500/30 bg-purple-100/80 dark:bg-purple-900/40 px-2 py-0.5 text-[10.5px] font-medium text-purple-700 dark:text-purple-300 capitalize">
                Stage: {currentStage}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-text">
          <span className="hidden sm:inline text-[11px] font-mono text-muted-text">
            {logs.length} reasoning trace{logs.length === 1 ? '' : 's'}
          </span>
          {expanded ? (
            <ChevronDown className="size-4 text-purple-600 dark:text-purple-400 transition-transform" />
          ) : (
            <ChevronRight className="size-4 text-purple-600 dark:text-purple-400 transition-transform" />
          )}
        </div>
      </button>

      {/* Expandable Thinking Content */}
      {expanded && (
        <div className="border-t border-purple-200/80 dark:border-purple-500/20 px-3.5 py-3 space-y-3 animate-in fade-in-50 duration-150">
          {/* Mini Agent Pipeline DAG */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-muted-text">
              <span className="flex items-center gap-1">
                <Layers className="size-3 text-purple-500 dark:text-purple-400" />
                Multi-Agent Synthesis Pipeline
              </span>
              <span className="text-[10px] text-muted-text">
                Discrete-Time Receding-Horizon
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {STAGES.map((s, idx) => {
                const isPassed = !isRunning || idx < activeIdx
                const isCurrent = isRunning && idx === activeIdx
                return (
                  <div
                    key={s.id}
                    className={`relative overflow-hidden rounded-xl border p-2 transition-all ${
                      isCurrent
                        ? 'border-purple-400 dark:border-purple-500/60 bg-purple-100/80 dark:bg-purple-950/60 shadow-xs shadow-purple-500/10'
                        : isPassed
                        ? 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50/80 dark:bg-emerald-950/30 text-foreground'
                        : 'border-border bg-surface-muted/60 dark:bg-surface-muted/40 text-muted-text opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-text">
                        Step 0{idx + 1}
                      </span>
                      <span
                        className={`size-1.5 rounded-full ${
                          isCurrent
                            ? 'bg-purple-600 dark:bg-purple-400 animate-ping'
                            : isPassed
                            ? 'bg-emerald-500 dark:bg-emerald-400'
                            : 'bg-muted-text/40'
                        }`}
                      />
                    </div>
                    <div className="mt-0.5 truncate text-xs font-bold text-foreground">
                      {s.label}
                    </div>
                    <div className="truncate text-[10px] text-muted-text">
                      {s.desc}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Reasoning Telemetry Terminal */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-muted-text">
              <span className="flex items-center gap-1">
                <Terminal className="size-3 text-cyan-600 dark:text-cyan-400" />
                Agent Thought Stream
              </span>
              {isRunning && (
                <span className="flex items-center gap-1 text-[10px] text-purple-600 dark:text-purple-400 font-mono">
                  <Cpu className="size-2.5 animate-spin" /> streaming telemetry...
                </span>
              )}
            </div>

            <div
              ref={logContainerRef}
              className="max-h-48 overflow-y-auto rounded-xl border border-border bg-surface-muted/90 dark:bg-black/50 p-2.5 font-mono text-[11px] leading-relaxed shadow-inner scrollbar-thin scrollbar-thumb-purple-500/30"
            >
              {logs.length === 0 ? (
                <div className="py-2 text-center text-xs text-muted-text">
                  Awaiting agent telemetry stream...
                </div>
              ) : (
                <div className="space-y-1.5">
                  {logs.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2 border-b border-border/40 dark:border-border/20 pb-1 last:border-b-0 last:pb-0"
                    >
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide border ${item.badgeColor}`}
                      >
                        {item.agent}
                      </span>
                      {item.round !== null && (
                        <span className="shrink-0 text-[9.5px] text-muted-text">
                          R{item.round}
                        </span>
                      )}
                      <span className="text-foreground dark:text-zinc-200 break-words">
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
