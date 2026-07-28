import { cardPanel, mutedText } from '../lib/classes'
import { StatusMessage } from './StatusMessage'

export interface WorkflowSummary {
  success?: boolean
  error?: string
  flag?: string
  best_score?: number | null
  price?: number
  token_usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

interface WorkflowSummaryPanelProps {
  summary: WorkflowSummary | null | undefined
  variant: 'recommender' | 'trimmer'
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function formatFlag(flag: unknown): string {
  if (typeof flag !== 'string' || !flag.trim()) return 'N/A'
  return flag.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${cardPanel} px-4 py-3`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-label">{label}</div>
      <div className="mt-1 text-xl font-bold text-foreground">{value}</div>
    </div>
  )
}

export function WorkflowSummaryPanel({ summary, variant }: WorkflowSummaryPanelProps) {
  if (!summary || Object.keys(summary).length === 0) {
    return (
      <p className={mutedText}>Summary not available yet. Please run the workflow.</p>
    )
  }

  const success = Boolean(summary.success)
  const tokens = summary.token_usage ?? {}
  const price = asNumber(summary.price)
  const bestScore = summary.best_score
  const hasBestScore = typeof bestScore === 'number' && Number.isFinite(bestScore)

  const successMessage =
    variant === 'recommender'
      ? 'Design complete! See the Final Result tab for your controller design.'
      : 'Trimming complete! See the Final Result tab for your data.'

  const failureMessage =
    variant === 'recommender'
      ? `Workflow encountered an error: ${summary.error || 'Unknown Error'}`
      : `Workflow encountered an error or instability: ${summary.error || 'Unknown Error'}`

  const statusText =
    variant === 'recommender'
      ? success
        ? 'Completed'
        : 'Failed'
      : success
        ? 'Completed'
        : 'Failed/Interrupted'

  const flagLabel = variant === 'trimmer' ? 'Exit Flag / Stability' : 'Exit Flag'

  return (
    <div className="flex flex-col gap-5">
      <StatusMessage
        type={success ? 'success' : 'error'}
        message={success ? successMessage : failureMessage}
      />

      <div
        className={`grid grid-cols-2 gap-3 ${
          variant === 'recommender' ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
        }`}
      >
        <MetricCard label="Status" value={statusText} />
        <MetricCard label={flagLabel} value={formatFlag(summary.flag)} />
        {variant === 'recommender' && (
          <MetricCard
            label="Best Score"
            value={hasBestScore ? `${Math.round(bestScore)}/10` : 'N/A'}
          />
        )}
        <MetricCard label="Total Cost" value={`$${price.toFixed(4)}`} />
      </div>

      <div>
        <h3 className="m-0 mb-3 text-base font-semibold text-foreground">
          LLM Agent Execution Metrics
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard label="Input Tokens" value={String(asNumber(tokens.input_tokens))} />
          <MetricCard label="Output Tokens" value={String(asNumber(tokens.output_tokens))} />
          <MetricCard label="Total Tokens" value={String(asNumber(tokens.total_tokens))} />
        </div>
      </div>
    </div>
  )
}

export function parseWorkflowSummary(value: unknown): WorkflowSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as WorkflowSummary
}
