import { useEffect, useMemo, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { FeedbackPipelineType, SurveyStatus } from '../api/types'
import { surveyApi } from '../api/endpoints'
import { useAuth } from '../context/AuthContext'
import { FeedbackSurveyModal } from './FeedbackSurveyModal'

const ALL_PIPELINES: FeedbackPipelineType[] = ['siloDesign', 'muloDesign']

function incompletePipelines(status: SurveyStatus | null, userFlags: {
  silo?: boolean
  mulo?: boolean
}): FeedbackPipelineType[] {
  return ALL_PIPELINES.filter((pipeline) => {
    if (pipeline === 'siloDesign') {
      return !(status?.feedback_completed_silo ?? userFlags.silo)
    }
    return !(status?.feedback_completed_mulo ?? userFlags.mulo)
  })
}

interface FeedbackSurveyFabProps {
  className?: string
}

export function FeedbackSurveyFab({ className }: FeedbackSurveyFabProps) {
  const { user, refreshUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<SurveyStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void surveyApi
      .status()
      .then((next) => {
        if (cancelled) return
        setEnabled(next.enabled)
        setStatus(next)
      })
      .catch(() => {
        if (cancelled) return
        setEnabled(false)
        setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [user?.feedback_survey_completed_silo, user?.feedback_survey_completed_mulo])

  const availablePipelines = useMemo(
    () =>
      incompletePipelines(status, {
        silo: user?.feedback_survey_completed_silo,
        mulo: user?.feedback_survey_completed_mulo,
      }),
    [status, user?.feedback_survey_completed_silo, user?.feedback_survey_completed_mulo],
  )

  if (!enabled || availablePipelines.length === 0) return null

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
        pipelineType={availablePipelines[0]}
        availablePipelines={availablePipelines}
        voluntary
        onDismiss={() => setOpen(false)}
        onSubmitted={async () => {
          setOpen(false)
          await refreshUser()
          try {
            const next = await surveyApi.status()
            setStatus(next)
          } catch {
            // Keep prior status if refresh fails.
          }
        }}
      />
    </>
  )
}
