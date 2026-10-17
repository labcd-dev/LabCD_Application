import type { PipelineRouting } from '../../api/types'
import { MODULES } from '../HitlModuleSelector'
import { moduleAllowedByRouting, routingKeyFor } from './pipelineState'
import { PipelineCardShell } from './PipelineCardShell'

interface Props {
  routing: PipelineRouting
  disabled: boolean
  onContinue: () => void
}

/** Read-only summary. The module selector is the next step. */
export function RoutingSummaryCard({ routing, disabled, onContinue }: Props) {
  return (
    <PipelineCardShell
      title="Routing Check"
      description={routing.rationale}
      footer={
        <div className="ap-hitl-footer-primary">
          <button type="button" className="ap-complete-btn ap-hitl-launch-btn" disabled={disabled} onClick={onContinue}>
            Choose control module
          </button>
        </div>
      }
    >
      <div className="ap-hitl-options" style={{ padding: '8px 12px', fontSize: 13 }}>
        {MODULES.map((module) => {
          const allowed = moduleAllowedByRouting(module.id, routing)
          const verdict = routing.applicable[routingKeyFor(module.id)]
          const label = allowed ? (verdict === null ? 'not yet evaluated' : 'suitable') : 'not suitable for this plant'
          return (
            <div key={module.id}>
              {module.name} — {label}
            </div>
          )
        })}
      </div>
    </PipelineCardShell>
  )
}
