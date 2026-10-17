import type { ConstraintsProposal } from '../../api/types'
import { PipelineCardShell } from './PipelineCardShell'

interface Props {
  proposal: ConstraintsProposal
  stateNames: string[]
  inputNames: string[]
  disabled: boolean
  onConfirm: () => void
}

const formatPair = (pair: (number | null)[]) => `[${pair[0] ?? '−∞'}, ${pair[1] ?? '∞'}]`

/** Edits happen through the chat: the constraints stage is a conversation, not a form. */
export function ConstraintsHitlCard({ proposal, stateNames, inputNames, disabled, onConfirm }: Props) {
  const rows = [
    ...(proposal.state_bounds ?? []).map((pair, i) => ({ name: stateNames[i] ?? `state ${i + 1}`, pair })),
    ...(proposal.input_bounds ?? []).map((pair, i) => ({ name: inputNames[i] ?? `input ${i + 1}`, pair })),
  ]
  const title = proposal.bounded ? 'State & Input Bounds' : 'State & Input Bounds — Unbounded'

  return (
    <PipelineCardShell
      title={title}
      description={proposal.bounded
        ? 'Limits the controller must respect.'
        : 'No limits recorded yet. Type any limits in the chat below, or confirm unbounded.'}
      footer={
        <div className="ap-hitl-footer-primary">
          <button type="button" className="ap-complete-btn ap-hitl-launch-btn" disabled={disabled} onClick={() => onConfirm()}>
            {proposal.bounded ? 'Confirm bounds' : 'Confirm unbounded'}
          </button>
        </div>
      }
    >
      {rows.length > 0 && (
        <div className="ap-hitl-options" style={{ padding: '8px 12px', fontSize: 13 }}>
          {rows.map((row) => (
            <div key={row.name}>{row.name} ∈ {formatPair(row.pair)}</div>
          ))}
        </div>
      )}
    </PipelineCardShell>
  )
}
