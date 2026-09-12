import { useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, X } from 'lucide-react'
import { surveyApi } from '../api/endpoints'
import { btnBase, btnPrimary } from '../lib/classes'

export interface BeforeTestSurveyModalProps {
  open: boolean
  onClose: () => void
  onSubmitted?: () => void
}

const Q1_OPTIONS = [
  'Within the last month',
  '1–3 months ago',
  '3–6 months ago',
  '6–12 months ago',
  'More than a year ago',
  'I haven’t worked on one yet',
]

const Q2_OPTIONS = [
  'Less than 2 hours',
  '2–5 hours',
  '5–10 hours',
  '10–20 hours',
  '20–40 hours',
  '40–80 hours',
  'More than 80 hours',
  'Not applicable',
]

const Q4_OPTIONS = [
  'System modeling',
  'System identification',
  'Choosing the controller architecture',
  'Controller design',
  'Gain tuning',
  'Stability analysis',
  'Performance validation',
  'Debugging and iteration',
  'Hardware implementation',
  'Learning the required control theory',
  'Using existing software/tools',
  'Other',
]

const Q6_OPTIONS = [
  'MATLAB / Simulink',
  'Python',
  'AI assistants',
  'Online search / documentation',
  'Papers or textbooks',
  'A colleague',
  'A control-system expert',
  'External consultant',
  'Trial-and-error tuning',
  'Other',
  'I didn’t need help',
]

const Q7_OPTIONS = [
  'Yes, I hired and paid someone',
  'Yes, I asked for pricing but didn’t hire anyone',
  'Yes, I considered getting outside help but didn’t ask for pricing',
  'No, I did the work myself',
  'No, I was hired/paid to do the control-design work',
  'Not applicable',
]

const Q8_OPTIONS = [
  'Less than 1',
  '1–2',
  '2–3.5',
  '3.5–7',
  'More than 7',
  'Prefer not to say',
]

const Q9_OPTIONS = [
  'Delayed the project',
  'Increased engineering time',
  'Increased project cost',
  'Required specialist help',
  'Caused significant rework',
  'Reduced performance goals',
  'Delayed hardware testing / deployment',
  'No significant impact',
  'Other',
]

type StepKey = 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6' | 'q7' | 'q8' | 'q9'

export function BeforeTestSurveyModal({
  open,
  onClose,
  onSubmitted,
}: BeforeTestSurveyModalProps) {
  const [q1, setQ1] = useState<string>('')
  const [q2, setQ2] = useState<string>('')
  const [q3, setQ3] = useState<number>(3)
  const [q4, setQ4] = useState<string[]>([])
  const [q5, setQ5] = useState<string>('')
  const [q6, setQ6] = useState<string[]>([])
  const [q7, setQ7] = useState<string>('')
  const [q8a, setQ8a] = useState<string>('')
  const [q8b, setQ8b] = useState<string>('')
  const [q9, setQ9] = useState<string[]>([])

  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  // Compute active question keys based on branching
  const activeSteps: StepKey[] = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']
  const needsQ8A = q7 === 'Yes, I hired and paid someone'
  const needsQ8B = q7 === 'No, I was hired/paid to do the control-design work'

  if (needsQ8A || needsQ8B) {
    activeSteps.push('q8')
  }
  activeSteps.push('q9')

  const currentStepKey = activeSteps[currentStepIndex] || 'q1'
  const totalSteps = activeSteps.length
  const progressPct = Math.round(((currentStepIndex + 1) / totalSteps) * 100)

  const isCurrentStepValid = (): boolean => {
    switch (currentStepKey) {
      case 'q1':
        return Boolean(q1)
      case 'q2':
        return Boolean(q2)
      case 'q3':
        return q3 >= 1 && q3 <= 5
      case 'q4':
        return q4.length > 0 && q4.length <= 3
      case 'q5':
        return true // Optional long text
      case 'q6':
        return q6.length > 0
      case 'q7':
        return Boolean(q7)
      case 'q8':
        return needsQ8A ? Boolean(q8a) : needsQ8B ? Boolean(q8b) : true
      case 'q9':
        return q9.length > 0
      default:
        return false
    }
  }

  const toggleMultiSelect = (
    list: string[],
    item: string,
    maxSelectable?: number,
  ): string[] => {
    if (list.includes(item)) {
      return list.filter((x) => x !== item)
    }
    if (maxSelectable && list.length >= maxSelectable) {
      return list
    }
    return [...list, item]
  }

  const handleNext = () => {
    if (!isCurrentStepValid()) {
      setError('Please answer the question to proceed.')
      return
    }
    setError(null)
    if (currentStepIndex < totalSteps - 1) {
      setCurrentStepIndex((prev) => prev + 1)
    } else {
      handleSubmit()
    }
  }

  const handleBack = () => {
    setError(null)
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1)
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await surveyApi.submitBeforeTest({
        q1_last_worked: q1,
        q2_time_spent: q2 || 'Not applicable',
        q3_knowledge_gaps: q3,
        q4_difficult_parts: q4,
        q5_biggest_problem: q5.trim(),
        q6_help_sources: q6,
        q7_considered_paying: q7,
        q8a_amount_hired: needsQ8A ? q8a : null,
        q8b_amount_paid_to_user: needsQ8B ? q8b : null,
        q9_impact: q9,
      })
      onSubmitted?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit survey')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(4,6,10,0.75)] p-4 backdrop-blur-[6px] animate-in fade-in-50 duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="before-test-title"
    >
      <div className="w-[580px] max-w-full max-h-[min(92vh,780px)] flex flex-col rounded-2xl border border-border bg-surface-elevated shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-in zoom-in-95 duration-150 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 p-5 pb-0 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="rounded-full bg-primary/15 border border-primary/30 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                Question {currentStepIndex + 1} of {totalSteps}
              </span>
              <span className="rounded-md border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-text">
                Before-Test Survey
              </span>
            </div>
            <h1 id="before-test-title" className="m-0 text-lg font-bold text-foreground tracking-tight">
              Prior Experience & Control Background
            </h1>
            <p className="mt-1 text-xs text-muted-text">
              Helps us benchmark automated design performance against traditional workflows.
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

        {/* Progress Bar & Dots */}
        <div className="px-5 pt-3 shrink-0">
          <div className="h-1.5 w-full rounded-full bg-surface-muted border border-border/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-indigo-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-center items-center gap-1.5 mt-2.5">
            {activeSteps.map((step, idx) => (
              <span
                key={step}
                className={`transition-all duration-200 ${
                  idx === currentStepIndex
                    ? 'w-4 h-1.5 rounded-full bg-primary'
                    : idx < currentStepIndex
                    ? 'w-1.5 h-1.5 rounded-full bg-primary/40'
                    : 'w-1.5 h-1.5 rounded-full bg-border'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Question Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Question 1 */}
          {currentStepKey === 'q1' && (
            <div className="space-y-3">
              <div className="text-[14px] font-semibold text-foreground">
                1. When did you last work on a control-system design project?
              </div>
              <div className="space-y-2">
                {Q1_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setQ1(opt)
                      if (opt === 'I haven’t worked on one yet' && !q2) {
                        setQ2('Not applicable')
                      }
                    }}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border text-left text-xs font-medium transition-colors cursor-pointer ${
                      q1 === opt
                        ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                        : 'border-border bg-surface-muted/40 text-foreground hover:bg-surface-hover hover:border-border-hover'
                    }`}
                  >
                    <span>{opt}</span>
                    <div
                      className={`size-4 rounded-full border flex items-center justify-center ${
                        q1 === opt
                          ? 'border-primary bg-primary text-white'
                          : 'border-border'
                      }`}
                    >
                      {q1 === opt && <div className="size-1.5 rounded-full bg-white" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Question 2 */}
          {currentStepKey === 'q2' && (
            <div className="space-y-3">
              <div className="text-[14px] font-semibold text-foreground">
                2. Approximately how much time did you spend on the control-design work?
              </div>
              <p className="text-xs text-muted-text">
                Include modeling, tuning, validation, and debugging.
              </p>
              <div className="space-y-2">
                {Q2_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setQ2(opt)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border text-left text-xs font-medium transition-colors cursor-pointer ${
                      q2 === opt
                        ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                        : 'border-border bg-surface-muted/40 text-foreground hover:bg-surface-hover hover:border-border-hover'
                    }`}
                  >
                    <span>{opt}</span>
                    <div
                      className={`size-4 rounded-full border flex items-center justify-center ${
                        q2 === opt
                          ? 'border-primary bg-primary text-white'
                          : 'border-border'
                      }`}
                    >
                      {q2 === opt && <div className="size-1.5 rounded-full bg-white" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Question 3 */}
          {currentStepKey === 'q3' && (
            <div className="space-y-4">
              <div className="text-[14px] font-semibold text-foreground">
                3. How much did gaps in control-system knowledge slow you down or make the project harder?
              </div>
              <div className="flex justify-between text-xs text-muted-text">
                <span>1 — Not at all</span>
                <span>5 — A great deal</span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setQ3(val)}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border font-bold text-sm transition-all cursor-pointer ${
                      q3 === val
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm scale-[1.02]'
                        : 'border-border bg-surface-muted/40 text-foreground hover:bg-surface-hover hover:border-border-hover'
                    }`}
                  >
                    <span>{val}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Question 4 */}
          {currentStepKey === 'q4' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-semibold text-foreground">
                  4. Which parts of the control-design process were most difficult?
                </div>
                <span className="text-xs font-mono font-semibold text-primary">
                  {q4.length}/3 selected
                </span>
              </div>
              <p className="text-xs text-muted-text">Select up to 3 options that caused the biggest friction.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Q4_OPTIONS.map((opt) => {
                  const isChecked = q4.includes(opt)
                  const isMaxed = !isChecked && q4.length >= 3
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={isMaxed}
                      onClick={() => setQ4((prev) => toggleMultiSelect(prev, opt, 3))}
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs font-medium transition-colors cursor-pointer ${
                        isChecked
                          ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                          : isMaxed
                          ? 'border-border/40 bg-surface-muted/20 text-muted opacity-50 cursor-not-allowed'
                          : 'border-border bg-surface-muted/40 text-foreground hover:bg-surface-hover hover:border-border-hover'
                      }`}
                    >
                      <span>{opt}</span>
                      <div
                        className={`size-4 rounded-md border flex items-center justify-center shrink-0 ml-2 ${
                          isChecked
                            ? 'border-primary bg-primary text-white'
                            : 'border-border'
                        }`}
                      >
                        {isChecked && <Check className="size-3" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Question 5 */}
          {currentStepKey === 'q5' && (
            <div className="space-y-3">
              <div className="text-[14px] font-semibold text-foreground">
                5. What was the single biggest problem you faced?
              </div>
              <p className="text-xs text-muted-text">
                (Optional) Describe what was difficult, slow, or frustrating during control design or simulation.
              </p>
              <textarea
                value={q5}
                onChange={(e) => setQ5(e.target.value)}
                placeholder="Describe what was difficult, slow, or frustrating..."
                rows={5}
                className="w-full rounded-xl border border-border bg-surface-muted/50 p-3 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors resize-y"
              />
            </div>
          )}

          {/* Question 6 */}
          {currentStepKey === 'q6' && (
            <div className="space-y-3">
              <div className="text-[14px] font-semibold text-foreground">
                6. When you got stuck, what did you use for help?
              </div>
              <p className="text-xs text-muted-text">Select all that apply.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Q6_OPTIONS.map((opt) => {
                  const isChecked = q6.includes(opt)
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setQ6((prev) => toggleMultiSelect(prev, opt))}
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs font-medium transition-colors cursor-pointer ${
                        isChecked
                          ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                          : 'border-border bg-surface-muted/40 text-foreground hover:bg-surface-hover hover:border-border-hover'
                      }`}
                    >
                      <span>{opt}</span>
                      <div
                        className={`size-4 rounded-md border flex items-center justify-center shrink-0 ml-2 ${
                          isChecked
                            ? 'border-primary bg-primary text-white'
                            : 'border-border'
                        }`}
                      >
                        {isChecked && <Check className="size-3" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Question 7 */}
          {currentStepKey === 'q7' && (
            <div className="space-y-3">
              <div className="text-[14px] font-semibold text-foreground">
                7. Did you consider paying someone to help with the control-design work?
              </div>
              <div className="space-y-2">
                {Q7_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setQ7(opt)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border text-left text-xs font-medium transition-colors cursor-pointer ${
                      q7 === opt
                        ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                        : 'border-border bg-surface-muted/40 text-foreground hover:bg-surface-hover hover:border-border-hover'
                    }`}
                  >
                    <span>{opt}</span>
                    <div
                      className={`size-4 rounded-full border flex items-center justify-center ${
                        q7 === opt
                          ? 'border-primary bg-primary text-white'
                          : 'border-border'
                      }`}
                    >
                      {q7 === opt && <div className="size-1.5 rounded-full bg-white" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Question 8 Branching */}
          {currentStepKey === 'q8' && (
            <div className="space-y-3">
              <div className="text-[14px] font-semibold text-foreground">
                {needsQ8A
                  ? '8A. If you hired someone, approximately how much did you pay?'
                  : '8B. If you were paid to do the control-design work, approximately how much were you paid?'}
              </div>
              <p className="text-xs text-muted-text">Unit: Million Tomans (میلیون تومان)</p>
              <div className="space-y-2">
                {Q8_OPTIONS.map((opt) => {
                  const selected = needsQ8A ? q8a === opt : q8b === opt
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        if (needsQ8A) setQ8a(opt)
                        else setQ8b(opt)
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-left text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                          : 'border-border bg-surface-muted/40 text-foreground hover:bg-surface-hover hover:border-border-hover'
                      }`}
                    >
                      <span>{opt}</span>
                      <div
                        className={`size-4 rounded-full border flex items-center justify-center ${
                          selected
                            ? 'border-primary bg-primary text-white'
                            : 'border-border'
                        }`}
                      >
                        {selected && <div className="size-1.5 rounded-full bg-white" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Question 9 */}
          {currentStepKey === 'q9' && (
            <div className="space-y-3">
              <div className="text-[14px] font-semibold text-foreground">
                9. What impact did control-design difficulties have on the project?
              </div>
              <p className="text-xs text-muted-text">Select all that apply.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Q9_OPTIONS.map((opt) => {
                  const isChecked = q9.includes(opt)
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setQ9((prev) => toggleMultiSelect(prev, opt))}
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs font-medium transition-colors cursor-pointer ${
                        isChecked
                          ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                          : 'border-border bg-surface-muted/40 text-foreground hover:bg-surface-hover hover:border-border-hover'
                      }`}
                    >
                      <span>{opt}</span>
                      <div
                        className={`size-4 rounded-md border flex items-center justify-center shrink-0 ml-2 ${
                          isChecked
                            ? 'border-primary bg-primary text-white'
                            : 'border-border'
                        }`}
                      >
                        {isChecked && <Check className="size-3" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between gap-3 p-4 px-5 border-t border-border bg-surface shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBack}
              disabled={currentStepIndex === 0 || submitting}
              className={`${btnBase} text-xs flex items-center gap-1.5 disabled:opacity-30`}
            >
              <ArrowLeft className="size-3.5" /> Back
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-xs text-muted hover:text-foreground hover:underline cursor-pointer border-none bg-transparent ml-1"
            >
              Skip
            </button>
          </div>
          <button
            type="button"
            onClick={handleNext}
            disabled={submitting || !isCurrentStepValid()}
            className={`${btnPrimary} flex items-center gap-1.5 text-xs shadow-sm`}
          >
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Submitting…
              </>
            ) : currentStepIndex < totalSteps - 1 ? (
              <>
                Continue <ArrowRight className="size-3.5" />
              </>
            ) : (
              <>
                <Check className="size-3.5" /> Complete survey
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
