import { useState } from 'react'
import type { TrimProposal } from '../../api/types'
import { PipelineCardShell } from './PipelineCardShell'

interface Props {
  proposal: TrimProposal
  stateNames: string[]
  inputNames: string[]
  disabled: boolean
  onConfirm: () => void
  onEdit: (edit: { x0: number[]; u_ff: number[] }) => void
}

const parseList = (text: string): number[] | null => {
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean)
  const values = parts.map(Number)
  return values.length > 0 && values.every(Number.isFinite) ? values : null
}

export function TrimHitlCard({ proposal, stateNames, inputNames, disabled, onConfirm, onEdit }: Props) {
  const [editing, setEditing] = useState(false)
  const [x0Text, setX0Text] = useState(proposal.x0.join(', '))
  const [uffText, setUffText] = useState(proposal.u_ff.join(', '))
  const [error, setError] = useState<string | null>(null)

  const saveEdit = () => {
    const x0 = parseList(x0Text)
    const u_ff = parseList(uffText)
    if (!x0 || !u_ff) {
      setError('Enter comma-separated numbers.')
      return
    }
    setError(null)
    setEditing(false)
    onEdit({ x0, u_ff })
  }

  return (
    <PipelineCardShell
      title="Proposed Trim Point"
      description="Initial state x0 and feedforward input u_ff for the operating point."
      footer={
        <div className="ap-hitl-footer-primary">
          {!editing ? (
            <>
              <button type="button" className="ap-complete-btn ap-hitl-launch-btn" disabled={disabled} onClick={() => onConfirm()}>
                Accept Trim
              </button>
              <button type="button" className="ap-hitl-settings-btn" disabled={disabled} onClick={() => setEditing(true)}>
                Edit values
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ap-complete-btn ap-hitl-launch-btn" disabled={disabled} onClick={saveEdit}>
                Save values
              </button>
              <button type="button" className="ap-hitl-settings-btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="ap-hitl-options" style={{ padding: '8px 12px', fontSize: 13 }}>
        {!editing ? (
          <>
            <div>x0 — {stateNames.map((n, i) => `${n}=${proposal.x0[i] ?? ''}`).join(', ') || proposal.x0.join(', ')}</div>
            <div>u_ff — {inputNames.map((n, i) => `${n}=${proposal.u_ff[i] ?? ''}`).join(', ') || proposal.u_ff.join(', ')}</div>
          </>
        ) : (
          <>
            <label>
              x0 ({stateNames.join(', ') || 'states'}):{' '}
              <input value={x0Text} onChange={(e) => setX0Text(e.target.value)} aria-label="Initial state x0" />
            </label>
            <br />
            <label>
              u_ff ({inputNames.join(', ') || 'inputs'}):{' '}
              <input value={uffText} onChange={(e) => setUffText(e.target.value)} aria-label="Feedforward input u_ff" />
            </label>
            {error && <div role="alert" style={{ color: '#f0576b' }}>{error}</div>}
          </>
        )}
      </div>
    </PipelineCardShell>
  )
}
