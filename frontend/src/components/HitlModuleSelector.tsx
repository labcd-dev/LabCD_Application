import { useState } from 'react'
import { ArrowRight, Cpu, Network, Settings2, Sliders, Sparkles, UserCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { LaunchPipeline } from './LaunchModuleModal'
import type { PipelineRouting, PlantModelResult } from '../api/types'
import { moduleAllowedByRouting } from './pipeline/pipelineState'

export interface ModuleOption {
  id: LaunchPipeline
  name: string
  description: string
  action: string
  tag: string
  icon: typeof Cpu
}

export const MODULES: ModuleOption[] = [
  {
    id: 'siloDesign',
    name: 'Single Loop',
    description: 'Design one control loop with the Silo Designer pipeline.',
    action: 'pipeline:silo',
    tag: 'SISO',
    icon: Sliders,
  },
  {
    id: 'muloDesign',
    name: 'Multi Loop',
    description: 'Cascaded loops via Recommender, Trimmer, and MULO.',
    action: 'pipeline:mulo',
    tag: 'CASCADE',
    icon: Network,
  },
  {
    id: 'adaptiveDesign',
    name: 'Adaptive Nonlinear',
    description: 'Sliding mode & backstepping control with neural uncertainty estimation.',
    action: 'pipeline:adaptive',
    tag: 'NONLINEAR',
    icon: Sparkles,
  },
  {
    id: 'mpcDesign',
    name: 'Agentic MPC',
    description: 'Receding-horizon control with multi-agent auto-tuning (Actor–Critic–Juror).',
    action: 'pipeline:mpc',
    tag: 'OPTIMAL',
    icon: Cpu,
  },
]

export interface HitlModuleSelectorProps {
  systemName?: string
  plantResult: PlantModelResult
  conversationId?: number | null
  onLaunch: (pipeline: LaunchPipeline) => void | Promise<void>
  onOpenSettings?: (pipeline: LaunchPipeline) => void
  onCancel?: () => void
  launching?: boolean
  /** Stage 7 routing. Modules it marks false are hidden; missing or null modules stay. */
  routing?: PipelineRouting | null
}

export function HitlModuleSelector({
  systemName,
  plantResult,
  onLaunch,
  onOpenSettings,
  onCancel,
  launching = false,
  routing = null,
}: HitlModuleSelectorProps) {
  const { hasAction } = useAuth()
  const available = MODULES.filter((option) => hasAction(option.action) && moduleAllowedByRouting(option.id, routing))
  const [selected, setSelected] = useState<LaunchPipeline>(available[0]?.id ?? 'siloDesign')

  const title = systemName || plantResult.system_name || 'Plant Dynamics'

  return (
    <div className="ap-hitl" role="region" aria-label="Human in the loop control module selection">
      <div className="ap-hitl-header">
        <div className="ap-hitl-header-left">
          <div className="ap-hitl-badge">
            <span className="ap-hitl-pulse" aria-hidden />
            <UserCheck className="size-3 text-indigo-400" aria-hidden />
            <span>Human-in-the-Loop</span>
          </div>
          <h4 className="ap-hitl-title">Select Control Architecture</h4>
          <p className="ap-hitl-desc">
            Review the synthesized plant for <span className="font-semibold text-[var(--ap-text)]">{title}</span> and choose your control strategy:
          </p>
        </div>
      </div>

      <div className="ap-hitl-options">
        {available.length === 0 ? (
          <p className="ap-hitl-no-perms">
            No pipeline permissions assigned. Please ask an administrator to grant access to control modules.
          </p>
        ) : (
          available.map((option) => {
            const isSelected = selected === option.id
            const Icon = option.icon
            return (
              <button
                key={option.id}
                type="button"
                className={`ap-hitl-option ${isSelected ? 'ap-hitl-option--selected' : ''}`}
                aria-pressed={isSelected}
                disabled={launching}
                onClick={() => setSelected(option.id)}
              >
                <div className="ap-hitl-radio" aria-hidden>
                  {isSelected && <span className="ap-hitl-radio-dot" />}
                </div>

                <div className="ap-hitl-option-icon" aria-hidden>
                  <Icon className="size-4" />
                </div>

                <div className="ap-hitl-option-text">
                  <div className="ap-hitl-option-row">
                    <span className="ap-hitl-option-name">{option.name}</span>
                    <span className="ap-hitl-option-tag">{option.tag}</span>
                  </div>
                  <span className="ap-hitl-option-desc">{option.description}</span>
                </div>
              </button>
            )
          })
        )}
      </div>

      <div className="ap-hitl-footer">
        <div className="ap-hitl-footer-primary">
          <button
            type="button"
            className="ap-complete-btn ap-hitl-launch-btn"
            disabled={!selected || launching || available.length === 0}
            onClick={() => {
              if (selected) void onLaunch(selected)
            }}
          >
            {launching ? (
              <>
                <span className="ap-trace-spinner" aria-hidden />
                <span>Launching {selected ? MODULES.find((m) => m.id === selected)?.name : 'Controller'}…</span>
              </>
            ) : (
              <>
                <span>Launch Controller</span>
                <ArrowRight className="size-4" aria-hidden />
              </>
            )}
          </button>

          {onOpenSettings && (
            <button
              type="button"
              className="ap-hitl-settings-btn"
              disabled={launching}
              title="Configure simulation horizon, sample time, and initial conditions"
              onClick={() => onOpenSettings(selected)}
            >
              <Settings2 className="size-3.5" aria-hidden />
              <span>Simulation Settings</span>
            </button>
          )}
        </div>

        {onCancel && (
          <button
            type="button"
            className="ap-hitl-cancel-btn"
            disabled={launching}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
