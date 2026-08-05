import { useEffect, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { FeedbackPipelineType } from '../api/types'
import { surveyApi } from '../api/endpoints'
import { useAuth } from '../context/AuthContext'
import { FeedbackSurveyModal } from './FeedbackSurveyModal'

const ALL_PIPELINES: FeedbackPipelineType[] = ['siloDesign', 'muloDesign']

interface FeedbackSurveyFabProps {
  className?: string
}

export function FeedbackSurveyFab({ className }: FeedbackSurveyFabProps) {
  const { refreshUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void surveyApi
      .status()
      .then((next) => {
        if (cancelled) return
        setEnabled(next.enabled)
      })
      .catch(() => {
        if (cancelled) return
        setEnabled(false)
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
        aria-label="Send feedback"
        title="Send feedback"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlus className="size-5" aria-hidden />
      </button>
      <FeedbackSurveyModal
        open={open}
        pipelineType={ALL_PIPELINES[0]}
        availablePipelines={ALL_PIPELINES}
        voluntary
        onDismiss={() => setOpen(false)}
        onSubmitted={async () => {
          setOpen(false)
          await refreshUser()
        }}
      />
    </>
  )
}
