import type { ProjectPipelineType, ProjectStatus } from '../api/types'

export function pipelineLabel(pipeline: ProjectPipelineType | string): string {
  if (pipeline === 'siloDesign') return 'Single Loop'
  if (pipeline === 'muloDesign') return 'Multi Loop'
  if (pipeline === 'adaptiveDesign') return 'Adaptive Control'
  if (pipeline === 'mpcDesign') return 'Agentic MPC'
  return pipeline
}

export function pipelineBadgeClass(pipeline: ProjectPipelineType | string): string {
  const base = 'rounded-md px-2 py-0.5 text-xs font-semibold'
  switch (pipeline) {
    case 'siloDesign':
      return `${base} bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30`
    case 'muloDesign':
      return `${base} bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30`
    case 'adaptiveDesign':
      return `${base} bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30`
    case 'mpcDesign':
      return `${base} bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30`
    default:
      return `${base} bg-surface-muted text-muted-text border border-border`
  }
}

export function statusBadgeClass(status: ProjectStatus | string): string {
  const base = 'rounded-md px-2 py-0.5 text-xs font-medium capitalize'
  switch (status) {
    case 'completed':
      return `${base} bg-[var(--app-status-success-bg)] text-[var(--app-status-success-text)]`
    case 'running':
      return `${base} bg-[var(--app-status-info-bg)] text-[var(--app-status-info-text)]`
    case 'failed':
      return `${base} bg-[var(--app-status-error-bg)] text-[var(--app-status-error-text)]`
    case 'cancelled':
      return `${base} bg-[var(--app-status-warning-bg)] text-[var(--app-status-warning-text)]`
    default:
      return `${base} bg-surface-muted text-muted-text`
  }
}
