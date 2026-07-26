import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DesignerComingSoonModal } from '../components/DesignerComingSoonModal'
import {
  MuloPipelineStepIndicator,
  type MuloPipelineStep,
} from '../components/MuloPipelineStepIndicator'
import { MuloRecommenderStep } from '../components/MuloRecommenderStep'
import { MuloTrimmerStep } from '../components/MuloTrimmerStep'
import { StatusMessage } from '../components/StatusMessage'
import { usePipeline } from '../context/PipelineContext'
import { useFeedbackSurveyPrompt } from '../hooks/useFeedbackSurveyPrompt'
import { btnBase, cardPanel, pageIntro, pageSection } from '../lib/classes'

function resolveInitialPipelineStep(
  stepParam: string | null,
  hasRecommender: boolean,
  hasHandoff: boolean,
  hasTrimmer: boolean,
): MuloPipelineStep {
  if (stepParam === 'designer') {
    return hasTrimmer || (hasRecommender && hasHandoff) ? 'trimmer' : 'recommender'
  }
  if (stepParam === 'recommender' || stepParam === 'trimmer') {
    return stepParam
  }
  if (hasTrimmer || (hasRecommender && hasHandoff)) {
    return 'trimmer'
  }
  if (hasRecommender || hasHandoff) {
    return 'trimmer'
  }
  return 'recommender'
}

export function MuloPage() {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const [searchParams, setSearchParams] = useSearchParams()
  const { promptAfterDesignSuccess, feedbackModal } = useFeedbackSurveyPrompt()
  const [comingSoonOpen, setComingSoonOpen] = useState(false)

  const stepParam = searchParams.get('step')

  const isPipelineWorkflow =
    pipeline.pipeline === 'muloDesign' ||
    Boolean(pipeline.fileContent && (pipeline.recommenderJobId || pipeline.handoff)) ||
    stepParam === 'recommender' ||
    stepParam === 'trimmer' ||
    stepParam === 'designer'

  const [pipelineStep, setPipelineStep] = useState<MuloPipelineStep>(() =>
    resolveInitialPipelineStep(
      stepParam,
      Boolean(pipeline.recommenderJobId),
      Boolean(pipeline.handoff),
      Boolean(pipeline.trimmerJobId),
    ),
  )

  useEffect(() => {
    if (stepParam === 'designer') {
      const fallback = resolveInitialPipelineStep(
        'designer',
        Boolean(pipeline.recommenderJobId),
        Boolean(pipeline.handoff),
        Boolean(pipeline.trimmerJobId),
      )
      setPipelineStep(fallback)
      setSearchParams({ step: fallback }, { replace: true })
      return
    }
    if (stepParam === 'recommender' || stepParam === 'trimmer') {
      setPipelineStep(stepParam)
    }
  }, [
    stepParam,
    pipeline.recommenderJobId,
    pipeline.handoff,
    pipeline.trimmerJobId,
    setSearchParams,
  ])

  const completedPipelineSteps = useMemo((): MuloPipelineStep[] => {
    const completed: MuloPipelineStep[] = []
    if (pipeline.handoff || pipeline.recommenderJobId) {
      completed.push('recommender')
    }
    if (pipeline.trimmerJobId) {
      completed.push('trimmer')
    }
    return completed
  }, [pipeline.handoff, pipeline.recommenderJobId, pipeline.trimmerJobId])

  const goToPipelineStep = useCallback(
    (step: MuloPipelineStep) => {
      if (step === 'designer') return
      setPipelineStep(step)
      setSearchParams({ step }, { replace: true })
    },
    [setSearchParams],
  )

  const goBackFromPipelineStep = useCallback(() => {
    if (pipelineStep === 'trimmer') {
      goToPipelineStep('recommender')
      return
    }
    navigate('/studio')
  }, [pipelineStep, goToPipelineStep, navigate])

  const backLabel = pipelineStep === 'trimmer' ? 'Back to Recommender' : 'Back to Studio'

  const handleRecommenderComplete = () => {
    goToPipelineStep('trimmer')
  }

  const handleTrimmerComplete = () => {
    setComingSoonOpen(true)
  }

  const handleComingSoonDismiss = () => {
    setComingSoonOpen(false)
    void promptAfterDesignSuccess()
  }

  return (
    <section className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mt-0 text-xl text-foreground sm:text-2xl">Multi Loop Control Designer</h2>
          <p className={pageIntro}>
            Run Recommender and Trimmer in one workflow. Multi-loop Designer is coming soon.
          </p>
        </div>
        <button type="button" className={`${btnBase} max-sm:w-full`} onClick={goBackFromPipelineStep}>
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel}
        </button>
      </div>

      {isPipelineWorkflow && (
        <MuloPipelineStepIndicator
          step={pipelineStep}
          completedSteps={completedPipelineSteps}
          onStepClick={(step) => {
            if (step === 'designer') return
            const order: MuloPipelineStep[] = ['recommender', 'trimmer']
            const targetIndex = order.indexOf(step)
            const currentIndex = order.indexOf(pipelineStep)
            if (
              step === 'recommender' ||
              completedPipelineSteps.includes(step) ||
              targetIndex <= currentIndex
            ) {
              goToPipelineStep(step)
            }
          }}
        />
      )}

      {pipelineStep === 'recommender' && (
        <MuloRecommenderStep onComplete={handleRecommenderComplete} />
      )}

      {pipelineStep === 'trimmer' && <MuloTrimmerStep onComplete={handleTrimmerComplete} />}

      {pipelineStep !== 'recommender' && pipelineStep !== 'trimmer' && (
        <div className={`${cardPanel} setup-animate-in flex flex-col items-center gap-3 py-10 text-center`}>
          <Sparkles className="size-10 text-primary" aria-hidden />
          <StatusMessage type="info" message="Designer is coming soon. Complete Trimmer to finish the pipeline." />
        </div>
      )}

      <DesignerComingSoonModal open={comingSoonOpen} onDismiss={handleComingSoonDismiss} />
      {feedbackModal}
    </section>
  )
}
