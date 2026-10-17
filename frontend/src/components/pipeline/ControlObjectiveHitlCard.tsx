import { useEffect, useRef, useState } from 'react'
import { Pencil, X } from 'lucide-react'
import type { ControlObjectiveProposal } from '../../api/types'
import { PipelineCardShell } from './PipelineCardShell'

export const AUTO_ACCEPT_SECONDS = 30

interface Props {
  proposal: ControlObjectiveProposal
  disabled: boolean
  /** Called with 'timeout' when the countdown accepts the draft, so the transcript can say so. */
  onConfirm: (reason?: 'timeout') => void
  onEdit: (edit: { control_objective: string }) => void
}

/**
 * Drafted objective with a 30 s auto-accept. Hovering over the timer shows ✕, which
 * cancels the timer for good. Editing also pauses it, so the user is never overruled mid-edit.
 */
export function ControlObjectiveHitlCard({ proposal, disabled, onConfirm, onEdit }: Props) {
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState(proposal.control_objective)
  const [remaining, setRemaining] = useState(AUTO_ACCEPT_SECONDS)
  const [timerOn, setTimerOn] = useState(true)
  const [hovering, setHovering] = useState(false)
  const latestConfirm = useRef(onConfirm)
  latestConfirm.current = onConfirm

  // A new draft (from a revision or a fresh proposal) restarts the countdown.
  useEffect(() => {
    setDraftText(proposal.control_objective)
    setRemaining(AUTO_ACCEPT_SECONDS)
    setTimerOn(true)
    setEditing(false)
  }, [proposal.control_objective])

  useEffect(() => {
    if (!timerOn || editing || disabled) return
    if (remaining <= 0) {
      latestConfirm.current('timeout')
      return
    }
    const id = window.setTimeout(() => setRemaining((r) => r - 1), 1000)
    return () => window.clearTimeout(id)
  }, [timerOn, editing, disabled, remaining])

  const showTimer = timerOn && !editing
  const clock = `00:${String(Math.max(remaining, 0)).padStart(2, '0')}`

  return (
    <PipelineCardShell
      title="Proposed Control Objective"
      description="Accept it, or pencil in your own wording."
      footer={
        <div className="ap-hitl-footer-primary">
          <button
            type="button"
            className="ap-complete-btn ap-hitl-launch-btn"
            disabled={disabled || editing}
            onClick={() => onConfirm()}
          >
            Accept
          </button>
        </div>
      }
    >
      <div className="ap-hitl-options" style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            aria-label="Edit objective"
            className="ap-hitl-settings-btn"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
          <div
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          >
            {showTimer && <span aria-live="off">timer {clock}</span>}
            {showTimer && hovering && (
              <button
                type="button"
                aria-label="Cancel auto-accept"
                className="ap-hitl-settings-btn"
                onClick={() => setTimerOn(false)}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
            {!timerOn && !editing && <span>auto-accept cancelled</span>}
          </div>
        </div>

        {!editing ? (
          <p style={{ margin: '8px 0 0', fontSize: 14 }}>&ldquo;{proposal.control_objective}&rdquo;</p>
        ) : (
          <div style={{ marginTop: 8 }}>
            <textarea
              aria-label="Control objective text"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={3}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button
                type="button"
                className="ap-complete-btn ap-hitl-launch-btn"
                disabled={disabled || !draftText.trim()}
                onClick={() => {
                  setEditing(false)
                  onEdit({ control_objective: draftText.trim() })
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="ap-hitl-settings-btn"
                onClick={() => {
                  setDraftText(proposal.control_objective)
                  setEditing(false)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </PipelineCardShell>
  )
}
