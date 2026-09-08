import { useState } from 'react'
import { CheckCircle2, AlertTriangle, Star, Clock, Coins, Flame } from 'lucide-react'
import type { SessionMetadata } from '../api/types'
import { GradeDesignModal } from './GradeDesignModal'

export interface ScoreReportBadgeProps {
  moduleType: 'adaptive' | 'mpc' | 'project'
  jobId?: string | null
  projectId?: number | null
  score?: number | null
  success?: boolean | null
  rating?: number | null
  comment?: string | null
  sessionMetadata?: SessionMetadata | null
  readOnly?: boolean
  onGradeSubmitted?: (rating: number, comment?: string | null) => void
  compact?: boolean
  className?: string
}

export function ScoreReportBadge({
  moduleType,
  jobId,
  projectId,
  score,
  success,
  rating: initialRating,
  comment: initialComment,
  sessionMetadata,
  readOnly = false,
  onGradeSubmitted,
  compact = false,
  className = '',
}: ScoreReportBadgeProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [currentRating, setCurrentRating] = useState<number | null | undefined>(initialRating)
  const [currentComment, setCurrentComment] = useState<string | null | undefined>(initialComment)

  // Keep internal state aligned if props update
  if (initialRating !== undefined && initialRating !== currentRating) {
    setCurrentRating(initialRating)
  }
  if (initialComment !== undefined && initialComment !== currentComment) {
    setCurrentComment(initialComment)
  }

  const handleSubmitted = (newRating: number, newComment?: string | null) => {
    setCurrentRating(newRating)
    setCurrentComment(newComment)
    onGradeSubmitted?.(newRating, newComment)
  }

  const hasScore = typeof score === 'number' && Number.isFinite(score)
  const formattedScore = hasScore ? `${(score * 100).toFixed(0)}%` : '—'
  const isSuccess = success === true
  const isFailed = success === false

  const tokens = sessionMetadata?.tokens
  const totalTokens =
    typeof tokens?.total === 'number'
      ? tokens.total
      : typeof (tokens as any)?.total_tokens === 'number'
      ? (tokens as any).total_tokens
      : null
  const costUsd = typeof sessionMetadata?.cost_usd === 'number' ? sessionMetadata.cost_usd : null
  const wallClockTime =
    typeof sessionMetadata?.wall_clock_time_s === 'number'
      ? sessionMetadata.wall_clock_time_s
      : typeof (sessionMetadata as any)?.wall_clock_time_seconds === 'number'
      ? (sessionMetadata as any).wall_clock_time_seconds
      : null
  const errorCounts = typeof sessionMetadata?.error_counts === 'number' ? sessionMetadata.error_counts : null

  return (
    <>
      <div
        className={`inline-flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-elevated/90 px-3 py-1.5 shadow-xs backdrop-blur-xs transition-colors ${className}`}
      >
        {/* Status Pill: [Success] or [Failed] or [Needs Tuning] */}
        {success !== undefined && success !== null && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold border transition-colors ${
              isSuccess
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : isFailed
                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
            }`}
          >
            {isSuccess ? (
              <CheckCircle2 className="size-3 text-emerald-500" />
            ) : (
              <AlertTriangle className="size-3 text-rose-500" />
            )}
            {isSuccess ? 'Success' : isFailed ? 'Needs Tuning' : 'Evaluated'}
          </span>
        )}

        {/* Score Pill: e.g. Score 85% */}
        {hasScore && (
          <div className="flex items-baseline gap-1 font-mono text-xs text-foreground">
            <span className="text-[11px] font-semibold text-muted-text">Score</span>
            <span
              className={`font-bold px-2 py-0.5 rounded-md ${
                score >= 0.8
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold'
                  : score >= 0.5
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold'
              }`}
            >
              {formattedScore}
            </span>
          </div>
        )}

        {/* Star Rating Badge */}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="group inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-all hover:bg-surface-hover focus:outline-none cursor-pointer border-none bg-transparent"
          title={readOnly ? "Click to inspect user's evaluation and notes" : "Click to grade or review this design"}
        >
          {currentRating && currentRating > 0 ? (
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`size-3.5 ${
                    s <= currentRating
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-muted/30'
                  }`}
                />
              ))}
              <span className="ml-1 text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400">
                {currentRating}.0
              </span>
            </div>
          ) : readOnly ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-text group-hover:text-foreground">
              <Star className="size-3.5 text-muted/40 group-hover:text-amber-400" />
              Not rated yet
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 group-hover:underline">
              <Star className="size-3.5 text-amber-400 group-hover:fill-amber-400" />
              Rate design
            </span>
          )}
        </button>

        {/* Optional Micro-telemetry chips in non-compact mode */}
        {!compact && sessionMetadata && (
          <div className="hidden lg:flex items-center gap-2 border-l border-border pl-2 text-[10.5px] font-mono text-muted-text">
            {wallClockTime !== null && (
              <span className="flex items-center gap-1" title="Execution wall clock time">
                <Clock className="size-3 text-cyan-500" />
                {wallClockTime.toFixed(1)}s
              </span>
            )}
            {totalTokens !== null && (
              <span className="flex items-center gap-1" title="Total LLM tokens">
                <Flame className="size-3 text-purple-500" />
                {totalTokens.toLocaleString()} tok
              </span>
            )}
            {costUsd !== null && (
              <span className="flex items-center gap-1 text-purple-600 dark:text-purple-300 font-semibold" title="LLM cost">
                <Coins className="size-3 text-purple-500" />
                ${costUsd.toFixed(4)}
              </span>
            )}
            {errorCounts !== null && errorCounts > 0 && (
              <span className="flex items-center gap-1 text-rose-500" title="Error count">
                <AlertTriangle className="size-3 text-rose-500" />
                {errorCounts} err
              </span>
            )}
          </div>
        )}
      </div>

      {/* Grade Design Modal */}
      <GradeDesignModal
        open={modalOpen}
        moduleType={moduleType}
        jobId={jobId}
        projectId={projectId}
        initialRating={currentRating}
        initialComment={currentComment}
        score={score}
        success={success}
        isReadOnly={readOnly}
        onClose={() => setModalOpen(false)}
        onSubmitted={handleSubmitted}
      />
    </>
  )
}
