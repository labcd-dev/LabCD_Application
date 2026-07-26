import { Check, GitBranch, Scissors, Settings2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cardPanel } from '../lib/classes'

export type MuloPipelineStep = 'recommender' | 'trimmer' | 'designer'

interface StepDef {
  id: MuloPipelineStep
  label: string
  description: string
  icon: LucideIcon
}

const STEPS: StepDef[] = [
  { id: 'recommender', label: 'Recommender', description: 'Architecture', icon: GitBranch },
  { id: 'trimmer', label: 'Trimmer', description: 'Equilibrium', icon: Scissors },
  { id: 'designer', label: 'Designer', description: 'Multi-loop GA', icon: Settings2 },
]

function stepToIndex(step: MuloPipelineStep): number {
  return STEPS.findIndex((s) => s.id === step)
}

interface MuloPipelineStepIndicatorProps {
  step: MuloPipelineStep
  onStepClick?: (step: MuloPipelineStep) => void
  completedSteps?: MuloPipelineStep[]
}

export function MuloPipelineStepIndicator({
  step,
  onStepClick,
  completedSteps = [],
}: MuloPipelineStepIndicatorProps) {
  const activeIndex = stepToIndex(step)

  return (
    <div className={`${cardPanel} setup-steps-card setup-animate-in`}>
      <nav className="setup-steps" aria-label="Multi loop design progress">
        <ol className="setup-steps__list setup-steps__list--mulo">
          {STEPS.map((pipelineStep, index) => {
            const Icon = pipelineStep.icon
            const isComplete =
              completedSteps.includes(pipelineStep.id) || index < activeIndex
            const isActive = index === activeIndex
            const isPending = index > activeIndex
            const isClickable = Boolean(onStepClick) && (isComplete || isActive)

            return (
              <li
                key={pipelineStep.id}
                className={[
                  'setup-steps__item',
                  isComplete && 'setup-steps__item--complete',
                  isActive && 'setup-steps__item--active',
                  isPending && 'setup-steps__item--pending',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-current={isActive ? 'step' : undefined}
              >
                {index > 0 && (
                  <span
                    className={[
                      'setup-steps__connector',
                      isComplete && 'setup-steps__connector--complete',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-hidden
                  />
                )}
                {isClickable ? (
                  <button
                    type="button"
                    className="setup-steps__node setup-steps__node--button"
                    onClick={() => onStepClick?.(pipelineStep.id)}
                  >
                    <span className="setup-steps__icon-wrap">
                      {isComplete ? (
                        <Check className="setup-steps__icon" aria-hidden />
                      ) : (
                        <Icon className="setup-steps__icon" aria-hidden />
                      )}
                    </span>
                    <span className="setup-steps__label">{pipelineStep.label}</span>
                    <span className="setup-steps__description">{pipelineStep.description}</span>
                  </button>
                ) : (
                  <div className="setup-steps__node">
                    <span className="setup-steps__icon-wrap">
                      {isComplete ? (
                        <Check className="setup-steps__icon" aria-hidden />
                      ) : (
                        <Icon className="setup-steps__icon" aria-hidden />
                      )}
                    </span>
                    <span className="setup-steps__label">{pipelineStep.label}</span>
                    <span className="setup-steps__description">{pipelineStep.description}</span>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
    </div>
  )
}
