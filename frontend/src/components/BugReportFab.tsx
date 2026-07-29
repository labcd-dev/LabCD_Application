import { useEffect, useState } from 'react'
import { Bug } from 'lucide-react'
import { bugReportsApi } from '../api/endpoints'
import { BugReportModal } from './BugReportModal'

interface BugReportFabProps {
  className?: string
}

export function BugReportFab({ className }: BugReportFabProps) {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void bugReportsApi
      .status()
      .then((settings) => {
        if (!cancelled) setEnabled(settings.enabled)
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!enabled) return null

  return (
    <>
      <button
        type="button"
        className={
          className ??
          'flex size-11 items-center justify-center rounded-full border border-border bg-surface-elevated text-foreground shadow-lg transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:size-12'
        }
        aria-label="Report a bug"
        title="Report a bug"
        onClick={() => setOpen(true)}
      >
        <Bug className="size-5" aria-hidden />
      </button>
      <BugReportModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
