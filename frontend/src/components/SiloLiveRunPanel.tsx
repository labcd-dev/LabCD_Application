import { useCallback, useEffect, useRef, useState } from 'react'
import { OctagonX } from 'lucide-react'
import { jobsApi, siloApi } from '../api/endpoints'
import { ActivityLog } from './ActivityLog'
import { DesignIterationReport } from './DesignIterationReport'
import { ComputationalProfilingPanel } from './ComputationalProfilingPanel'
import { DesignMonitorDashboard } from './DesignMonitorDashboard'
import { ProcessingCard } from './ProcessingCard'
import { ProgressBar } from './ProgressBar'
import { StatusMessage } from './StatusMessage'
import { Tabs } from './Tabs'
import { useFeedbackSurveyPrompt } from '../hooks/useFeedbackSurveyPrompt'
import { useJobStream } from '../hooks/useJobStream'
import { useMonitorState } from '../hooks/useMonitorState'
import { usePoll } from '../hooks/usePoll'
import { btnBase, mutedText } from '../lib/classes'

interface SiloLiveRunPanelProps {
  jobId: string
  onTerminal?: () => void
}

export function SiloLiveRunPanel({ jobId, onTerminal }: SiloLiveRunPanelProps) {
  const [activeTab, setActiveTab] = useState('state')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const stream = useJobStream({ module: 'silo', jobId, enabled: true })
  const { promptAfterDesignSuccess, feedbackModal } = useFeedbackSurveyPrompt()
  const promptedJobRef = useRef<string | null>(null)
  const notifiedTerminalRef = useRef<string | null>(null)

  const fetchMonitor = useCallback(async () => siloApi.monitor(jobId), [jobId])
  const poll = usePoll(fetchMonitor, 3000, true)

  useEffect(() => {
    if (!cancelling) return
    if (stream.isCancelled || (!stream.isRunning && stream.isDone)) {
      setCancelling(false)
    }
  }, [cancelling, stream.isCancelled, stream.isDone, stream.isRunning])

  useEffect(() => {
    if (!stream.isDone || stream.error || stream.isCancelled) return
    if (promptedJobRef.current === jobId) return
    promptedJobRef.current = jobId
    void promptAfterDesignSuccess()
  }, [stream.isDone, stream.error, stream.isCancelled, jobId, promptAfterDesignSuccess])

  useEffect(() => {
    const terminal = stream.isDone || stream.isCancelled || Boolean(stream.error)
    if (!terminal || notifiedTerminalRef.current === jobId) return
    notifiedTerminalRef.current = jobId
    onTerminal?.()
  }, [stream.isDone, stream.isCancelled, stream.error, jobId, onTerminal])

  const cancelDesign = async () => {
    if (cancelling) return
    setCancelling(true)
    setCancelError(null)
    try {
      await jobsApi.cancel(jobId)
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Failed to cancel design')
      setCancelling(false)
    }
  }

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
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
          {stream.isCancelled && (
            <StatusMessage
              type="warning"
              message="Control design was cancelled. Partial results may still be available below."
            />
          )}
          {stream.error && <StatusMessage type="error" message={stream.error} />}
          {cancelError && <StatusMessage type="error" message={cancelError} />}
          {monitorState ? (
            <DesignMonitorDashboard stateHistory={stateHistory} currentState={currentState} />
          ) : (
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
      content: (
        <ComputationalProfilingPanel scenarioMetricsHistory={scenarioMetricsHistory} />
      ),
    },
    {
      id: 'logs',
      label: 'Activity Log',
      content: <ActivityLog logs={stream.logs} />,
    },
  ]

  return (
    <>
      {feedbackModal}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
    </>
  )
}
