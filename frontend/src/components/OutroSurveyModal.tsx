import { useEffect, useState } from 'react'
import { AlertCircle, Check, Loader2, X } from 'lucide-react'
import { surveyApi } from '../api/endpoints'
import type { FeedbackPipelineType } from '../api/types'
import { btnPrimary } from '../lib/classes'

export interface OutroSurveyModalProps {
  open: boolean
  pipelineType?: FeedbackPipelineType
  jobId?: string | null
  projectId?: number | null
  plantName?: string | null
  score?: number | null
  success?: boolean | null
  initialRating?: number | null
  initialComment?: string | null
  readOnly?: boolean
  onClose: () => void
  onSubmitted?: (rating: number, comment?: string | null) => void
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

export function OutroSurveyModal({
  open,
  pipelineType = 'siloDesign',
  jobId,
  projectId,
  plantName,
  score,
  success,
  initialRating,
  initialComment,
  readOnly = false,
  onClose,
  onSubmitted,
}: OutroSurveyModalProps) {
  const [q1, setQ1] = useState<number | null>(initialRating || null)
  const [q1Na, setQ1Na] = useState(false)
  const [q2, setQ2] = useState<number | null>(initialRating || null)
  const [q2Na, setQ2Na] = useState(false)
  const [q3, setQ3] = useState<number | null>(4)
  const [q4, setQ4] = useState<number | null>(4)
  const [q5, setQ5] = useState<number | null>(null)
  const [freeText, setFreeText] = useState(initialComment || '')
  const [isBug, setIsBug] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setQ1(initialRating || null)
      setQ1Na(false)
      setQ2(initialRating || null)
      setQ2Na(false)
      setQ3(4)
      setQ4(4)
      setQ5(null)
      setFreeText(initialComment || '')
      setIsBug(false)
      setError(null)
    }
  }, [open, initialRating, initialComment])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, submitting, onClose])

  if (!open) return null

  const label = pipelineLabel(pipelineType)
  const formattedScore =
    typeof score === 'number' && Number.isFinite(score)
      ? `${(score * 100).toFixed(0)}%`
      : null

  const isValid =
    (q1Na || q1 !== null) &&
    (q2Na || q2 !== null) &&
    q3 !== null &&
    q4 !== null &&
    q5 !== null

  const handleSubmit = async () => {
    if (!isValid) {
      setError('Please answer all 5 questions (or check "couldn\'t evaluate" where allowed).')
      return
    }

    setSubmitting(true)
    setError(null)

    // Derived rating for backward-compatible star score
    const effectiveRating = q1 ?? q2 ?? q3 ?? 4

    try {
      await surveyApi.submitFeedback({
        pipeline_type: pipelineType,
        job_id: jobId || null,
        project_id: projectId || null,
        plant_name: plantName || null,
        score: score ?? null,
        success: success ?? null,
        technical_usefulness: q1Na ? null : q1,
        technical_usefulness_na: q1Na,
        trust: q2Na ? null : q2,
        trust_na: q2Na,
        ease_of_use: q3 ?? 4,
        reuse_intention: q4 ?? 4,
        nps: q5,
        main_problems: freeText.trim(),
        is_bug: isBug,
        satisfaction: effectiveRating,
        confidence: q2 ?? effectiveRating,
      })

      onSubmitted?.(effectiveRating, freeText.trim() || null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(4,6,10,0.75)] p-4 backdrop-blur-[6px] animate-in fade-in-50 duration-150"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div
        className="w-[580px] max-w-full max-h-[min(92vh,780px)] flex flex-col rounded-2xl border border-border bg-surface-elevated shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-in zoom-in-95 duration-150 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="outro-survey-title"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 p-5 pb-0 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="rounded-full bg-primary/15 border border-primary/30 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                {label} Feedback
              </span>
              {readOnly && (
                <span className="rounded-md border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-text">
                  Inspection View
                </span>
              )}
            </div>
            <h1 id="outro-survey-title" className="m-0 text-lg font-bold text-foreground tracking-tight">
              {readOnly ? `${label} Feedback Review` : `How was your ${label} result?`}
            </h1>
            <p className="mt-1 text-xs text-muted-text">
              {readOnly
                ? `Evaluation details and user feedback recorded for ${label}.`
                : `Five quick questions · about 45 seconds. Helps us improve controller quality, validation, and the ${label} workflow.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-muted hover:text-foreground hover:bg-surface-hover transition-colors cursor-pointer border border-border bg-surface-muted"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tracing Context Chip */}
        <div className="mx-5 mt-3 p-2.5 rounded-xl border border-border/70 bg-surface-muted/50 text-[11.5px] text-muted-text flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0">
          <span>
            <strong className="text-foreground">Pipeline:</strong> {label}
          </span>
          {jobId && (
            <span className="font-mono text-muted">
              <strong>Job:</strong> {jobId.slice(0, 12)}…
            </span>
          )}
          {plantName && (
            <span className="truncate max-w-[170px]" title={plantName}>
              <strong className="text-foreground">Plant:</strong> {plantName}
            </span>
          )}
          {formattedScore && (
            <span className="font-semibold text-primary">
              Score {formattedScore} {success ? '· Success' : success === false ? '· Needs Tuning' : ''}
            </span>
          )}
        </div>

        {/* Scrollable Questions Body */}
        <div className={`flex-1 overflow-y-auto p-5 space-y-5 ${readOnly ? 'pointer-events-none select-none opacity-90' : ''}`}>
          {/* Question 1 */}
          <div className="space-y-1.5">
            <div className="text-[13.5px] font-semibold text-foreground">
              1. How technically useful and correct was the result generated by {label}?
            </div>
            <div className="flex justify-between text-[11px] text-muted-text">
              <span>Not useful / incorrect</span>
              <span>Very useful / correct</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Technical usefulness 1 to 5">
              {[1, 2, 3, 4, 5].map((val) => (
                <button
                  key={val}
                  type="button"
                  disabled={q1Na}
                  onClick={() => setQ1(val)}
                  className={`h-10 rounded-lg border text-xs font-mono font-bold transition-all ${
                    q1Na
                      ? 'border-border/40 bg-surface-muted/30 text-muted/30 cursor-not-allowed'
                      : q1 === val
                      ? 'border-primary/50 bg-primary/20 text-primary shadow-xs'
                      : 'border-border bg-surface-muted/60 text-muted-text hover:text-foreground hover:bg-surface-muted'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-text hover:text-foreground cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={q1Na}
                onChange={(e) => {
                  setQ1Na(e.target.checked)
                  if (e.target.checked) setQ1(null)
                }}
                className="rounded border-border accent-primary size-3.5"
              />
              <span>I couldn’t evaluate this</span>
            </label>
          </div>

          {/* Question 2 */}
          <div className="space-y-1.5">
            <div className="text-[13.5px] font-semibold text-foreground">
              2. How much would you trust the generated controller and validation evidence as a basis for further engineering work?
            </div>
            <div className="flex justify-between text-[11px] text-muted-text">
              <span>Would not trust it</span>
              <span>Would strongly trust it</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Trust 1 to 5">
              {[1, 2, 3, 4, 5].map((val) => (
                <button
                  key={val}
                  type="button"
                  disabled={q2Na}
                  onClick={() => setQ2(val)}
                  className={`h-10 rounded-lg border text-xs font-mono font-bold transition-all ${
                    q2Na
                      ? 'border-border/40 bg-surface-muted/30 text-muted/30 cursor-not-allowed'
                      : q2 === val
                      ? 'border-primary/50 bg-primary/20 text-primary shadow-xs'
                      : 'border-border bg-surface-muted/60 text-muted-text hover:text-foreground hover:bg-surface-muted'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-text hover:text-foreground cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={q2Na}
                onChange={(e) => {
                  setQ2Na(e.target.checked)
                  if (e.target.checked) setQ2(null)
                }}
                className="rounded border-border accent-primary size-3.5"
              />
              <span>I couldn’t evaluate this</span>
            </label>
          </div>

          {/* Question 3 */}
          <div className="space-y-1.5">
            <div className="text-[13.5px] font-semibold text-foreground">
              3. How easy was it to provide your system, run {label}, and understand what to do?
            </div>
            <div className="flex justify-between text-[11px] text-muted-text">
              <span>Very difficult</span>
              <span>Very easy</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Ease 1 to 5">
              {[1, 2, 3, 4, 5].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setQ3(val)}
                  className={`h-10 rounded-lg border text-xs font-mono font-bold transition-all ${
                    q3 === val
                      ? 'border-primary/50 bg-primary/20 text-primary shadow-xs'
                      : 'border-border bg-surface-muted/60 text-muted-text hover:text-foreground hover:bg-surface-muted'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          {/* Question 4 */}
          <div className="space-y-1.5">
            <div className="text-[13.5px] font-semibold text-foreground">
              4. How likely are you to use {label} again for another control-design task?
            </div>
            <div className="flex justify-between text-[11px] text-muted-text">
              <span>Very unlikely</span>
              <span>Very likely</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Reuse likelihood 1 to 5">
              {[1, 2, 3, 4, 5].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setQ4(val)}
                  className={`h-10 rounded-lg border text-xs font-mono font-bold transition-all ${
                    q4 === val
                      ? 'border-primary/50 bg-primary/20 text-primary shadow-xs'
                      : 'border-border bg-surface-muted/60 text-muted-text hover:text-foreground hover:bg-surface-muted'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          {/* Question 5: NPS 0-10 */}
          <div className="space-y-1.5">
            <div className="text-[13.5px] font-semibold text-foreground">
              5. How likely are you to recommend LabCD {label} to a friend or colleague?
            </div>
            <div className="flex justify-between text-[11px] text-muted-text">
              <span>Not at all likely</span>
              <span>Extremely likely</span>
            </div>
            <div className="grid grid-cols-6 sm:grid-cols-11 gap-1" role="group" aria-label="NPS 0 to 10">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setQ5(val)}
                  className={`h-9 rounded-md border text-xs font-mono font-bold transition-all ${
                    q5 === val
                      ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                      : 'border-border bg-surface-muted/60 text-muted-text hover:text-foreground hover:bg-surface-muted'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          {/* Optional Textarea & Bug Flag */}
          <div className="space-y-2 pt-1 border-t border-border/60">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-foreground">
                What should we improve or fix? <span className="font-normal text-muted-text">(optional)</span>
              </span>
            </div>
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Share feedback, confusing steps, or bug details..."
              rows={3}
              className="w-full rounded-xl border border-border bg-surface-muted/50 p-3 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors resize-y"
            />
            <label className="flex items-center gap-2 text-xs text-muted-text hover:text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={isBug}
                onChange={(e) => setIsBug(e.target.checked)}
                className="rounded border-border accent-red-500 size-3.5"
              />
              <span className={isBug ? 'text-red-500 font-semibold' : ''}>
                This is a bug report
              </span>
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between gap-3 p-4 px-5 border-t border-border bg-surface shrink-0">
          {readOnly ? (
            <div className="flex w-full justify-end">
              <button
                type="button"
                onClick={onClose}
                className={`${btnPrimary} text-xs`}
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
                className="text-xs text-muted hover:text-foreground hover:underline cursor-pointer border-none bg-transparent"
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !isValid}
                className={`${btnPrimary} flex items-center gap-1.5 text-xs shadow-sm`}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    <Check className="size-3.5" /> Submit feedback
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
