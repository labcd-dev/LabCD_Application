import { useState } from 'react'
import { FastForward, HelpCircle, Loader2, Send } from 'lucide-react'
import type { AdaptiveJobStatusResponse } from '../../api/types'
import { btnBase, btnCompact, btnPrimary } from '../../lib/classes'

interface AdaptiveClarifierChatProps {
  job: AdaptiveJobStatusResponse
  onSubmitAnswer: (answer: string, forceFinish?: boolean) => Promise<void>
  submitting: boolean
}

export function AdaptiveClarifierChat({
  job,
  onSubmitAnswer,
  submitting,
}: AdaptiveClarifierChatProps) {
  const [answerText, setAnswerText] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!answerText.trim() || submitting) return
    onSubmitAnswer(answerText.trim(), false).then(() => {
      setAnswerText('')
    })
  }

  const handleSkip = () => {
    if (submitting) return
    onSubmitAnswer('', true)
  }

  const quickPicks = [
    'No known severe external disturbances',
    'Expect bounded sinusoidal disturbances (±10%)',
    'Parametric uncertainty is within ±20% of nominal',
    'Assume stiff mechanical coupling without backlash',
  ]

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface-elevated p-6 text-foreground shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4 mb-5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
            <HelpCircle className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">System Clarifier Agent</h3>
              <span className="rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[11px] font-bold text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                Inquiry #{job.round || 1}
              </span>
            </div>
            <p className="text-xs text-muted">
              The clarifier assesses parametric uncertainty and disturbance bounds before controller derivation.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-muted hover:text-foreground`}
          title="Skip remaining questions and proceed with standard conservative defaults"
        >
          <FastForward className="size-3.5" />
          Skip with defaults
        </button>
      </div>

      {/* Clarifier Prompt Box */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm leading-relaxed text-foreground">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cyan-600 dark:text-cyan-400">
          <span className="size-2 rounded-full bg-cyan-500 animate-pulse" />
          Clarifier Inquiry:
        </div>
        <div className="whitespace-pre-wrap font-sans">
          {job.last_clarifier_reply ||
            'Analyzing physical system dynamics... Please specify if there are known bounds on mass/inertia variation or unmodeled frictional forces.'}
        </div>
      </div>

      {/* Quick Option Suggestions */}
      <div className="mt-4">
        <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          Suggested responses:
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {quickPicks.map((pick, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setAnswerText(pick)}
              className="rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 text-xs text-muted-text hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-700 dark:hover:text-cyan-200 transition-all text-left"
            >
              {pick}
            </button>
          ))}
        </div>
      </div>

      {/* Answer Form */}
      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-muted-text mb-1">Your response:</label>
          <textarea
            rows={3}
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            placeholder="Type physical constraints, disturbance assumptions, or select a suggested response above..."
            className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs text-foreground placeholder-muted focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-all"
            disabled={submitting}
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-muted">
            Answers directly tune the backstepping $\sigma$-modification and Lyapunov gain parameters.
          </span>
          <button
            type="submit"
            disabled={!answerText.trim() || submitting}
            className={`${btnBase} ${btnCompact} ${btnPrimary} flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-teal-500 text-black font-semibold border-none`}
          >
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                Submit answer
                <Send className="size-3" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
