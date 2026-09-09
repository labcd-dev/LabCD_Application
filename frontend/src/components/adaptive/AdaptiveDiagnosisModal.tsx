import { createPortal } from 'react-dom'
import { Stethoscope, X } from 'lucide-react'
import type { AdaptiveDiagnosis, DiagnosisApplyPatch } from '../../api/types'
import { btnBase, btnCompact, btnPrimary } from '../../lib/classes'
import { AdaptiveDiagnosisView } from './AdaptiveDiagnosisView'

interface AdaptiveDiagnosisModalProps {
  open: boolean
  diagnosis?: AdaptiveDiagnosis | null
  onDismiss: () => void
  onViewDetails: () => void
  onRetry: () => void
  onApplyOption?: (patch: DiagnosisApplyPatch) => void
  applyDisabled?: boolean
  currentInputs?: {
    reference?: string
    x0?: string
    solverStep?: number
    simTime?: number
  } | null
}

export function AdaptiveDiagnosisModal({
  open,
  diagnosis,
  onDismiss,
  onViewDetails,
  onRetry,
  onApplyOption,
  applyDisabled = false,
  currentInputs = null,
}: AdaptiveDiagnosisModalProps) {
  if (!open || !diagnosis?.report) return null

  const modalNode = (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px] animate-in fade-in-50 duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adaptive-diagnosis-modal-title"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-amber-500/40 bg-surface-elevated shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-border bg-surface-elevated/95 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 min-w-0">
            <Stethoscope className="size-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="min-w-0">
              <h2
                id="adaptive-diagnosis-modal-title"
                className="text-sm font-semibold text-foreground"
              >
                Diagnoser
              </h2>
              <p className="text-[11px] text-muted-text">
                This run failed or missed the tracking target
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1 text-muted-text hover:bg-surface-hover hover:text-foreground"
            aria-label="Dismiss diagnosis"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 py-3">
          <AdaptiveDiagnosisView
            diagnosis={diagnosis}
            compact
            onApplyOption={onApplyOption}
            applyDisabled={applyDisabled}
            currentInputs={currentInputs}
          />
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-elevated/95 px-4 py-3 backdrop-blur-sm">
          <button
            type="button"
            className={`${btnBase} ${btnCompact} text-xs border border-border text-muted-text hover:text-foreground`}
            onClick={onDismiss}
          >
            Dismiss
          </button>
          <button
            type="button"
            className={`${btnBase} ${btnCompact} text-xs border border-amber-500/40 text-amber-900 dark:text-amber-100 hover:bg-amber-500/15`}
            onClick={onViewDetails}
          >
            View details
          </button>
          <button
            type="button"
            className={`${btnBase} ${btnCompact} ${btnPrimary} text-xs`}
            onClick={onRetry}
          >
            Back to launch
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : null
}
