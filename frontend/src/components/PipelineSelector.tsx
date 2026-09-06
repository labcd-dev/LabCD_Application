import { Activity, Compass, Gauge, Network } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { PipelineType } from '../api/types'

type Pipeline = Exclude<PipelineType, null>

interface PipelineOption {
  id: Pipeline
  title: string
  description: string
  icon: LucideIcon
  action: string
}

const PIPELINES: PipelineOption[] = [
  {
    id: 'siloDesign',
    title: 'Single Loop (PID)',
    description: 'Design one SISO control loop with the Silo Designer pipeline.',
    icon: Gauge,
    action: 'pipeline:silo',
  },
  {
    id: 'muloDesign',
    title: 'Multi Loop (PID)',
    description: 'Coordinate multiple loops via Recommender, Trimmer, and MULO.',
    icon: Network,
    action: 'pipeline:mulo',
  },
  {
    id: 'adaptiveDesign',
    title: 'Adaptive Nonlinear',
    description: 'Sliding mode & backstepping control with neural uncertainty estimation.',
    icon: Activity,
    action: 'pipeline:adaptive',
  },
  {
    id: 'mpcDesign',
    title: 'Agentic MPC',
    description: 'Receding-horizon control with multi-agent auto-tuning (Actor–Critic–Juror).',
    icon: Compass,
    action: 'pipeline:mpc',
  },
]

interface PipelineSelectorProps {
  value: Pipeline | null
  onChange: (pipeline: Pipeline) => void
}

export function PipelineSelector({ value, onChange }: PipelineSelectorProps) {
  const { hasAction } = useAuth()
  const available = PIPELINES.filter((option) => hasAction(option.action))

  if (available.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface-muted px-3 py-3 text-sm text-muted-text">
        No pipeline actions are assigned to your account. Ask an admin to grant Single Loop and/or
        Multi Loop access.
      </p>
    )
  }

  return (
    <fieldset className="pipeline-selector">
      <legend className="pipeline-selector__legend">Design pipeline</legend>
      <div className="pipeline-selector__grid">
        {available.map((option) => {
          const Icon = option.icon
          const isSelected = value === option.id

          return (
            <button
              key={option.id}
              type="button"
              className={[
                'pipeline-card',
                isSelected && 'pipeline-card--selected',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onChange(option.id)}
              aria-pressed={isSelected}
            >
              <span className="pipeline-card__icon-wrap" aria-hidden>
                <Icon className="pipeline-card__icon" />
              </span>
              <span className="pipeline-card__content">
                <span className="pipeline-card__title">{option.title}</span>
                <span className="pipeline-card__description">{option.description}</span>
              </span>
              <span className="pipeline-card__check" aria-hidden>
                <span className="pipeline-card__check-dot" />
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
