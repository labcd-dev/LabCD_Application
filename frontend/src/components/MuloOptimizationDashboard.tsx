import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OctagonX } from 'lucide-react'
import { jobsApi, muloApi } from '../api/endpoints'
import type { MuloDesignerStateResponse } from '../api/types'
import { JsonViewer } from './JsonViewer'
import { PlotlyChart } from './PlotlyChart'
import { ProgressBar } from './ProgressBar'
import { StatusMessage } from './StatusMessage'
import { Tabs } from './Tabs'
import { MuloPerformancePanel } from './MuloPerformancePanel'
import { MuloStatusBar } from './MuloStatusBar'
import { useJobStream } from '../hooks/useJobStream'
import { usePoll } from '../hooks/usePoll'
import type { MuloPlotData, MuloRunConfig } from '../lib/muloDesignConfig'
import {
  buildCostChart,
  buildGainsCharts,
  buildMetricsCharts,
  buildSummaryCharts,
} from '../lib/muloPlotCharts'
import { btnBase, mutedText } from '../lib/classes'

interface MuloOptimizationDashboardProps {
  jobId: string
  runConfig?: MuloRunConfig | null
  designerState: MuloDesignerStateResponse | null
  onComplete: (state: MuloDesignerStateResponse) => void
  onNewExperiment?: () => void
  onTerminal?: () => void
}

export function MuloOptimizationDashboard({
  jobId,
  runConfig,
  designerState,
  onComplete,
  onNewExperiment,
  onTerminal,
}: MuloOptimizationDashboardProps) {
  const [activeTab, setActiveTab] = useState('performance')
  const [plotData, setPlotData] = useState<MuloPlotData | null>(null)
  const [localState, setLocalState] = useState<MuloDesignerStateResponse | null>(designerState)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notifiedTerminalRef = useRef<string | null>(null)

  const stream = useJobStream({ module: 'mulo', jobId, enabled: true })

  const fetchPlotData = useCallback(async () => {
    const data = await muloApi.plotData(jobId)
    return data as unknown as MuloPlotData
  }, [jobId])

  const poll = usePoll(fetchPlotData, 2000, !stream.isDone)

  useEffect(() => {
    if (poll.data) setPlotData(poll.data as unknown as MuloPlotData)
  }, [poll.data])

  useEffect(() => {
    if (stream.isDone && jobId && !stream.error && !stream.isCancelled) {
      void muloApi.plotData(jobId).then((data) => setPlotData(data as unknown as MuloPlotData))
      void muloApi.state(jobId).then((state) => {
        setLocalState(state)
        onComplete(state)
      })
    } else if (stream.isDone && jobId) {
      void muloApi.plotData(jobId).then((data) => setPlotData(data as unknown as MuloPlotData))
      void muloApi.state(jobId).then((state) => setLocalState(state))
    }
  }, [stream.isDone, jobId, stream.error, stream.isCancelled, onComplete])

  useEffect(() => {
    if (!cancelling) return
    if (stream.isCancelled || (!stream.isRunning && stream.isDone)) {
      setCancelling(false)
    }
  }, [cancelling, stream.isCancelled, stream.isDone, stream.isRunning])

  useEffect(() => {
    const terminal = stream.isDone || stream.isCancelled || Boolean(stream.error)
    if (!terminal || notifiedTerminalRef.current === jobId) return
    notifiedTerminalRef.current = jobId
    onTerminal?.()
  }, [stream.isDone, stream.isCancelled, stream.error, jobId, onTerminal])

  const cancelOptimization = async () => {
    if (cancelling) return
    setCancelling(true)
    setError(null)
    try {
      await jobsApi.cancel(jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel optimization')
      setCancelling(false)
    }
  }

  const isStopping = cancelling && !stream.isCancelled
  const hasPlotData = Boolean(plotData?.cumulative_nfe.length)
  const loopTitle = localState?.loop_name?.replace(/_/g, ' ') ?? 'Controller Tuning'

  const fixedTargets = useMemo(() => {
    const loops = localState?.controller_structure ?? []
    const index = Math.max(0, (localState?.controller_index ?? 1) - 1)
    return (loops[index]?.metrics ?? {}) as Record<string, number>
  }, [localState])

  const costChart = useMemo(
    () => (plotData ? buildCostChart(plotData) : null),
    [plotData],
  )
  const metricsCharts = useMemo(
    () => (plotData ? buildMetricsCharts(plotData, fixedTargets) : []),
    [plotData, fixedTargets],
  )
  const gainsCharts = useMemo(
    () => (plotData ? buildGainsCharts(plotData) : []),
    [plotData],
  )
  const summaryCharts = useMemo(
    () => (plotData ? buildSummaryCharts(plotData) : []),
    [plotData],
  )

  const progressLabel = stream.isCancelled
    ? 'Optimization cancelled'
    : isStopping
      ? 'Cancelling optimization...'
      : stream.isDone
        ? 'Optimization complete'
        : stream.statusText || 'Running GA optimization...'

  const tabs = [
    {
      id: 'performance',
      label: 'Performance Result',
      content: localState?.controller_designed ? (
        <MuloPerformancePanel jobId={jobId} designerState={localState} />
      ) : (
        <p className={mutedText}>Results will appear here once available...</p>
      ),
    },
    {
      id: 'cost',
      label: 'Baseline Cost',
      content: costChart ? (
        <PlotlyChart data={costChart.data} layout={costChart.layout} />
      ) : (
        <WaitingMessage />
      ),
    },
    {
      id: 'metrics',
      label: 'Performance Metrics',
      content: metricsCharts.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {metricsCharts.map((chart, index) => (
            <PlotlyChart key={index} data={chart.data} layout={chart.layout} height={220} />
          ))}
        </div>
      ) : (
        <WaitingMessage />
      ),
    },
    {
      id: 'gains',
      label: 'PID Gains',
      content: gainsCharts.length ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {gainsCharts.map((chart, index) => (
            <PlotlyChart key={index} data={chart.data} layout={chart.layout} height={260} />
          ))}
        </div>
      ) : (
        <WaitingMessage />
      ),
    },
    {
      id: 'summary',
      label: 'LLM Summary',
      content: summaryCharts.length ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {summaryCharts.map((chart, index) => (
            <PlotlyChart key={index} data={chart.data} layout={chart.layout} height={260} />
          ))}
        </div>
      ) : (
        <WaitingMessage />
      ),
    },
    {
      id: 'final',
      label: 'Final Result',
      content: localState?.controller_designed ? (
        <div className="flex flex-col gap-4">
          <JsonViewer
            data={localState.modified_controller_structure}
            title="Controller Structure (JSON)"
          />
          <details>
            <summary className="cursor-pointer font-medium text-foreground">
              View Raw Python Code Output
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-border p-4 text-xs">
              {localState.modified_code}
            </pre>
          </details>
        </div>
      ) : (
        <p className={mutedText}>Results will appear here once available...</p>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="m-0 text-foreground capitalize">{loopTitle} — Controller Tuning</h3>
        {onNewExperiment && (
          <button type="button" className={btnBase} onClick={onNewExperiment}>
            New Experiment
          </button>
        )}
      </div>

      <MuloStatusBar
        plotData={plotData}
        runConfig={runConfig}
        isRunning={stream.isRunning && !stream.isDone}
        isDone={stream.isDone && !stream.error}
        isFailed={Boolean(stream.error)}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex-1 [&>div]:my-0">
          <ProgressBar value={stream.isDone ? 1 : Math.max(stream.progress, hasPlotData ? 0.15 : 0)} label={progressLabel} />
        </div>
        {stream.isRunning && !stream.isDone && !isStopping && (
          <button
            type="button"
            className={`${btnBase} shrink-0 border-[color-mix(in_srgb,var(--app-status-error-text)_35%,transparent)] text-[var(--app-status-error-text)]`}
            onClick={() => void cancelOptimization()}
          >
            <OctagonX className="inline-block w-4 h-4 mr-1" />
            Cancel
          </button>
        )}
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {stream.error && <StatusMessage type="error" message={stream.error} />}

      {hasPlotData ? (
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      ) : (
        <p className={mutedText}>Waiting for the first generation result…</p>
      )}
    </div>
  )
}

function WaitingMessage() {
  return <p className={mutedText}>Waiting for the first generation result…</p>
}
