import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, OctagonX, RotateCcw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { healthApi, jobsApi, siloApi } from '../api/endpoints'
import { ActivityLog } from '../components/ActivityLog'
import { DesignIterationReport } from '../components/DesignIterationReport'
import { ComputationalProfilingPanel } from '../components/ComputationalProfilingPanel'
import { DesignMonitorDashboard } from '../components/DesignMonitorDashboard'
import { CodePreview } from '../components/CodePreview'
import { ModelSelect } from '../components/ModelSelect'
import { ProcessingCard } from '../components/ProcessingCard'
import { SiloAdvancedSettings } from '../components/SiloAdvancedSettings'
import { ProgressBar } from '../components/ProgressBar'
import { StatusMessage } from '../components/StatusMessage'
import { Tabs } from '../components/Tabs'
import { usePipeline } from '../context/PipelineContext'
import { useFeedbackSurveyPrompt } from '../hooks/useFeedbackSurveyPrompt'
import { useJobStream } from '../hooks/useJobStream'
import { useMonitorState } from '../hooks/useMonitorState'
import { usePoll } from '../hooks/usePoll'
import {
  btnLink,
  btnPrimary,
  btnBase,
  btnWide,
  fieldInput,
  fieldLabel,
  mutedText,
  pageIntro,
  pageSection,
} from '../lib/classes'
import {
  buildSiloStartConfig,
  DEFAULT_SILO_ADVANCED_CONFIG,
  type SiloAdvancedConfig,
} from '../lib/siloDesignConfig'

export function SiloPage() {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const [models, setModels] = useState<string[]>(['gpt-4o'])
  const [objective, setObjective] = useState('')
  const [activeTab, setActiveTab] = useState('state')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedConfig, setAdvancedConfig] = useState<SiloAdvancedConfig>(
    DEFAULT_SILO_ADVANCED_CONFIG,
  )
  const [cancelling, setCancelling] = useState(false)

  const jobId = pipeline.siloJobId
  const stream = useJobStream({ module: 'silo', jobId, enabled: started })
  const { promptAfterDesignSuccess, feedbackModal } = useFeedbackSurveyPrompt()
  const promptedJobRef = useRef<string | null>(null)

  const fetchMonitor = useCallback(async () => {
    if (!jobId) return null
    return siloApi.monitor(jobId)
  }, [jobId])

  const poll = usePoll(fetchMonitor, 3000, started)

  useEffect(() => {
    healthApi.models().then((res) => setModels(res.llm_models)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!cancelling) return
    if (stream.isCancelled || (!stream.isRunning && stream.isDone)) {
      setCancelling(false)
    }
  }, [cancelling, stream.isCancelled, stream.isDone, stream.isRunning])

  useEffect(() => {
    if (!stream.isDone || stream.error || stream.isCancelled || !jobId) return
    if (promptedJobRef.current === jobId) return
    promptedJobRef.current = jobId
    void promptAfterDesignSuccess()
  }, [stream.isDone, stream.error, stream.isCancelled, jobId, promptAfterDesignSuccess])

  const startDesign = async () => {
    if (!pipeline.fileContent) {
      setError('Upload and process a file on the Home page first.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const config = buildSiloStartConfig(advancedConfig, {
        llm_model: pipeline.model,
        file_content: pipeline.fileContent,
        file_name: pipeline.fileName,
        file_type: pipeline.fileType === 'matlab' ? 'MATLAB/Octave (.m)' : 'Python (.py)',
      })

      const job = await siloApi.start({
        config,
        control_objective: objective,
        project_id: pipeline.projectId,
      })
      pipeline.setSiloJobId(job.job_id)
      setStarted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start silo design')
    } finally {
      setLoading(false)
    }
  }

  const cancelDesign = async () => {
    if (!jobId || cancelling) return
    setCancelling(true)
    setError(null)
    try {
      await jobsApi.cancel(jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel design')
      setCancelling(false)
    }
  }

  const goBackToStudio = () => {
    navigate('/studio')
  }

  const retryDesign = () => {
    pipeline.setSiloJobId(null)
    setStarted(false)
    setActiveTab('state')
    setError(null)
    setCancelling(false)
    promptedJobRef.current = null
  }

  const canRetry =
    started && (stream.isDone || stream.error || stream.isCancelled) && !stream.isRunning

  const isStopping = cancelling && !stream.isCancelled

  const monitorState = useMonitorState(
    poll.data as Record<string, unknown> | null | undefined,
    stream.events,
  )
  const llmResponses = (monitorState?.llm_responses ?? []) as Array<Record<string, unknown>>
  const progressHistory = (monitorState?.progress_history ?? []) as Array<Record<string, unknown>>
  const stateHistory = (monitorState?.state_history ?? []) as Array<Record<string, unknown>>
  const currentState = (monitorState?.current_state ?? null) as Record<string, unknown> | null
  const scenarioMetricsHistory = monitorState?.scenario_metrics_history
  const pollProgress =
    progressHistory.length > 0 ? Math.min(progressHistory.length * 5, 95) / 100 : 0
  const latestProgress = stream.isDone ? 1 : Math.max(pollProgress, stream.progress)
  const latestMessage =
    progressHistory.length > 0
      ? String(progressHistory[progressHistory.length - 1]?.message ?? '')
      : ''
  const progressLabel = stream.isCancelled
    ? 'Design cancelled'
    : isStopping
      ? 'Cancelling design, stopping jobs and simulations...'
      : stream.isDone
        ? 'Design complete'
        : latestMessage || stream.statusText || 'Running single-loop design...'

  const tabs = [
    {
      id: 'state',
      label: 'Monitor State',
      content: (
        <>
          {started && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-4">
                <div className="flex-1 [&>div]:my-0">
                  <ProgressBar value={latestProgress} label={progressLabel} />
                </div>
                {stream.isRunning && !stream.isDone && !isStopping && (
                  <button
                    type="button"
                    className={`${btnBase} shrink-0 border-[color-mix(in_srgb,var(--app-status-error-text)_35%,transparent)] text-[var(--app-status-error-text)] hover:bg-[var(--app-status-error-bg)]`}
                    disabled={cancelling}
                    onClick={() => void cancelDesign()}
                  >
                    Cancel Design
                  </button>
                )}
              </div>
              {isStopping && (
                <ProcessingCard
                  icon={OctagonX}
                  title="Cancelling design..."
                  description="Stopping all jobs, processes, and simulations. Please wait."
                />
              )}
            </>
          )}
          {stream.isCancelled && (
            <StatusMessage type="warning" message="Control design was cancelled. Partial results may still be available below." />
          )}
          {stream.error && <StatusMessage type="error" message={stream.error} />}
          {started && monitorState && (
            <DesignMonitorDashboard
              stateHistory={stateHistory}
              currentState={currentState}
            />
          )}
          {!started && (
            <p className={mutedText}>Start a design to see live monitor data from the API.</p>
          )}
          {started && !monitorState && (
            <p className={mutedText}>Waiting for simulation data...</p>
          )}
        </>
      ),
    },
    {
      id: 'process',
      label: 'Design Process',
      content:
        llmResponses.length > 0 ? (
          <DesignIterationReport responses={llmResponses} />
        ) : (
          <p className={mutedText}>No optimization iterations yet.</p>
        ),
    },
    {
      id: 'summary',
      label: 'Summary',
      content: started ? (
        <ComputationalProfilingPanel scenarioMetricsHistory={scenarioMetricsHistory} />
      ) : (
        <p className={mutedText}>Start a design to see computational profiling.</p>
      ),
    },
    {
      id: 'logs',
      label: 'Activity Log',
      content: <ActivityLog logs={stream.logs} />,
    },
  ]

  return (
    <section className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mt-0 text-foreground">Single Loop Control Designer</h2>
          <p className={pageIntro}>
            Describe your control objective and run the SiloDesigner pipeline via API.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnBase} onClick={goBackToStudio}>
            <ArrowLeft className="size-4" aria-hidden />
            Back to Studio
          </button>
          {canRetry && (
            <button type="button" className={btnBase} onClick={retryDesign}>
              <RotateCcw className="size-4" aria-hidden />
              Retry Design
            </button>
          )}
        </div>
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {feedbackModal}

      {!started && (
        <>
          <label className={fieldLabel}>
            <span>Control Objective</span>
            <textarea
              className={fieldInput}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={4}
              placeholder="Describe what you want the controller to achieve..."
            />
          </label>

          <ModelSelect models={models} value={pipeline.model} onChange={pipeline.setModel} />

          <button type="button" className={btnLink} onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
          </button>

          {showAdvanced && (
            <div className="mt-4">
              <SiloAdvancedSettings value={advancedConfig} onChange={setAdvancedConfig} />
            </div>
          )}

          {pipeline.fileContent && (
            <details>
              <summary>Uploaded Dynamics Preview</summary>
              <CodePreview value={pipeline.fileContent} readOnly height={200} />
            </details>
          )}

          <button
            type="button"
            className={`${btnPrimary} ${btnWide}`}
            disabled={loading || !pipeline.fileContent}
            onClick={() => void startDesign()}
          >
            Start Design
          </button>
        </>
      )}

      {started && <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />}
    </section>
  )
}
