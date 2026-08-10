import {
  ArrowRight,
  Check,
  ClipboardList,
  FlaskConical,
  RefreshCw,
  Scale,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface FlowStep {
  id: string
  title: string
  description: string
  icon: LucideIcon
  tone: 'input' | 'design' | 'test' | 'check'
}

const STEPS: FlowStep[] = [
  {
    id: 'input',
    title: 'You provide the system',
    description: 'System model, controller type, and design requirements.',
    icon: ClipboardList,
    tone: 'input',
  },
  {
    id: 'design',
    title: 'AI designs',
    description: 'The Actor selects controller parameters such as Kp and Ki.',
    icon: Sparkles,
    tone: 'design',
  },
  {
    id: 'test',
    title: 'Controller is tested',
    description: 'LabCD evaluates the controller on the closed-loop system.',
    icon: FlaskConical,
    tone: 'test',
  },
  {
    id: 'check',
    title: 'AI evaluates',
    description: 'The Critic checks stability and performance.',
    icon: Scale,
    tone: 'check',
  },
]

export function SiloDesignFlow() {
  return (
    <section className="labcd-flow" aria-labelledby="labcd-flow-title">
      <header className="labcd-flow__header">
        <h2 id="labcd-flow-title" className="labcd-flow__title">
          How LabCD Designs Your Controller
        </h2>
        <p className="labcd-flow__subtitle">
          AI designs, tests, and improves the controller automatically.
        </p>
      </header>

      <ol className="labcd-flow__steps">
        {STEPS.map((step, index) => {
          const Icon = step.icon
          return (
            <li
              key={step.id}
              className={`labcd-step labcd-step--${step.tone}`}
              style={{ animationDelay: `${0.08 * index}s` }}
            >
              {index > 0 && (
                <span className="labcd-flow__arrow" aria-hidden>
                  <ArrowRight className="labcd-flow__arrow-icon" />
                </span>
              )}
              <article className="labcd-step__card">
                <div className="labcd-step__icon" aria-hidden>
                  <Icon className="labcd-step__icon-svg" />
                </div>
                <p className="labcd-step__index">Step {index + 1}</p>
                <h3 className="labcd-step__title">{step.title}</h3>
                <p className="labcd-step__description">{step.description}</p>
              </article>
            </li>
          )
        })}
      </ol>

      <div className="labcd-flow__result" role="group" aria-label="Design outcomes">
        <span className="labcd-flow__result-label">If successful</span>
        <span className="labcd-result labcd-result--success">
          <Check className="labcd-result__icon" aria-hidden />
          Final Controller
        </span>
        <span className="labcd-flow__result-or">or</span>
        <span className="labcd-result labcd-result--retry">
          <RefreshCw className="labcd-result__icon" aria-hidden />
          Refine & Test Again
        </span>
      </div>
    </section>
  )
}
