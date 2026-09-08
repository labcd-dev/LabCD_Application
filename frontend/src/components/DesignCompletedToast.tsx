import { useState } from 'react'
import { CheckCircle2, Sparkles, Star, X } from 'lucide-react'
import { btnBase, btnCompact, btnPrimary } from '../lib/classes'

export interface DesignCompletedToastProps {
  score?: number | null
  success?: boolean | null
  moduleLabel: string
  onGradeClick: () => void
  onDismiss?: () => void
}

export function DesignCompletedToast({
  score,
  success,
  moduleLabel,
  onGradeClick,
  onDismiss,
}: DesignCompletedToastProps) {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  const handleDismiss = () => {
    setVisible(false)
    onDismiss?.()
  }

  const hasScore = typeof score === 'number' && Number.isFinite(score)
  const isSuccess = success === true

  return (
    <div
      className="fixed bottom-6 right-6 z-[400] max-w-md w-[calc(100vw-3rem)] rounded-2xl border border-border bg-surface-elevated/95 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-md animate-in slide-in-from-bottom-5 fade-in-50 duration-200"
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h4 className="m-0 text-xs font-bold text-foreground flex items-center gap-1.5">
              <span>{moduleLabel} Completed</span>
              {isSuccess && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 font-mono text-[10px] font-semibold">
                  <CheckCircle2 className="size-2.5" /> Certified
                </span>
              )}
            </h4>
            <p className="mt-0.5 mb-0 text-[11px] text-muted-text leading-tight">
              Waveforms &amp; deliverables ready. Inspect plots then rate your controller.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-lg p-1 text-muted hover:text-foreground hover:bg-surface-hover transition-colors cursor-pointer border-none bg-transparent -mr-1 -mt-1"
          aria-label="Dismiss notification"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/80 pt-2.5">
        {hasScore ? (
          <div className="flex items-baseline gap-1.5 font-mono text-xs text-foreground">
            <span className="text-[10px] font-semibold text-muted-text">Score</span>
            <span
              className={`rounded-md px-1.5 py-0.5 font-bold ${
                score >= 0.8
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : score >= 0.5
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
              }`}
            >
              {(score * 100).toFixed(0)}%
            </span>
          </div>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleDismiss}
            className={`${btnBase} ${btnCompact} text-[11px] text-muted-text hover:text-foreground hover:bg-surface-hover border border-border`}
          >
            Inspect Plots
          </button>

          <button
            type="button"
            onClick={() => {
              handleDismiss()
              onGradeClick()
            }}
            className={`${btnBase} ${btnCompact} ${btnPrimary} flex items-center gap-1 text-[11px] font-semibold shadow-xs`}
          >
            <Star className="size-3 fill-amber-400 text-amber-400" />
            Grade Design
          </button>
        </div>
      </div>
    </div>
  )
}
