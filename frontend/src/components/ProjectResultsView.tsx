import { useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { adminApi, projectsApi } from '../api/endpoints'
import type { ProjectPipelineType } from '../api/types'
import { DesignIterationReport } from './DesignIterationReport'
import { DesignMonitorDashboard } from './DesignMonitorDashboard'
import { SiloPerformancePanel } from './SiloPerformancePanel'
import { SiloSummaryPanel } from './SiloSummaryPanel'
import { CodePreview } from './CodePreview'
import { JsonViewer } from './JsonViewer'
import { PlotlyChart } from './PlotlyChart'
import { StatusMessage } from './StatusMessage'
import { Tabs } from './Tabs'
import { TrimmerEquilibriumResults } from './TrimmerEquilibriumResults'
import {
  parseWorkflowSummary,
  WorkflowSummaryPanel,
} from './WorkflowSummaryPanel'
import type { LlmResponseEntry } from '../lib/llmResponseParser'
import type { StateHistoryEntry } from '../lib/monitorStateParser'
import type { MuloPlotData } from '../lib/muloDesignConfig'
import {
  buildCostChart,
  buildGainsCharts,
  buildMetricsCharts,
  buildSummaryCharts,
} from '../lib/muloPlotCharts'
import { btnBase, cardPanel, mutedText } from '../lib/classes'

interface ProjectResultsViewProps {
  pipelineType: ProjectPipelineType
  results?: Record<string, unknown> | null
  projectId?: number
  jobId?: string | null
  artifactScope?: 'user' | 'admin'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isMuloPlotData(value: unknown): value is MuloPlotData {
  const data = asRecord(value)
  return Boolean(data && Array.isArray(data.cumulative_nfe) && data.cumulative_nfe.length > 0)
}

function extractMuloFixedTargets(
  controllerStructure: unknown,
): Record<string, number> {
  const loops = asArray(controllerStructure)
  const first = asRecord(loops[0])
  const metrics = asRecord(first?.metrics)
  if (!metrics) return {}
  const targets: Record<string, number> = {}
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number') targets[key] = value
  }
  return targets
}

function SiloResults({
  monitorState,
  jobId,
  projectId,
}: {
  monitorState: Record<string, unknown>
  jobId?: string | null
  projectId?: number
}) {
  const [activeTab, setActiveTab] = useState('simulation')
  const llmResponses = asArray(monitorState.llm_responses) as LlmResponseEntry[]
  const stateHistory = asArray(monitorState.state_history) as StateHistoryEntry[]
  const currentState = asRecord(monitorState.current_state)

  const tabs = [
    {
      id: 'simulation',
      label: 'Simulation',
      content:
        stateHistory.length > 0 || currentState ? (
          <DesignMonitorDashboard stateHistory={stateHistory} currentState={currentState} />
        ) : (
          <p className={mutedText}>No simulation metrics were saved for this project.</p>
        ),
    },
    {
      id: 'time-response',
      label: 'Time Response',
      content: (
        <SiloPerformancePanel
          jobId={jobId}
          projectId={projectId}
          currentState={currentState}
          disabled={false}
        />
      ),
    },
    {
      id: 'process',
      label: 'Design Process',
      content:
        llmResponses.length > 0 ? (
          <DesignIterationReport responses={llmResponses} defaultExpanded="all" />
        ) : (
          <p className={mutedText}>No agent iteration data was saved for this project.</p>
        ),
    },
    {
      id: 'summary',
      label: 'Summary',
      content: (
        <SiloSummaryPanel
          scenarioMetricsHistory={monitorState.scenario_metrics_history}
          currentState={currentState}
          stateHistory={stateHistory}
          isRunning={false}
        />
      ),
    },
  ]

  return <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
}

function MuloResults({ results }: { results: Record<string, unknown> }) {
  const [activeTab, setActiveTab] = useState('output')
  const plotData = isMuloPlotData(results.plot_data) ? results.plot_data : null
  const modifiedCode =
    typeof results.modified_code === 'string' ? results.modified_code : null
  const modifiedStructure = results.modified_controller_structure ?? null
  const controllerStructure = results.modified_controller_structure ?? results.controller_structure

  const fixedTargets = useMemo(
    () => extractMuloFixedTargets(controllerStructure),
    [controllerStructure],
  )

  const costChart = useMemo(() => (plotData ? buildCostChart(plotData) : null), [plotData])
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

  const tabs = [
    {
      id: 'output',
      label: 'Final Output',
      content:
        modifiedStructure || modifiedCode ? (
          <div className="flex flex-col gap-4">
            {modifiedStructure ? (
              <JsonViewer data={modifiedStructure} title="Controller structure" />
            ) : null}
            {modifiedCode ? (
              <div className={cardPanel}>
                <h4 className="m-0 mb-2 text-sm font-semibold text-foreground">
                  Modified Python code
                </h4>
                <CodePreview value={modifiedCode} readOnly />
              </div>
            ) : null}
          </div>
        ) : (
          <p className={mutedText}>No final controller output was saved for this project.</p>
        ),
    },
    {
      id: 'cost',
      label: 'Baseline Cost',
      content: costChart ? (
        <PlotlyChart data={costChart.data} layout={costChart.layout} />
      ) : (
        <p className={mutedText}>No optimization cost history was saved.</p>
      ),
    },
    {
      id: 'metrics',
      label: 'Performance Metrics',
      content: metricsCharts.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {metricsCharts.map((chart, index) => (
            <PlotlyChart key={index} data={chart.data} layout={chart.layout} height={220} />
          ))}
        </div>
      ) : (
        <p className={mutedText}>No performance metric history was saved.</p>
      ),
    },
    {
      id: 'gains',
      label: 'PID Gains',
      content: gainsCharts.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {gainsCharts.map((chart, index) => (
            <PlotlyChart key={index} data={chart.data} layout={chart.layout} height={260} />
          ))}
        </div>
      ) : (
        <p className={mutedText}>No PID gain history was saved.</p>
      ),
    },
    {
      id: 'summary',
      label: 'LLM Summary',
      content: summaryCharts.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {summaryCharts.map((chart, index) => (
            <PlotlyChart key={index} data={chart.data} layout={chart.layout} height={260} />
          ))}
        </div>
      ) : (
        <p className={mutedText}>No LLM summary charts were saved.</p>
      ),
    },
  ]

  return <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
}

function MuloTrimmerProjectResults({
  results,
  projectId,
  artifactScope,
}: {
  results: Record<string, unknown>
  projectId?: number
  artifactScope: 'user' | 'admin'
}) {
  const [activeTab, setActiveTab] = useState('results')
  const trimmer = asRecord(results.trimmer)
  const trimmerResult = trimmer?.result
  const pdfFile = typeof results.pdf_file === 'string' ? results.pdf_file : null
  const pdfName = pdfFile ? (pdfFile.split(/[/\\]/).pop() ?? pdfFile) : null
  const pdfUrl =
    projectId && pdfName
      ? artifactScope === 'admin'
        ? adminApi.downloadProjectArtifact(projectId, pdfName)
        : projectsApi.downloadArtifact(projectId, pdfName)
      : null
  const error = typeof results.error === 'string' ? results.error : null
  const recommenderSummary = parseWorkflowSummary(results.recommender_summary)
  const trimmerSummary = parseWorkflowSummary(results.trimmer_summary)

  const tabs = [
    {
      id: 'results',
      label: 'Final Result',
      content: (
        <div className="space-y-4">
          {error ? <StatusMessage type="error" message={error} /> : null}
          {pdfUrl ? (
            <div className="flex flex-wrap gap-2">
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className={btnBase}>
                <FileText className="size-4" aria-hidden />
                Download PDF
              </a>
            </div>
          ) : null}
          {trimmerResult ? (
            <TrimmerEquilibriumResults result={trimmerResult} />
          ) : (
            <p className={mutedText}>No trimmer equilibrium data was saved for this project.</p>
          )}
        </div>
      ),
    },
    {
      id: 'recommender-summary',
      label: 'Recommender Summary',
      content: (
        <WorkflowSummaryPanel summary={recommenderSummary} variant="recommender" />
      ),
    },
    {
      id: 'trimmer-summary',
      label: 'Trimmer Summary',
      content: <WorkflowSummaryPanel summary={trimmerSummary} variant="trimmer" />,
    },
  ]

  return <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
}

export function ProjectResultsView({
  pipelineType,
  results,
  projectId,
  jobId,
  artifactScope = 'user',
}: ProjectResultsViewProps) {
  if (!results) {
    return <p className={mutedText}>No results saved yet.</p>
  }

  if (pipelineType === 'muloDesign' && asRecord(results.trimmer)) {
    return (
      <MuloTrimmerProjectResults
        results={results}
        projectId={projectId}
        artifactScope={artifactScope}
      />
    )
  }

  const error = typeof results.error === 'string' ? results.error : null
  if (error) {
    return <StatusMessage type="error" message={error} />
  }

  if (pipelineType === 'siloDesign') {
    const monitorState = asRecord(results.monitor_state)
    if (monitorState) {
      return (
        <SiloResults
          monitorState={monitorState}
          jobId={jobId}
          projectId={projectId}
        />
      )
    }
  }

  if (pipelineType === 'muloDesign') {
    return <MuloResults results={results} />
  }

  return <CodePreview value={JSON.stringify(results, null, 2)} readOnly />
}
