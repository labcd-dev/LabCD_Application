import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Coins } from 'lucide-react'
import { creditsApi } from '../api/endpoints'
import type { CreditDashboard } from '../api/types'
import { formatCredits } from '../lib/formatCredits'
import { formatDateTime, formatTimeUntil } from '../lib/formatDateTime'

export function CreditBalanceChip() {
  const [credits, setCredits] = useState<CreditDashboard | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void creditsApi
        .getDashboard()
        .then((data) => {
          if (!cancelled) setCredits(data)
        })
        .catch(() => {
          /* keep last known balance; chip is informational */
        })
    }
    load()
    const id = window.setInterval(load, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  if (!credits) return null

  const resetLabel = formatTimeUntil(credits.daily_reset_at)
  const resetExact = formatDateTime(credits.daily_reset_at)
  const usedUp = Boolean(credits.used_up)
  const title = usedUp
    ? credits.used_up_message || 'Credits used up'
    : `Daily credits reset ${resetExact}`

  return (
    <Link
      to="/profile?section=credits"
      className={`flex max-w-[14rem] items-center gap-1.5 rounded-lg border px-2 py-1 no-underline transition-colors ${
        usedUp
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200'
          : 'border-border bg-surface text-muted-text hover:bg-surface-hover hover:text-foreground'
      }`}
      title={title}
      aria-label={title}
    >
      <Coins className={`size-3.5 shrink-0 ${usedUp ? 'text-amber-500' : ''}`} aria-hidden />
      <span className="min-w-0 truncate text-[11.5px] leading-tight">
        <span className="font-semibold text-foreground">{formatCredits(credits.spendable)}</span>
        <span className="text-muted"> cr</span>
        {usedUp ? (
          <span className="font-medium"> · used up · resets {resetLabel}</span>
        ) : (
          <span> · resets {resetLabel}</span>
        )}
      </span>
    </Link>
  )
}
