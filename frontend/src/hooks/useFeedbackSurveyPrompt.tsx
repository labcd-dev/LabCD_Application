import { useCallback, useRef, useState } from 'react'
import type { FeedbackPipelineType } from '../api/types'
import { surveyApi } from '../api/endpoints'
import { FeedbackSurveyModal } from '../components/FeedbackSurveyModal'
import { useAuth } from '../context/AuthContext'

/**
 * After a successful SILO or MULO design run, prompt for that pipeline's
 * feedback form if the survey module is enabled.
 *
 * Own this hook above the live run panels: those unmount when the project
 * becomes completed, which would otherwise discard the modal before it opens.
 */
export function useFeedbackSurveyPrompt() {
  const { user, refreshUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [pipelineType, setPipelineType] = useState<FeedbackPipelineType>('siloDesign')
  const inFlightRef = useRef(false)

  const promptAfterDesignSuccess = useCallback(
    async (pipeline: FeedbackPipelineType) => {
      if (!user) return
      if (open || inFlightRef.current) return
      inFlightRef.current = true
      try {
        const status = await surveyApi.status()
        if (!status.enabled) return
        setPipelineType(pipeline)
        setOpen(true)
      } catch {
        // Ignore status failures; do not block the design UX.
      } finally {
        inFlightRef.current = false
      }
    },
    [user, open],
  )

  const modal = (
    <FeedbackSurveyModal
      open={open}
      pipelineType={pipelineType}
      onDismiss={() => setOpen(false)}
      onSubmitted={async () => {
        setOpen(false)
        await refreshUser()
      }}
    />
  )

  return { promptAfterDesignSuccess, feedbackModal: modal }
}
