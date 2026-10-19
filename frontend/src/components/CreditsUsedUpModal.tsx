import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Coins, Hourglass, X } from 'lucide-react'
import { btnBase, btnPrimary } from '../lib/classes'
import { formatDateTime, formatTimeUntil } from '../lib/formatDateTime'

interface CreditsUsedUpModalProps {
  open: boolean
  message?: string | null
  resetAt?: string | null
  onClose: () => void
}

export function CreditsUsedUpModal({
  open,
  message,
  resetAt,
  onClose,
}: CreditsUsedUpModalProps) {
  const [nowTick, setNowTick] = useState(0)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !resetAt) return
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000)
    return () => window.clearInterval(id)
  }, [open, resetAt])

  if (!open) return null

  void nowTick
  const resetRelative = formatTimeUntil(resetAt)
  const resetExact = formatDateTime(resetAt)
  const detail =
    message?.trim() ||
    'Your spendable credits are exhausted. Daily credits refill at the next UTC midnight.'

  return (
    <div className="fixed inset-0 z-[460] flex items-center justify-center p-4">
      <button
        type="button"
        className="credits-used-up-backdrop absolute inset-0 border-none bg-[rgba(6,8,11,0.72)] backdrop-blur-[4px]"
        aria-label="Dismiss credits used up"
        onClick={onClose}
      />
      <div
        className="credits-used-up-modal relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-amber-500/35 bg-surface-elevated p-6 text-center shadow-[0_28px_80px_rgba(0,0,0,0.55)] sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="credits-used-up-title"
        aria-describedby="credits-used-up-desc"
      >
        <div className="credits-used-up-modal__glow" aria-hidden />
        <button
          type="button"
          className="absolute right-3 top-3 border-none bg-transparent p-1.5 text-muted hover:text-foreground cursor-pointer transition-colors"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>

        <div className="credits-used-up-modal__icon-wrap mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl border border-amber-500/35 bg-amber-500/10">
          <Coins className="credits-used-up-modal__icon size-8 text-amber-600 dark:text-amber-400" aria-hidden />
        </div>

        <h2
          id="credits-used-up-title"
          className="m-0 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
        >
          Credits used up
        </h2>
        <p
          id="credits-used-up-desc"
          className="mt-3 text-sm leading-relaxed text-muted-text"
        >
          {detail}
        </p>

        {(resetRelative || resetExact) && (
          <div className="credits-used-up-modal__reset mt-5 rounded-xl border border-border bg-surface-muted/80 px-4 py-3.5">
            <div className="flex items-center justify-center gap-2 text-amber-800 dark:text-amber-200">
              <Hourglass className="credits-used-up-modal__hourglass size-4 shrink-0" aria-hidden />
              <span className="text-sm font-semibold">
                {resetRelative ? `Resets ${resetRelative}` : 'Daily reset scheduled'}
              </span>
            </div>
            {resetExact ? (
              <p className="m-0 mt-1.5 text-xs text-muted-text">{resetExact}</p>
            ) : null}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <button
            type="button"
            className={`${btnBase} w-full sm:flex-1`}
            onClick={onClose}
          >
            Got it
          </button>
          <Link
            to="/profile?section=credits"
            className={`${btnPrimary} w-full sm:flex-1 no-underline`}
            onClick={onClose}
          >
            View credits
          </Link>
        </div>
      </div>
    </div>
  )
}
