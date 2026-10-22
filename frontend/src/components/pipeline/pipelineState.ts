import type {
  PipelinePayload,
  PipelineRouting,
  PipelineState,
  PipelineStatus,
  PlantModelChatResponse,
  PlantModelSessionState,
} from '../../api/types'
import type { LaunchPipeline } from '../LaunchModuleModal'
import { AUTO_ACCEPT_SECONDS } from './ControlObjectiveHitlCard'

export type GateAction = 'confirm' | 'edit'

interface TraceOptions {
  edit?: Record<string, unknown>
  /** Constraints: whether the proposal has any bounds. */
  bounded?: boolean
  /** Set when the countdown accepted the proposal, not the user. */
  reason?: 'timeout'
}

const formatVector = (value: unknown) => (Array.isArray(value) ? `[${value.join(', ')}]` : String(value))

const shorten = (text: string, max = 120) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/**
 * The muted line recorded in the transcript when the user resolves a HITL gate.
 * The label mirrors what the user did, not the internal stage name.
 */
export function traceLabelFor(kind: string, action: GateAction, options: TraceOptions = {}): string {
  const { edit, bounded, reason } = options
  switch (kind) {
    case 'trim':
      if (action === 'edit') {
        const parts = Object.entries(edit ?? {}).map(([key, value]) => `${key} = ${formatVector(value)}`)
        return parts.length ? `Set trim to ${parts.join(', ')}` : 'Edited trim point'
      }
      return 'Accepted trim point'
    case 'constraints':
      if (action === 'edit') return 'Set state and input bounds'
      return bounded ? 'Confirmed bounds' : 'Confirmed unbounded'
    case 'control_objective':
      if (action === 'edit') {
        const text = String(edit?.control_objective ?? '')
        return `Edited objective: “${shorten(text)}”`
      }
      return reason === 'timeout'
        ? `Auto-accepted objective after ${AUTO_ACCEPT_SECONDS} s`
        : 'Accepted control objective'
    case 'uncertainty':
      return action === 'edit' ? 'Edited uncertainty and disturbance' : 'Confirmed uncertainty and disturbance'
    default:
      return action === 'edit' ? 'Edited' : 'Confirmed'
  }
}

/**
 * Stored user messages that were pipeline or system actions, shown as trace rows on reload.
 * Labels are generic because the server stores only these short strings.
 */
const RESTORED_TRACE_LABELS: Record<string, string> = {
  Complete: 'Confirmed system',
  Confirmed: 'Confirmed',
  Edited: 'Edited',
}

export function restoredTraceLabel(content: string): string | null {
  return RESTORED_TRACE_LABELS[content.trim()] ?? null
}

/** Module id -> key in the backend routing output (`routing.applicable`). */
const ROUTING_KEY_BY_MODULE: Record<LaunchPipeline, string> = {
  siloDesign: 'silo',
  muloDesign: 'mulo',
  adaptiveDesign: 'adaptive',
  mpcDesign: 'mpc',
}

export function routingKeyFor(id: LaunchPipeline): string {
  return ROUTING_KEY_BY_MODULE[id]
}

/** Missing or null means "not evaluated", so the module stays visible. Only an explicit false hides it. */
export function moduleAllowedByRouting(id: LaunchPipeline, routing: PipelineRouting | null | undefined): boolean {
  if (!routing) return true
  return routing.applicable[routingKeyFor(id)] !== false
}

export function pipelineFromResponse(res: PlantModelChatResponse): PipelineState | null {
  if (res.pipeline_stage == null || res.pipeline_status == null) return null
  return {
    stage: res.pipeline_stage,
    status: res.pipeline_status,
    payload: res.pipeline_payload ?? null,
    routingAcknowledged: false,
  }
}

/** Rebuild the current gate from a restored conversation's session state. */
export function pipelineFromSession(session: PlantModelSessionState | null | undefined): PipelineState | null {
  const stage = session?.pipeline_stage ?? 1
  if (stage < 2) return null
  const context = session?.pipeline_context ?? {}
  return {
    stage,
    status: (context.status as PipelineStatus | undefined) ?? 'awaiting_hitl',
    payload: (context.payload as PipelinePayload | undefined) ?? null,
    routingAcknowledged: false,
  }
}

export function routingFromPipeline(pipeline: PipelineState | null): PipelineRouting | null {
  return pipeline?.payload?.routing ?? null
}

export function namesOf(metadata: Record<string, unknown> | null | undefined, key: 'states' | 'inputs'): string[] {
  const value = metadata?.[key]
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}
