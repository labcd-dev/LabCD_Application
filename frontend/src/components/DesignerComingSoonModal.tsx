import { Sparkles } from 'lucide-react'
import { btnPrimary, btnWide } from '../lib/classes'

interface DesignerComingSoonModalProps {
  open: boolean
  onDismiss: () => void
}

export function DesignerComingSoonModal({ open, onDismiss }: DesignerComingSoonModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="admin-fade-in absolute inset-0 bg-foreground/45 backdrop-blur-[2px]"
        aria-label="Dismiss designer coming soon"
        onClick={onDismiss}
      />
      <div
        className="designer-coming-soon-modal relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface-elevated p-6 text-center shadow-2xl sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="designer-coming-soon-title"
      >
        <div className="designer-coming-soon-modal__glow" aria-hidden />
        <div className="designer-coming-soon-modal__icon-wrap mx-auto mb-4 flex size-16 items-center justify-center rounded-full border border-border bg-surface-muted">
          <Sparkles className="designer-coming-soon-modal__icon size-8 text-primary" aria-hidden />
        </div>
        <h2
          id="designer-coming-soon-title"
          className="m-0 text-xl font-semibold text-foreground sm:text-2xl"
        >
          Designer coming soon
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-text">
          Multi-loop GA designer is on the way. Your trimmer results are ready — thanks for
          completing the pipeline.
        </p>
        <button type="button" className={`${btnPrimary} ${btnWide} mt-6`} onClick={onDismiss}>
          Continue
        </button>
      </div>
    </div>
  )
}
