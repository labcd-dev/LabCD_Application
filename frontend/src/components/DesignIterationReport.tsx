import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  formatParamValue,
  groupIntoIterations,
  type IterationCycle,
  type LlmResponseEntry,
  type ParsedActor,
  type ParsedCritic,
  type ParsedTerminator,
} from '../lib/llmResponseParser'
import {
  badgeStyles,
  btnBase,
  btnCompact,
  cardPanel,
  codeBlock,
  mutedText,
} from '../lib/classes'

interface DesignIterationReportProps {
  responses: LlmResponseEntry[]
  defaultExpanded?: 'latest' | 'all' | 'none'
}

const AGENT_META = {
  LLMActor: { label: 'Actor', subtitle: 'Parameter proposal', tone: 'actor' },
  LLMCritic: { label: 'Critic', subtitle: 'Performance analysis', tone: 'critic' },
  LLMTerminator: { label: 'Terminator', subtitle: 'Continue / stop decision', tone: 'terminator' },
  LLMJuror: { label: 'Juror', subtitle: 'Range reconsideration', tone: 'juror' },
} as const

const AGENT_BORDER = {
  actor: 'border-l-4 border-l-primary',
  critic: 'border-l-4 border-l-violet-500 dark:border-l-violet-400',
  terminator: 'border-l-4 border-l-emerald-600 dark:border-l-emerald-400',
  juror: 'border-l-4 border-l-amber-600 dark:border-l-amber-400',
} as const

export function DesignIterationReport({
  responses,
  defaultExpanded = 'latest',
}: DesignIterationReportProps) {
  const cycles = useMemo(() => groupIntoIterations(responses), [responses])
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    if (defaultExpanded === 'all') return new Set(cycles.map((c) => c.iteration))
    if (defaultExpanded === 'latest' && cycles.length > 0) {
      return new Set([cycles[cycles.length - 1].iteration])
    }
    return new Set()
  })
  if (cycles.length === 0) {
    return (
      <p className={mutedText}>
        No iteration data yet. Agent responses will appear here.
      </p>
    )
  }

  const toggleIteration = (iteration: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(iteration)) next.delete(iteration)
      else next.add(iteration)
      return next
    })
  }

  const expandAll = () => setExpanded(new Set(cycles.map((c) => c.iteration)))
  const collapseAll = () => setExpanded(new Set())

  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardPanel} flex justify-between items-center gap-4 flex-wrap px-4 py-3 rounded-[10px]`}>
        <div className="flex items-baseline gap-2 text-sm text-muted-text">
          <span className="text-2xl font-bold text-primary leading-none">{cycles.length}</span>
          <span>optimization iteration{cycles.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className={`${btnBase} ${btnCompact}`} onClick={expandAll}>
            Expand all
          </button>
          <button type="button" className={`${btnBase} ${btnCompact}`} onClick={collapseAll}>
            Collapse all
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {cycles.map((cycle, index) => (
          <IterationCard
            key={cycle.iteration}
            cycle={cycle}
            isLatest={index === cycles.length - 1}
            isExpanded={expanded.has(cycle.iteration)}
            onToggle={() => toggleIteration(cycle.iteration)}
          />
        ))}
      </div>
    </div>
  )
}

interface IterationCardProps {
  cycle: IterationCycle
  isLatest: boolean
  isExpanded: boolean
  onToggle: () => void
}

function IterationCard({
  cycle,
  isLatest,
  isExpanded,
  onToggle,
}: IterationCardProps) {
  const decision = cycle.terminator?.parsed.decision
  const strategy = cycle.critic?.parsed.strategy

  return (
    <article
      className={`bg-surface-elevated border rounded-xl overflow-hidden transition-[border-color,box-shadow] duration-200 ${
        isLatest ? 'border-[var(--app-iteration-latest-border)]' : 'border-border'
      }`}
      style={isLatest ? { boxShadow: '0 2px 8px var(--app-iteration-latest-shadow)' } : undefined}
    >
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 px-3 py-3 text-left font-inherit text-inherit border-none cursor-pointer hover:bg-surface-hover sm:grid sm:grid-cols-[1fr_auto_auto] sm:gap-3 sm:px-4 sm:py-3.5"
        style={{
          background: isLatest
            ? 'var(--app-iteration-latest-header)'
            : 'var(--app-surface-muted)',
        }}
        onClick={onToggle}
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-lg font-bold text-primary">#{cycle.iteration}</span>
          <span className="font-semibold text-foreground-secondary">Iteration</span>
          {cycle.timestamp && (
            <span className="text-xs text-foreground-subtle font-mono">{cycle.timestamp}</span>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {strategy && <Badge tone="strategy" value={strategy} />}
          {decision && (
            <Badge
              tone={decision === 'TERMINATE' ? 'terminate' : 'continue'}
              value={decision}
            />
          )}
          {isLatest && <Badge tone="latest" value="Latest" />}
        </div>
        <span className="ml-auto flex w-4 items-center justify-center text-foreground-subtle sm:ml-0" aria-hidden>
          {isExpanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-3 p-3 border-t border-border-subtle">
          {cycle.actor && (
            <ActorPanel parsed={cycle.actor.parsed} raw={cycle.actor.raw} />
          )}
          {cycle.critic && (
            <CriticPanel parsed={cycle.critic.parsed} raw={cycle.critic.raw} />
          )}
          {cycle.terminator && (
            <TerminatorPanel
              parsed={cycle.terminator.parsed}
              raw={cycle.terminator.raw}
            />
          )}
          {cycle.juror && (
            <JurorPanel parsed={cycle.juror.parsed} raw={cycle.juror.raw} />
          )}
        </div>
      )}
    </article>
  )
}

interface AgentPanelProps {
  agentKey: keyof typeof AGENT_META
  raw: LlmResponseEntry
  children: ReactNode
}

function AgentPanel({ agentKey, raw, children }: AgentPanelProps) {
  const meta = AGENT_META[agentKey]

  return (
    <section
      className={`border border-border-subtle rounded-[10px] px-4 py-3.5 bg-surface-elevated ${AGENT_BORDER[meta.tone]}`}
    >
      <header className="flex justify-between items-start gap-3 mb-3">
        <div>
          <h4 className="m-0 text-[0.95rem] text-foreground">{meta.label}</h4>
          <p className="mt-0.5 mb-0 text-[0.78rem] text-foreground-subtle">{meta.subtitle}</p>
        </div>
        {typeof raw.timestamp === 'string' && (
          <time className="text-xs text-foreground-faint font-mono whitespace-nowrap">
            {raw.timestamp}
          </time>
        )}
      </header>

      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function ActorPanel({
  parsed,
  raw,
}: {
  parsed: ParsedActor
  raw: LlmResponseEntry
}) {
  const paramEntries = Object.entries(parsed.params)

  return (
    <AgentPanel agentKey="LLMActor" raw={raw}>
      {paramEntries.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {paramEntries.map(([key, value]) => (
            <div
              key={key}
              className="flex flex-col gap-0.5 px-3 py-2 bg-param-bg border border-param-border rounded-lg"
            >
              <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-param-key">
                {key}
              </span>
              <span className="text-base font-bold font-mono text-param-value">
                {formatParamValue(value)}
              </span>
            </div>
          ))}
        </div>
      )}
      {parsed.reasoning && <ProseBlock label="Reasoning" text={parsed.reasoning} />}
    </AgentPanel>
  )
}

function CriticPanel({
  parsed,
  raw,
}: {
  parsed: ParsedCritic
  raw: LlmResponseEntry
}) {
  return (
    <AgentPanel agentKey="LLMCritic" raw={raw}>
      {parsed.strategy && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-label">Strategy</span>
          <Badge tone="strategy" value={parsed.strategy} />
        </div>
      )}
      {parsed.result_analysis && (
        <ProseBlock label="Result analysis" text={parsed.result_analysis} />
      )}
      {parsed.suggested_improvements && parsed.suggested_improvements.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-label">
            Suggested improvements
          </span>
          <ol className="m-0 pl-5 text-foreground-secondary text-sm leading-relaxed [&>li+li]:mt-1.5">
            {parsed.suggested_improvements.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
        </div>
      )}
    </AgentPanel>
  )
}

function TerminatorPanel({
  parsed,
  raw,
}: {
  parsed: ParsedTerminator
  raw: LlmResponseEntry
}) {
  return (
    <AgentPanel agentKey="LLMTerminator" raw={raw}>
      {parsed.decision && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-label">Decision</span>
          <Badge
            tone={parsed.decision === 'TERMINATE' ? 'terminate' : 'continue'}
            value={parsed.decision}
          />
        </div>
      )}
      {parsed.reasoning && <ProseBlock label="Reasoning" text={parsed.reasoning} />}
      {parsed.recommendations && (
        <ProseBlock label="Recommendations" text={parsed.recommendations} />
      )}
    </AgentPanel>
  )
}

function JurorPanel({
  parsed,
  raw,
}: {
  parsed: Record<string, unknown>
  raw: LlmResponseEntry
}) {
  const decision = typeof parsed.decision === 'string' ? parsed.decision : undefined
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined

  return (
    <AgentPanel agentKey="LLMJuror" raw={raw}>
      {decision && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-label">Decision</span>
          <Badge tone="juror" value={decision} />
        </div>
      )}
      {reasoning && <ProseBlock label="Reasoning" text={reasoning} />}
      {Object.keys(parsed).length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[0.78rem] text-muted">Parsed payload</summary>
          <pre className={codeBlock}>{JSON.stringify(parsed, null, 2)}</pre>
        </details>
      )}
    </AgentPanel>
  )
}

function ProseBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <span className="text-xs font-bold uppercase tracking-wide text-label">{label}</span>
      <p className="mt-1.5 mb-0 text-foreground-secondary text-sm leading-relaxed">{text}</p>
    </div>
  )
}

function Badge({ tone, value }: { tone: string; value: string }) {
  const style = badgeStyles[tone.toLowerCase()] ?? 'bg-surface-muted text-foreground-secondary'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.72rem] font-bold tracking-wide uppercase whitespace-nowrap ${style}`}
    >
      {value}
    </span>
  )
}
