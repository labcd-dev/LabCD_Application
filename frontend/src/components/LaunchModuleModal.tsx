import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { btnBase, btnPrimary } from '../lib/classes'

export type LaunchPipeline = 'siloDesign' | 'muloDesign' | 'adaptiveDesign' | 'mpcDesign'

interface ModuleOption {
  id: LaunchPipeline
  name: string
  description: string
  action: string
}

const MODULES: ModuleOption[] = [
  {
    id: 'siloDesign',
    name: 'Single Loop',
    description: 'Design one control loop with the Silo Designer pipeline.',
    action: 'pipeline:silo',
  },
  {
    id: 'muloDesign',
    name: 'Multi Loop',
    description: 'Cascaded loops via Recommender, Trimmer, and MULO.',
    action: 'pipeline:mulo',
  },
  {
    id: 'adaptiveDesign',
    name: 'Adaptive Nonlinear',
    description: 'Sliding mode & backstepping control with neural uncertainty estimation.',
    action: 'pipeline:adaptive',
  },
  {
    id: 'mpcDesign',
    name: 'Agentic MPC',
    description: 'Receding-horizon control with multi-agent auto-tuning (Actor–Critic–Juror).',
    action: 'pipeline:mpc',
  },
]

interface LaunchModuleModalProps {
  open: boolean
  title: string
  subtitle?: string
  launching?: boolean
  onClose: () => void
  onLaunch: (pipeline: LaunchPipeline) => void
}

export function LaunchModuleModal({
  open,
  title,
  subtitle,
  launching = false,
  onClose,
  onLaunch,
}: LaunchModuleModalProps) {
  const { hasAction } = useAuth()
  const available = MODULES.filter((option) => hasAction(option.action))
  const [selected, setSelected] = useState<LaunchPipeline | null>(null)
  const defaultId = available[0]?.id ?? null

  useEffect(() => {
    if (!open) return
    setSelected(defaultId)
  }, [open, defaultId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !launching) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, launching, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-[rgba(6,8,11,0.72)] p-5 backdrop-blur-[3px]"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !launching) onClose()
      }}
    >
      <div
        className="max-h-[calc(100vh-60px)] w-[440px] max-w-full overflow-y-auto rounded-[18px] border border-border bg-surface-elevated p-[22px] shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-module-title"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id="launch-module-title" className="m-0 text-[17px] font-bold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            className="border-none bg-transparent p-1 text-base text-muted hover:text-foreground"
            aria-label="Close"
            disabled={launching}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {subtitle ? (
          <p className="mb-[18px] text-[12.5px] text-muted">{subtitle}</p>
        ) : (
          <p className="mb-[18px] text-[12.5px] text-muted">
            Choose a design module, then launch Studio.
          </p>
        )}

        <div className="mb-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
            Module
          </div>
          {available.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-muted px-3 py-3 text-sm text-muted-text">
              No pipeline actions are assigned to your account. Ask an admin to grant Single Loop
              and/or Multi Loop access.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {available.map((option) => {
                const isSelected = selected === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`flex items-center gap-2.5 rounded-[9px] border px-3 py-2.5 text-left transition-all duration-125 ${
                      isSelected
                        ? 'border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)]'
                        : 'border-border bg-surface-muted hover:border-[color-mix(in_srgb,var(--app-foreground)_14%,transparent)]'
                    }`}
                    aria-pressed={isSelected}
                    disabled={launching}
                    onClick={() => setSelected(option.id)}
                  >
                    <span
                      className={`relative size-[15px] shrink-0 rounded-full border-[1.5px] ${
                        isSelected ? 'border-primary' : 'border-muted'
                      }`}
                      aria-hidden
                    >
                      {isSelected && (
                        <span className="absolute inset-[2.5px] rounded-full bg-primary" />
                      )}
                    </span>
                    <span>
                      <span className="block text-[13px] font-semibold text-foreground">
                        {option.name}
                      </span>
                      <span className="block text-[11.5px] text-muted">{option.description}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          className={`${btnPrimary} mt-1.5 w-full justify-center px-3 py-[11px] text-[13.5px]`}
          disabled={!selected || launching || available.length === 0}
          onClick={() => {
            if (selected) onLaunch(selected)
          }}
        >
          {launching ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Launching…
            </>
          ) : (
            'Launch studio →'
          )}
        </button>
        <button
          type="button"
          className={`${btnBase} mt-2 w-full justify-center`}
          disabled={launching}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
