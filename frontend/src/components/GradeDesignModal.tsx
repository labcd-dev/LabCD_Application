import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Star, X } from 'lucide-react'
import { adaptiveApi, mpcApi, projectsApi } from '../api/endpoints'
import { btnBase, btnCompact, btnPrimary } from '../lib/classes'

export interface GradeDesignModalProps {
  open: boolean
  moduleType: 'adaptive' | 'mpc' | 'project'
  jobId?: string | null
  projectId?: number | null
  initialRating?: number | null
  initialComment?: string | null
  score?: number | null
  success?: boolean | null
  isReadOnly?: boolean
  onClose: () => void
  onSubmitted?: (rating: number, comment?: string | null) => void
}

const RATING_DESCRIPTIONS: Record<number, string> = {
  1: 'Poor — Substantial error or oscillation',
  2: 'Fair — Suboptimal convergence or chatter',
  3: 'Good — Met primary tracking objectives',
  4: 'Very Good — Fast settling, robust response',
  5: 'Exceptional — Optimal certified performance',
}

export function GradeDesignModal({
  open,
  moduleType,
  jobId,
  projectId,
  initialRating,
  initialComment,
  score,
  success,
  isReadOnly = false,
  onClose,
  onSubmitted,
}: GradeDesignModalProps) {
  const [rating, setRating] = useState<number>(initialRating || 0)
  const [hoverRating, setHoverRating] = useState<number>(0)
  const [comment, setComment] = useState<string>(initialComment || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setRating(initialRating || 0)
      setComment(initialComment || '')
      setError(null)
    }
  }, [open, initialRating, initialComment])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, submitting, onClose])

  if (!open) return null

  const dynamicSubtitle = isReadOnly
    ? 'User review feedback and certified performance inspection'
    : moduleType === 'adaptive'
    ? 'How well did the adaptive law meet your goals?'
    : moduleType === 'mpc'
    ? 'How well did the MPC controller meet your goals?'
    : 'How well did the generated controller meet your goals?'

  const currentDisplayRating = isReadOnly ? rating : (hoverRating || rating)

  const handleSubmit = async () => {
    if (isReadOnly || rating <= 0) return
    setSubmitting(true)
    setError(null)
    try {
      if (moduleType === 'adaptive' && jobId) {
        await adaptiveApi.submitGrade(jobId, { rating, comment: comment.trim() || null })
      } else if (moduleType === 'mpc' && jobId) {
        await mpcApi.submitGrade(jobId, { rating, comment: comment.trim() || null })
      } else if (projectId) {
        await projectsApi.submitGrade(projectId, { rating, comment: comment.trim() || null })
      }
      onSubmitted?.(rating, comment.trim() || null)
      onClose()
    } catch (err) {
      console.error('Failed to submit design grade:', err)
      setError(err instanceof Error ? err.message : 'Failed to record design grade')
    } finally {
      setSubmitting(false)
    }
  }

  const modalNode = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(6,8,11,0.75)] p-4 backdrop-blur-[6px] animate-in fade-in-50 duration-150"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div
        className="w-[460px] max-w-full rounded-2xl border border-border bg-surface-elevated p-6 shadow-[0_30px_90px_rgba(0,0,0,0.55)] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grade-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500 border border-amber-500/30">
                <Star className="size-4 fill-amber-400 text-amber-400" />
              </span>
              <h2 id="grade-modal-title" className="m-0 text-base font-bold text-foreground">
                {isReadOnly ? 'Design Grade & Review' : 'Grade this design'}
              </h2>
              {isReadOnly && (
                <span className="rounded-md border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-text">
                  Inspection
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-text">{dynamicSubtitle}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-muted hover:text-foreground hover:bg-surface-hover transition-colors cursor-pointer border-none bg-transparent"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Score & Success Pills if available */}
        {(score !== undefined && score !== null) && (
          <div className="mt-4 flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                success === true
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : success === false
                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
              }`}
            >
              {success === true ? 'Success' : success === false ? 'Needs Tuning' : 'Evaluated'}
            </span>
            <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-mono font-bold text-foreground border border-border">
              Score: {(score * 100).toFixed(0)}%
            </span>
          </div>
        )}

        {/* Star Rating */}
        <div className="mt-5 text-center">
          <div className="inline-flex items-center gap-2 rounded-2xl bg-surface-muted/60 p-2.5 border border-border">
            {[1, 2, 3, 4, 5].map((starVal) => {
              const active = currentDisplayRating >= starVal
              if (isReadOnly) {
                return (
                  <div
                    key={starVal}
                    className="p-1.5 cursor-default select-none"
                    aria-label={`${starVal} of 5 stars`}
                  >
                    <Star
                      className={`size-7 transition-colors ${
                        active
                          ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]'
                          : 'text-muted/25'
                      }`}
                    />
                  </div>
                )
              }
              return (
                <button
                  key={starVal}
                  type="button"
                  onClick={() => setRating(starVal)}
                  onMouseEnter={() => setHoverRating(starVal)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="group relative p-1.5 transition-transform hover:scale-120 focus:outline-none cursor-pointer border-none bg-transparent"
                  aria-label={`Rate ${starVal} out of 5 stars`}
                >
                  <Star
                    className={`size-7 transition-colors ${
                      active
                        ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                        : 'text-muted/40 hover:text-amber-300'
                    }`}
                  />
                </button>
              )
            })}
          </div>

          <div className="mt-2.5 min-h-[20px] text-xs font-medium text-foreground">
            {currentDisplayRating > 0 ? (
              <span className="text-amber-600 dark:text-amber-400 font-semibold animate-in fade-in-50">
                {RATING_DESCRIPTIONS[currentDisplayRating] || `Rating: ${currentDisplayRating} / 5`}
              </span>
            ) : (
              <span className="text-muted">
                {isReadOnly ? 'No numerical rating submitted by user' : 'Select 1 to 5 stars to submit your score'}
              </span>
            )}
          </div>
        </div>

        {/* Engineering feedback / notes */}
        <div className="mt-4">
          <label className="block text-[11px] font-semibold text-muted-text uppercase tracking-wider mb-1.5">
            Engineering feedback / notes {isReadOnly ? '' : '(optional)'}
          </label>
          {isReadOnly ? (
            comment && comment.trim() ? (
              <div className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs text-foreground whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {comment}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 bg-surface/40 px-3.5 py-3 text-xs text-muted italic">
                No written feedback or notes provided by the user.
              </div>
            )
          ) : (
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Tracking accuracy was very high, but settling time had a slight delay under pulse disturbance..."
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none transition-colors resize-none"
            />
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-500 dark:text-rose-400">
            {error}
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-border pt-4">
          {isReadOnly ? (
            <button
              type="button"
              onClick={onClose}
              className={`${btnBase} ${btnCompact} ${btnPrimary} font-semibold px-5`}
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className={`${btnBase} ${btnCompact} text-muted-text hover:text-foreground hover:bg-surface-hover border border-border font-medium`}
              >
                Skip
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={rating === 0 || submitting}
                className={`${btnBase} ${btnCompact} ${btnPrimary} flex items-center gap-1.5 font-semibold px-4`}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Submitting...
                  </>
                ) : (
                  'Submit'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : null
}
