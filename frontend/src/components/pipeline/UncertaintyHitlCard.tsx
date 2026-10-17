import type { UncertaintyProposal } from '../../api/types'
import { PipelineCardShell } from './PipelineCardShell'

interface Props {
  proposal: UncertaintyProposal
  disabled: boolean
  onConfirm: () => void
}

const formatTerm = (t: { state: string; expr: string }) => `${t.state}: ${t.expr || 'expression unknown'}`

/** The clarifier runs as a chat. This card shows its current question or final summary. */
export function UncertaintyHitlCard({ proposal, disabled, onConfirm }: Props) {
  const body = proposal.ready ? proposal.summary : proposal.question
  return (
    <PipelineCardShell
      title="Uncertainty & Disturbance"
      description={proposal.ready
        ? 'Confirm to continue to routing.'
        : 'Answer in the chat below. Once I have what I need, confirm here.'}
      footer={
        <div className="ap-hitl-footer-primary">
          <button
            type="button"
            className="ap-complete-btn ap-hitl-launch-btn"
            disabled={disabled || !proposal.ready}
            onClick={() => onConfirm()}
          >
            Confirm
          </button>
        </div>
      }
    >
      <div className="ap-hitl-options" style={{ padding: '8px 12px', fontSize: 13 }}>
        {body && <p style={{ margin: 0 }}>{body}</p>}
        {proposal.ready && (
          <>
            {proposal.uncertainty.map((t) => <div key={`u-${formatTerm(t)}`}>Uncertainty — {formatTerm(t)}</div>)}
            {proposal.disturbance.map((t) => <div key={`d-${formatTerm(t)}`}>Disturbance — {formatTerm(t)}</div>)}
          </>
        )}
      </div>
    </PipelineCardShell>
  )
}
