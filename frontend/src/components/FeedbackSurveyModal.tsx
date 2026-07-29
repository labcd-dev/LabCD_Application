import { useEffect, useState, type FormEvent } from 'react'
import type { FeedbackPipelineType } from '../api/types'
import { surveyApi } from '../api/endpoints'
import { StatusMessage } from './StatusMessage'
import { btnBase, btnPrimary, btnWide, fieldInput, fieldLabel } from '../lib/classes'
import { pipelineLabel } from '../lib/projectLabels'

const LIKERT_FIELDS = [
  { key: 'satisfaction', label: 'Satisfaction' },
  { key: 'ease_of_use', label: 'Ease of use' },
  { key: 'product_value', label: 'Product value' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'reuse_intention', label: 'Reuse intention' },
  { key: 'willingness_to_pay', label: 'Willingness to pay' },
] as const

type LikertKey = (typeof LIKERT_FIELDS)[number]['key']

interface FeedbackSurveyModalProps {
  open: boolean
  pipelineType: FeedbackPipelineType
  /** When more than one, show a design picker. Defaults to `[pipelineType]`. */
  availablePipelines?: FeedbackPipelineType[]
  /** Voluntary FAB flow uses Cancel + general copy instead of post-design prompt. */
  voluntary?: boolean
  onSubmitted: () => void | Promise<void>
  onDismiss: () => void
}

export function FeedbackSurveyModal({
  open,
  pipelineType,
  availablePipelines,
  voluntary = false,
  onSubmitted,
  onDismiss,
}: FeedbackSurveyModalProps) {
  const pipelines = availablePipelines?.length ? availablePipelines : [pipelineType]
  const [selectedPipeline, setSelectedPipeline] = useState<FeedbackPipelineType>(pipelineType)
  const [ratings, setRatings] = useState<Partial<Record<LikertKey, number>>>({})
  const [mainProblems, setMainProblems] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const pipelines = availablePipelines?.length ? availablePipelines : [pipelineType]
    setSelectedPipeline(pipelines.includes(pipelineType) ? pipelineType : pipelines[0])
    setRatings({})
    setMainProblems('')
    setError(null)
    setSaving(false)
  }, [open, pipelineType, availablePipelines])

  if (!open) return null

  const designLabel = pipelineLabel(selectedPipeline)
  const showPipelinePicker = pipelines.length > 1

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    for (const field of LIKERT_FIELDS) {
      if (!ratings[field.key]) {
        setError(`Please rate "${field.label}" (1–5).`)
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      await surveyApi.submitFeedback({
        pipeline_type: selectedPipeline,
        satisfaction: ratings.satisfaction!,
        ease_of_use: ratings.ease_of_use!,
        product_value: ratings.product_value!,
        confidence: ratings.confidence!,
        reuse_intention: ratings.reuse_intention!,
        willingness_to_pay: ratings.willingness_to_pay!,
        main_problems: mainProblems.trim(),
      })
      await onSubmitted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="admin-fade-in absolute inset-0 bg-foreground/45 backdrop-blur-[2px]"
        aria-label={voluntary ? 'Close feedback survey' : 'Dismiss feedback survey'}
        onClick={onDismiss}
      />
      <div
        className="admin-slide-in relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-4 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-survey-title"
      >
        <h2 id="feedback-survey-title" className="m-0 text-xl font-semibold text-foreground">
          {voluntary ? 'Send feedback' : `How was your ${designLabel} experience?`}
        </h2>
        <p className="mt-2 text-sm text-muted-text">
          {voluntary
            ? 'Rate each item from 1 (low) to 5 (high). Thanks for helping us improve LabCD.'
            : `Rate each item from 1 (low) to 5 (high). You can skip for now; we will ask again after your next successful ${designLabel} design.`}
        </p>

        <form className="mt-5" onSubmit={(e) => void handleSubmit(e)}>
          {showPipelinePicker && (
            <label className={fieldLabel}>
              <span>Design</span>
              <select
                className={fieldInput}
                value={selectedPipeline}
                onChange={(e) => setSelectedPipeline(e.target.value as FeedbackPipelineType)}
                required
              >
                {pipelines.map((pipeline) => (
                  <option key={pipeline} value={pipeline}>
                    {pipelineLabel(pipeline)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {LIKERT_FIELDS.map((field) => (
            <label key={field.key} className={fieldLabel}>
              <span>{field.label}</span>
              <select
                className={fieldInput}
                value={ratings[field.key] ?? ''}
                onChange={(e) =>
                  setRatings((prev) => ({
                    ...prev,
                    [field.key]: Number(e.target.value),
                  }))
                }
                required
              >
                <option value="" disabled>
                  Select 1–5…
                </option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <label className={fieldLabel}>
            <span>Main problems</span>
            <textarea
              className={`${fieldInput} min-h-[88px] resize-y`}
              value={mainProblems}
              onChange={(e) => setMainProblems(e.target.value)}
              maxLength={4000}
              placeholder="Optional — what got in your way?"
            />
          </label>

          {error && <StatusMessage type="error" message={error} />}

          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button type="button" className={`${btnBase} ${btnWide} sm:mt-4`} onClick={onDismiss}>
              {voluntary ? 'Cancel' : 'Skip for now'}
            </button>
            <button type="submit" className={`${btnPrimary} ${btnWide}`} disabled={saving}>
              {saving ? 'Submitting…' : 'Submit feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
