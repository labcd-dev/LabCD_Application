import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Bug,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Star,
  X,
} from 'lucide-react'
import { adaptiveApi, mpcApi, projectsApi, surveyApi } from '../api/endpoints'
import type { FeedbackPipelineType } from '../api/types'
import { btnBase, btnCompact, btnPrimary } from '../lib/classes'

export interface GradeDesignModalProps {
  open: boolean
  moduleType: 'adaptive' | 'mpc' | 'project'
  pipelineType?: FeedbackPipelineType
  jobId?: string | null
  projectId?: number | null
  plantName?: string | null
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

function resolvePipeline(
  moduleType: 'adaptive' | 'mpc' | 'project',
  pipelineType?: FeedbackPipelineType,
): FeedbackPipelineType {
  if (pipelineType) return pipelineType
  if (moduleType === 'mpc') return 'mpcDesign'
  if (moduleType === 'adaptive') return 'adaptiveDesign'
  return 'siloDesign'
}

function pipelineLabel(pipeline: FeedbackPipelineType): string {
  switch (pipeline) {
    case 'mpcDesign':
      return 'Agentic MPC'
    case 'adaptiveDesign':
      return 'Adaptive Nonlinear'
    case 'muloDesign':
      return 'Multi Loop'
    case 'siloDesign':
    default:
      return 'Single Loop'
  }
}

export function GradeDesignModal({
  open,
  moduleType,
  pipelineType: propPipelineType,
  jobId,
  projectId,
  plantName,
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

  // WS04 Outro survey questions
  const [showSurveyDetails, setShowSurveyDetails] = useState<boolean>(true)
  const [q1, setQ1] = useState<number | null>(initialRating || null)
  const [q1Na, setQ1Na] = useState<boolean>(false)
  const [q2, setQ2] = useState<number | null>(initialRating || null)
  const [q2Na, setQ2Na] = useState<boolean>(false)
  const [q3, setQ3] = useState<number | null>(4)
  const [q4, setQ4] = useState<number | null>(4)
  const [q5, setQ5] = useState<number | null>(null)
  const [isBug, setIsBug] = useState<boolean>(false)

  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const pipeline = resolvePipeline(moduleType, propPipelineType)
  const label = pipelineLabel(pipeline)

  useEffect(() => {
    if (open) {
      const initR = initialRating || 0
      setRating(initR)
      setComment(initialComment || '')
      setQ1(initR > 0 ? initR : null)
      setQ1Na(false)
      setQ2(initR > 0 ? initR : null)
      setQ2Na(false)
      setQ3(4)
      setQ4(4)
      setQ5(null)
      setIsBug(false)
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
    ? 'Certified performance and evaluation inspection'
    : moduleType === 'adaptive'
    ? 'How well did the adaptive law meet your goals?'
    : moduleType === 'mpc'
    ? 'How well did the MPC controller meet your goals?'
    : 'How well did the generated controller meet your goals?'

  const currentDisplayRating = isReadOnly ? rating : (hoverRating || rating)

  const handleSelectStar = (starVal: number) => {
    setRating(starVal)
    if (!q1Na && (q1 === null || q1 === rating)) setQ1(starVal)
    if (!q2Na && (q2 === null || q2 === rating)) setQ2(starVal)
  }

  const handleSubmit = async () => {
    if (isReadOnly || rating <= 0) return
    setSubmitting(true)
    setError(null)

    const finalComment = comment.trim() || null

    try {
      // 1. Submit legacy controller design grade
      if (moduleType === 'adaptive' && jobId) {
        await adaptiveApi.submitGrade(jobId, { rating, comment: finalComment })
      } else if (moduleType === 'mpc' && jobId) {
        await mpcApi.submitGrade(jobId, { rating, comment: finalComment })
      } else if (projectId) {
        await projectsApi.submitGrade(projectId, { rating, comment: finalComment })
      }

      // 2. Submit WS04 Outro Survey feedback with tracing
      try {
        await surveyApi.submitFeedback({
          pipeline_type: pipeline,
          job_id: jobId || null,
          project_id: projectId || null,
          plant_name: plantName || null,
          score: score ?? null,
          success: success ?? null,
          technical_usefulness: q1Na ? null : (q1 ?? rating),
          technical_usefulness_na: q1Na,
          trust: q2Na ? null : (q2 ?? rating),
          trust_na: q2Na,
          ease_of_use: q3 ?? 4,
          reuse_intention: q4 ?? 4,
          nps: q5,
          main_problems: finalComment || '',
          is_bug: isBug,
          satisfaction: rating,
          confidence: q2 ?? rating,
        })
      } catch (surveyErr) {
        console.warn('WS04 feedback survey submission notice:', surveyErr)
      }

      onSubmitted?.(rating, finalComment)
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
        className="w-[560px] max-w-full max-h-[min(92vh,780px)] flex flex-col rounded-2xl border border-border bg-surface-elevated shadow-[0_30px_90px_rgba(0,0,0,0.55)] animate-in zoom-in-95 duration-150 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grade-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-5 pb-4 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500 border border-amber-500/30">
                <Star className="size-4 fill-amber-400 text-amber-400" />
              </span>
              <h2 id="grade-modal-title" className="m-0 text-base font-bold text-foreground">
                {isReadOnly ? 'Design Grade & Review' : `Grade this ${label} Design`}
              </h2>
              {isReadOnly && (
                <span className="rounded-md border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-text">
                  Inspection View
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

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Micro-tracing Context Chips */}
          <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-surface-muted/50 border border-border/70 text-xs">
            {success !== undefined && success !== null && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                  success === true
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : success === false
                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                }`}
              >
                {success === true ? 'Success' : success === false ? 'Needs Tuning' : 'Evaluated'}
              </span>
            )}
            {typeof score === 'number' && Number.isFinite(score) && (
              <span className="rounded-full bg-surface px-2.5 py-0.5 font-mono font-bold text-foreground border border-border">
                Score: {(score * 100).toFixed(0)}%
              </span>
            )}
            {jobId && (
              <span className="font-mono text-[10.5px] text-muted-text truncate max-w-[150px]" title={jobId}>
                Job: {jobId.slice(0, 10)}…
              </span>
            )}
            {plantName && (
              <span className="text-[11px] font-medium text-foreground truncate max-w-[180px]" title={plantName}>
                Plant: {plantName}
              </span>
            )}
          </div>

          {/* Section 1: Core 5-Star Controller Performance Grade (Original Development Preserved!) */}
          <div className="text-center rounded-2xl bg-surface-muted/30 p-4 border border-border">
            <label className="block text-[11px] font-bold text-muted-text uppercase tracking-wider mb-2.5">
              Controller Design Grade (1–5 Stars)
            </label>
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
                    onClick={() => handleSelectStar(starVal)}
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

          {/* Section 2: Detailed WS04 Outro Evaluation Questions (Added from New folder (2)) */}
          <div className="rounded-2xl border border-border bg-surface-muted/20 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSurveyDetails(!showSurveyDetails)}
              className="w-full flex items-center justify-between p-3 px-4 text-xs font-semibold text-foreground hover:bg-surface-hover/50 transition-colors cursor-pointer border-none bg-transparent"
            >
              <span className="flex items-center gap-2">
                Detailed Controller Evaluation
              </span>
              {showSurveyDetails ? (
                <ChevronUp className="size-4 text-muted" />
              ) : (
                <ChevronDown className="size-4 text-muted" />
              )}
            </button>

            {showSurveyDetails && (
              <div className="p-4 pt-2 border-t border-border/60 space-y-4 text-xs">
                {/* Q1: Technical Usefulness */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-foreground flex justify-between items-center">
                    <span>1. Technical usefulness and correctness of {label}:</span>
                    <label className="flex items-center gap-1.5 font-normal text-muted-text hover:text-foreground cursor-pointer text-[11px]">
                      <input
                        type="checkbox"
                        checked={q1Na}
                        disabled={isReadOnly}
                        onChange={(e) => {
                          setQ1Na(e.target.checked)
                          if (e.target.checked) setQ1(null)
                        }}
                        className="rounded border-border accent-primary size-3"
                      />
                      <span>Couldn't evaluate (N/A)</span>
                    </label>
                  </div>
                  {!q1Na && (
                    <div className="grid grid-cols-5 gap-1.5">
                      {[1, 2, 3, 4, 5].map((val) => (
                        <button
                          key={val}
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => setQ1(val)}
                          className={`py-1.5 rounded-lg border font-mono font-bold transition-colors ${
                            q1 === val
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-surface text-muted-text hover:bg-surface-hover'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Q2: Trust */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-foreground flex justify-between items-center">
                    <span>2. How much do you trust the generated result?</span>
                    <label className="flex items-center gap-1.5 font-normal text-muted-text hover:text-foreground cursor-pointer text-[11px]">
                      <input
                        type="checkbox"
                        checked={q2Na}
                        disabled={isReadOnly}
                        onChange={(e) => {
                          setQ2Na(e.target.checked)
                          if (e.target.checked) setQ2(null)
                        }}
                        className="rounded border-border accent-primary size-3"
                      />
                      <span>Couldn't evaluate (N/A)</span>
                    </label>
                  </div>
                  {!q2Na && (
                    <div className="grid grid-cols-5 gap-1.5">
                      {[1, 2, 3, 4, 5].map((val) => (
                        <button
                          key={val}
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => setQ2(val)}
                          className={`py-1.5 rounded-lg border font-mono font-bold transition-colors ${
                            q2 === val
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-surface text-muted-text hover:bg-surface-hover'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Q3 & Q4: Ease of use & Reuse Intention */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="font-semibold text-foreground">3. Ease of using the workflow:</div>
                    <div className="grid grid-cols-5 gap-1">
                      {[1, 2, 3, 4, 5].map((val) => (
                        <button
                          key={val}
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => setQ3(val)}
                          className={`py-1.5 rounded-lg border font-mono font-bold transition-colors ${
                            q3 === val
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-surface text-muted-text hover:bg-surface-hover'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="font-semibold text-foreground">4. Likelihood to reuse:</div>
                    <div className="grid grid-cols-5 gap-1">
                      {[1, 2, 3, 4, 5].map((val) => (
                        <button
                          key={val}
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => setQ4(val)}
                          className={`py-1.5 rounded-lg border font-mono font-bold transition-colors ${
                            q4 === val
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-surface text-muted-text hover:bg-surface-hover'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Q5: Net Promoter Score */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-baseline">
                    <span className="font-semibold text-foreground">
                      5. Recommendation Likelihood (NPS 0–10):
                    </span>
                    <span className="text-[10.5px] text-muted-text">0: Not likely · 10: Extremely</span>
                  </div>
                  <div className="grid grid-cols-11 gap-1">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => {
                      const isPromoter = val >= 9
                      const isPassive = val >= 7 && val < 9
                      const selected = q5 === val

                      return (
                        <button
                          key={val}
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => setQ5(val)}
                          className={`py-1.5 rounded-md border font-mono font-bold text-[11px] transition-colors ${
                            selected
                              ? isPromoter
                                ? 'bg-emerald-500 text-white border-emerald-500'
                                : isPassive
                                ? 'bg-amber-500 text-white border-amber-500'
                                : 'bg-rose-500 text-white border-rose-500'
                              : 'border-border bg-surface text-muted-text hover:bg-surface-hover'
                          }`}
                        >
                          {val}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Bug Report Checkbox */}
                <label className="flex items-center gap-2 pt-1 text-xs text-muted-text hover:text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isBug}
                    disabled={isReadOnly}
                    onChange={(e) => setIsBug(e.target.checked)}
                    className="rounded border-border accent-red-500 size-3.5"
                  />
                  <span className={`flex items-center gap-1 ${isBug ? 'text-red-500 font-bold' : ''}`}>
                    <Bug className="size-3.5" /> This is a bug report
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Section 3: Engineering feedback / notes */}
          <div>
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
                  No written feedback or notes provided.
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
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-500 dark:text-rose-400">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-3 p-4 px-5 border-t border-border bg-surface shrink-0">
          {isReadOnly ? (
            <div className="flex w-full justify-end">
              <button
                type="button"
                onClick={onClose}
                className={`${btnBase} ${btnCompact} ${btnPrimary} font-semibold px-5`}
              >
                Close
              </button>
            </div>
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
                  <>
                    <Check className="size-3.5" /> Submit Evaluation
                  </>
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
