import { useCallback, useEffect, useState } from 'react'
import { muloApi } from '../api/endpoints'
import type { MuloDesignerStateResponse } from '../api/types'
import { MuloOptimizationDashboard } from './MuloOptimizationDashboard'
import { StatusMessage } from './StatusMessage'
import {
  buildMuloRunConfig,
  type MuloRunConfig,
} from '../lib/muloDesignConfig'
import { btnPrimary, btnWide } from '../lib/classes'

interface MuloLiveRunPanelProps {
  jobId: string
  /** Called when the job stream ends or continue-loop is needed / finished. */
  onTerminal?: () => void
  /** True while a cascade loop finished but more loops remain. */
  onAwaitingContinueChange?: (awaiting: boolean) => void
  /** Parent-owned survey prompt; must outlive this panel unmounting on completion. */
  onDesignSuccess?: () => void | Promise<void>
}

function runConfigFromState(state: MuloDesignerStateResponse | null): MuloRunConfig {
  const raw = state?.run_config
  if (raw && typeof raw === 'object') {
    return buildMuloRunConfig({
      control_objective: String(raw.control_objective ?? ''),
      ...(raw as Partial<MuloRunConfig>),
    })
  }
  return buildMuloRunConfig({ control_objective: '' })
}

export function MuloLiveRunPanel({
  jobId,
  onTerminal,
  onAwaitingContinueChange,
  onDesignSuccess,
}: MuloLiveRunPanelProps) {
  const [designerState, setDesignerState] = useState<MuloDesignerStateResponse | null>(null)
  const [runKey, setRunKey] = useState(0)
  const [phase, setPhase] = useState<'running' | 'complete'>('running')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void muloApi
      .state(jobId)
      .then((state) => {
        if (!active) return
        setDesignerState(state)
        const done = Boolean(state.controller_designed || state.is_complete)
        setPhase(done ? 'complete' : 'running')
        onAwaitingContinueChange?.(done && !state.is_complete)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load designer state')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [jobId, runKey, onAwaitingContinueChange])

  const handleComplete = useCallback(
    (state: MuloDesignerStateResponse) => {
      setDesignerState(state)
      setPhase('complete')
      onAwaitingContinueChange?.(Boolean(!state.is_complete))
      void onDesignSuccess?.()
      onTerminal?.()
    },
    [onDesignSuccess, onTerminal, onAwaitingContinueChange],
  )

  const continueNextLoop = async () => {
    setLoading(true)
    setError(null)
    try {
      const latest = await muloApi.state(jobId)
      await muloApi.continue(jobId, {
        equation: latest.modified_code,
        controller_structure: latest.modified_controller_structure,
      })
      const state = await muloApi.state(jobId)
      setDesignerState(state)
      setPhase('running')
      setRunKey((prev) => prev + 1)
      onTerminal?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue to next loop')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !designerState) {
    return <p className="text-muted-text">Loading live optimization…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <StatusMessage type="error" message={error} />}

      {(phase === 'running' || phase === 'complete') && (
        <MuloOptimizationDashboard
          key={`${jobId}-${runKey}`}
          jobId={jobId}
          runConfig={runConfigFromState(designerState)}
          designerState={designerState}
          onComplete={handleComplete}
          onTerminal={onTerminal}
        />
      )}

      {phase === 'complete' && designerState && !designerState.is_complete && (
        <button
          type="button"
          className={`${btnPrimary} ${btnWide}`}
          disabled={loading}
          onClick={() => void continueNextLoop()}
        >
          Continue Controller Design (Loop {designerState.controller_index + 1})
        </button>
      )}

      {phase === 'complete' && designerState?.is_complete && (
        <StatusMessage
          type="success"
          message="All cascade loops have been designed. Review final results below or in the Final Result tab."
        />
      )}
    </div>
  )
}
