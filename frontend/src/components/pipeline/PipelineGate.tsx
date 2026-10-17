import type {
  ConstraintsProposal,
  ControlObjectiveProposal,
  PipelineState,
  TrimProposal,
  UncertaintyProposal,
} from '../../api/types'
import { ConstraintsHitlCard } from './ConstraintsHitlCard'
import { ControlObjectiveHitlCard } from './ControlObjectiveHitlCard'
import { TrimHitlCard } from './TrimHitlCard'
import { UncertaintyHitlCard } from './UncertaintyHitlCard'
import { namesOf, traceLabelFor } from './pipelineState'

interface Props {
  pipeline: PipelineState
  metadata: Record<string, unknown> | null
  loading: boolean
  /** `label` is the muted line recorded in the transcript for this resolution. */
  onAction: (action: 'confirm' | 'edit', edit: Record<string, unknown> | undefined, label: string) => void
}

/** Picks the HITL card for the stage the backend is waiting on. */
export function PipelineGate({ pipeline, metadata, loading, onAction }: Props) {
  const payload = pipeline.payload
  if (!payload || payload.proposal == null) {
    return <p className="ap-complete-hint">Working on the next stage…</p>
  }
  const stateNames = namesOf(metadata, 'states')
  const inputNames = namesOf(metadata, 'inputs')

  switch (payload.kind) {
    case 'trim':
      return (
        <TrimHitlCard
          proposal={payload.proposal as TrimProposal}
          stateNames={stateNames}
          inputNames={inputNames}
          disabled={loading}
          onConfirm={() => onAction('confirm', undefined, traceLabelFor('trim', 'confirm'))}
          onEdit={(edit) => onAction('edit', edit, traceLabelFor('trim', 'edit', { edit }))}
        />
      )
    case 'constraints': {
      const proposal = payload.proposal as ConstraintsProposal
      return (
        <ConstraintsHitlCard
          proposal={proposal}
          stateNames={stateNames}
          inputNames={inputNames}
          disabled={loading}
          onConfirm={() =>
            onAction('confirm', undefined, traceLabelFor('constraints', 'confirm', { bounded: proposal.bounded }))
          }
        />
      )
    }
    case 'control_objective':
      return (
        <ControlObjectiveHitlCard
          proposal={payload.proposal as ControlObjectiveProposal}
          disabled={loading}
          onConfirm={(reason) =>
            onAction('confirm', undefined, traceLabelFor('control_objective', 'confirm', { reason }))
          }
          onEdit={(edit) => onAction('edit', edit, traceLabelFor('control_objective', 'edit', { edit }))}
        />
      )
    case 'uncertainty':
      return (
        <UncertaintyHitlCard
          proposal={payload.proposal as UncertaintyProposal}
          disabled={loading}
          onConfirm={() => onAction('confirm', undefined, traceLabelFor('uncertainty', 'confirm'))}
        />
      )
    default:
      return null
  }
}
