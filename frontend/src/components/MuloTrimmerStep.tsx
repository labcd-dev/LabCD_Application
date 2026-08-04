import { useEffect, useState } from 'react'
import { FileText, RotateCcw } from 'lucide-react'
import { jobsApi, trimmerApi } from '../api/endpoints'
import type { TrimmerArtifactsResponse } from '../api/types'
import { ActivityLog } from './ActivityLog'
import { HumanInputForm } from './HumanInputForm'
import { ProgressBar } from './ProgressBar'
import { StatusMessage } from './StatusMessage'
import { Tabs } from './Tabs'
import { TrimmerEquilibriumResults } from './TrimmerEquilibriumResults'
import {
  parseWorkflowSummary,
  WorkflowSummaryPanel,
  type WorkflowSummary,
} from './WorkflowSummaryPanel'
import { usePipeline } from '../context/PipelineContext'
import { useJobStream } from '../hooks/useJobStream'
import { btnBase, btnPrimary, fieldInput, fieldLabel } from '../lib/classes'

type Step = 'operating' | 'running' | 'results'

interface MuloTrimmerStepProps {
  onComplete: () => void
}

function hasEquilibriumResult(artifacts: Record<string, unknown> | null | undefined): boolean {
  const result = artifacts?.result
  return Boolean(result && typeof result === 'object' && Object.keys(result as object).length > 0)
}

async function fetchTrimmerArtifacts(
  jobId: string,
  attempts = 8,
  delayMs = 250,
): Promise<TrimmerArtifactsResponse> {
  let last: TrimmerArtifactsResponse | null = null
  for (let i = 0; i < attempts; i += 1) {
    last = await trimmerApi.artifacts(jobId)
    if (hasEquilibriumResult(last as unknown as Record<string, unknown>)) {
      return last
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  return last ?? {
    result: {},
    config: {},
    safe_system_name: '',
    output_dir: '',
  }
}

export function MuloTrimmerStep({ onComplete }: MuloTrimmerStepProps) {
  const pipeline = usePipeline()
  const [step, setStep] = useState<Step>(() =>
    pipeline.trimmerJobId ? 'results' : 'operating',
  )
  const [activeTab, setActiveTab] = useState('process')
  const [selectedParams, setSelectedParams] = useState<string[]>([])
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [artifacts, setArtifacts] = useState<Record<string, unknown> | null>(null)
  const [submittingInput, setSubmittingInput] = useState(false)
  const [plotLoading, setPlotLoading] = useState(false)
  const [plotError, setPlotError] = useState<string | null>(null)
  const [plotFilename, setPlotFilename] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [pdfFilename, setPdfFilename] = useState<string | null>(null)
  const [summary, setSummary] = useState<WorkflowSummary | null>(null)

  const jobId = pipeline.trimmerJobId
  const stream = useJobStream({ module: 'trimmer', jobId, enabled: step === 'running' })

  useEffect(() => {
    const fromStream = parseWorkflowSummary(stream.summary)
    if (fromStream) setSummary(fromStream)
  }, [stream.summary])

  useEffect(() => {
    const preselected = pipeline.handoff?.trimming_params ?? []
    if (preselected.length > 0) {
      setSelectedParams(preselected)
    } else if (pipeline.statesInputs.length > 0) {
      setSelectedParams([...pipeline.statesInputs])
    }
  }, [pipeline.handoff, pipeline.statesInputs])

  useEffect(() => {
    // Only auto-load when artifacts were never fetched (null), not when empty.
    if (pipeline.trimmerJobId && step === 'results' && artifacts === null) {
      let cancelled = false
      void Promise.all([
        fetchTrimmerArtifacts(pipeline.trimmerJobId),
        jobsApi.status(pipeline.trimmerJobId).catch(() => null),
      ]).then(([res, status]) => {
        if (cancelled) return
        setArtifacts(res as unknown as Record<string, unknown>)
        if (res.time_response_file) {
          setPlotFilename(res.time_response_file)
        }
        if (res.pdf_file) {
          setPdfFilename(res.pdf_file.split(/[/\\]/).pop() ?? res.pdf_file)
        }
        const parsed = parseWorkflowSummary(status?.metadata?.summary)
        if (parsed) setSummary(parsed)
      })
      return () => {
        cancelled = true
      }
    }
  }, [pipeline.trimmerJobId, step, artifacts])

  const startTrimmer = async () => {
    const trimmingParams: Record<string, number> = {}
    for (const param of selectedParams) {
      const value = parseFloat(paramValues[param] ?? '0')
      trimmingParams[param] = Number.isNaN(value) ? 0 : value
    }

    setLoading(true)
    setError(null)
    try {
      const job = await trimmerApi.start({
        file_content: pipeline.fileContent,
        file_name: pipeline.fileName,
        model: pipeline.model,
        trimming_params: trimmingParams,
        states_inputs: pipeline.statesInputs,
        project_id: pipeline.projectId,
        recommender_job_id: pipeline.recommenderJobId,
      })
      pipeline.setTrimmerJobId(job.job_id)
      pipeline.setTrimmingParams(trimmingParams)
      setStep('running')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start trimmer')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (stream.isDone && jobId && step === 'running') {
      let cancelled = false
      void Promise.all([
        fetchTrimmerArtifacts(jobId),
        jobsApi.status(jobId).catch(() => null),
      ]).then(([res, status]) => {
        if (cancelled) return
        setArtifacts(res as unknown as Record<string, unknown>)
        if (res.time_response_file) {
          setPlotFilename(res.time_response_file)
        }
        const parsed = parseWorkflowSummary(status?.metadata?.summary)
        if (parsed) setSummary(parsed)
        if (stream.error) {
          setError(stream.error)
        }
        setStep('results')
      })
      return () => {
        cancelled = true
      }
    }
  }, [stream.isDone, jobId, step, stream.error])

  const submitHumanInput = async (answer: string) => {
    if (!jobId || !stream.humanInput) return
    setSubmittingInput(true)
    try {
      await trimmerApi.input(jobId, {
        key: String(stream.humanInput.key ?? ''),
        prompt: String(stream.humanInput.prompt ?? ''),
        answer,
      })
      stream.clearHumanInput()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit input')
    } finally {
      setSubmittingInput(false)
    }
  }

  const restartTrimmer = () => {
    pipeline.setTrimmerJobId(null)
    pipeline.setMuloJobId(null)
    setArtifacts(null)
    setError(null)
    setPlotError(null)
    setPlotFilename(null)
    setPdfError(null)
    setPdfFilename(null)
    setSummary(null)
    setActiveTab('process')
    setStep('operating')
  }

  const generateTimeResponse = async () => {
    if (!jobId) return
    setPlotLoading(true)
    setPlotError(null)
    try {
      const res = await trimmerApi.timeResponse(jobId)
      setPlotFilename(res.filename)
    } catch (err) {
      setPlotError(err instanceof Error ? err.message : 'Failed to generate time response')
    } finally {
      setPlotLoading(false)
    }
  }

  const generatePdf = async () => {
    if (!jobId) return
    setPdfLoading(true)
    setPdfError(null)
    try {
      const res = await trimmerApi.generatePdf(jobId, {
        recommender_job_id: pipeline.recommenderJobId,
      })
      setPdfFilename(res.filename)
      window.open(jobsApi.downloadArtifact(jobId, res.filename), '_blank', 'noopener,noreferrer')
      onComplete()
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Failed to generate PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  const plotUrl =
    jobId && plotFilename ? jobsApi.downloadArtifact(jobId, plotFilename) : null
  const pdfUrl =
    jobId && pdfFilename ? jobsApi.downloadArtifact(jobId, pdfFilename) : null

  const tabs = [
    {
      id: 'process',
      label: step === 'results' ? 'Results' : 'Process',
      content: (
        <>
          {step === 'running' && (
            <>
              <ProgressBar value={stream.progress} label={stream.statusText || 'Running trimmer...'} />
              {stream.error && <StatusMessage type="error" message={stream.error} />}
              {stream.humanInput && (
                <HumanInputForm
                  request={stream.humanInput}
                  onSubmit={(answer) => void submitHumanInput(answer)}
                  disabled={submittingInput}
                />
              )}
            </>
          )}
          {step === 'results' && artifacts && (
            <>
              <StatusMessage
                type={error ? 'warning' : 'success'}
                message={error ? `Trimmer finished with issues: ${error}` : 'Trimmer completed.'}
              />
              {hasEquilibriumResult(artifacts) ? (
                <TrimmerEquilibriumResults result={artifacts.result} />
              ) : (
                <StatusMessage
                  type="warning"
                  message="Trimmer finished but no equilibrium result payload was returned. Re-run Trimmer or check the activity log."
                />
              )}
              <div className="flex gap-3 flex-wrap mt-4">
                <button type="button" className={btnBase} onClick={restartTrimmer}>
                  <RotateCcw className="size-4" aria-hidden />
                  Change Settings & Re-run
                </button>
              </div>
            </>
          )}
          {step === 'results' && !artifacts && (
            <StatusMessage
              type="warning"
              message={error || 'Trimmer finished but artifacts are unavailable.'}
            />
          )}
        </>
      ),
    },
    ...(step === 'results'
      ? [
          {
            id: 'time-response',
            label: 'Time Response',
            content: (
              <>
                <p className="text-muted-text leading-relaxed m-0">
                  Simulate open dynamics around the trimmed equilibrium and plot state trajectories.
                </p>
                {plotError && <StatusMessage type="error" message={plotError} />}
                <div className="flex gap-3 flex-wrap mt-4">
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={plotLoading || !jobId}
                    onClick={() => void generateTimeResponse()}
                  >
                    {plotLoading ? 'Generating…' : 'Generate Time Response Plot'}
                  </button>
                </div>
                {plotUrl && (
                  <img
                    src={plotUrl}
                    alt="Time response simulation"
                    className="max-w-full border border-border rounded-lg my-4"
                  />
                )}
              </>
            ),
          },
        ]
      : []),
    {
      id: 'logs',
      label: 'Activity Log',
      content: <ActivityLog logs={stream.logs} />,
    },
    ...(step === 'results'
      ? [
          {
            id: 'summary',
            label: 'Summary',
            content: <WorkflowSummaryPanel summary={summary} variant="trimmer" />,
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <h3 className="mt-0 text-foreground">Trimmer</h3>
      {error && <StatusMessage type="error" message={error} />}

      {step === 'operating' && (
        <>
          <h4 className="text-foreground font-medium">Specify Operating Point</h4>
          <p className="text-muted-text leading-relaxed">
            Select parameters and assign floating-point values for trimming.
          </p>

          {pipeline.statesInputs.length === 0 ? (
            <StatusMessage type="warning" message="No parameters available. Complete Recommender handoff first." />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {pipeline.statesInputs.map((param) => (
                  <label key={param} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedParams.includes(param)}
                      onChange={(e) =>
                        setSelectedParams((prev) =>
                          e.target.checked
                            ? [...prev, param]
                            : prev.filter((p) => p !== param),
                        )
                      }
                    />
                    {param}
                  </label>
                ))}
              </div>

              {selectedParams.map((param) => (
                <label key={param} className={fieldLabel}>
                  <span>{param}</span>
                  <input
                    type="number"
                    step="any"
                    className={fieldInput}
                    value={paramValues[param] ?? ''}
                    onChange={(e) =>
                      setParamValues((prev) => ({ ...prev, [param]: e.target.value }))
                    }
                  />
                </label>
              ))}

              <button
                type="button"
                className={btnPrimary}
                disabled={loading || selectedParams.length === 0 || !pipeline.fileContent}
                onClick={() => void startTrimmer()}
              >
                Start Trimmer
              </button>
            </>
          )}
        </>
      )}

      {step === 'results' && artifacts && (
        <div className="space-y-3">
          {pdfError && <StatusMessage type="error" message={pdfError} />}
          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              className={btnPrimary}
              disabled={pdfLoading || !jobId || !hasEquilibriumResult(artifacts)}
              onClick={() => void generatePdf()}
            >
              <FileText className="size-4" aria-hidden />
              {pdfLoading ? 'Generating PDF…' : 'Generate PDF'}
            </button>
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={btnBase}
              >
                Download PDF
              </a>
            )}
          </div>
        </div>
      )}

      {(step === 'running' || step === 'results') && (
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      )}
    </div>
  )
}
