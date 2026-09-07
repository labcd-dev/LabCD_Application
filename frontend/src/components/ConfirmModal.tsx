import { useEffect } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'

interface ConfirmModalProps {
  open: boolean
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'primary'
  loading?: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false,
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, loading, onClose])

  if (!open) return null

  const isDanger = variant === 'danger'
  const isWarning = variant === 'warning'

  return (
    <div
      className="fixed inset-0 z-[450] flex items-center justify-center bg-[rgba(6,8,11,0.72)] p-4 backdrop-blur-[3px] animate-in fade-in-50 duration-150"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose()
      }}
    >
      <div
        className="w-[440px] max-w-full rounded-2xl border border-border bg-surface-elevated p-5 sm:p-6 shadow-[0_30px_80px_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="flex items-start gap-3.5">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${
              isDanger
                ? 'border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400'
                : isWarning
                ? 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'border-primary/30 bg-primary/15 text-primary'
            }`}
          >
            <AlertTriangle className="size-5" />
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-start justify-between gap-2">
              <h2 id="confirm-modal-title" className="m-0 text-base font-bold text-foreground leading-snug">
                {title}
              </h2>
              <button
                type="button"
                className="border-none bg-transparent p-1 text-muted hover:text-foreground -mt-1 -mr-1 cursor-pointer transition-colors"
                aria-label="Close"
                disabled={loading}
                onClick={onClose}
              >
                <X className="size-4" />
              </button>
            </div>

            {description && (
              <p className="mt-2 text-xs leading-relaxed text-muted-text">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Buttons Row: Symmetrically Matched Height and Padding */}
        <div className="mt-6 flex items-center justify-end gap-2.5 pt-3.5 border-t border-border/70">
          <button
            type="button"
            className="inline-flex items-center justify-center h-9 min-w-[100px] px-4 rounded-xl border border-border bg-surface hover:bg-surface-hover text-xs font-semibold text-foreground transition-all duration-150 disabled:opacity-60 cursor-pointer shadow-2xs"
            disabled={loading}
            onClick={onClose}
          >
            {cancelText}
          </button>

          <button
            type="button"
            className={`inline-flex items-center justify-center gap-1.5 h-9 min-w-[100px] px-4 rounded-xl text-xs font-semibold text-white shadow-sm transition-all duration-150 disabled:opacity-60 cursor-pointer ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800'
                : isWarning
                ? 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800'
                : 'bg-primary hover:brightness-110 active:scale-[0.98]'
            }`}
            disabled={loading}
            onClick={() => void onConfirm()}
          >
            {loading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
