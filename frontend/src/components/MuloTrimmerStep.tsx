import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { trimmerApi } from '../api/endpoints'
import { ActivityLog } from './ActivityLog'
import { HumanInputForm } from './HumanInputForm'
import { JsonViewer } from './JsonViewer'
import { ProgressBar } from './ProgressBar'
import { StatusMessage } from './StatusMessage'
import { Tabs } from './Tabs'
import { usePipeline } from '../context/PipelineContext'
import { useJobStream } from '../hooks/useJobStream'
import { btnBase, btnPrimary, fieldInput, fieldLabel } from '../lib/classes'

type Step = 'operating' | 'running' | 'results'

interface MuloTrimmerStepProps {
  onComplete: () => void
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

  const jobId = pipeline.trimmerJobId
  const stream = useJobStream({ module: 'trimmer', jobId, enabled: step === 'running' })

  useEffect(() => {
    const preselected = pipeline.handoff?.trimming_params ?? []
    if (preselected.length > 0) {
      setSelectedParams(preselected)
    } else if (pipeline.statesInputs.length > 0) {
      setSelectedParams([...pipeline.statesInputs])
    }
  }, [pipeline.handoff, pipeline.statesInputs])

  useEffect(() => {
    if (pipeline.trimmerJobId && step === 'results' && !artifacts) {
      void trimmerApi.artifacts(pipeline.trimmerJobId).then((res) => {
        setArtifacts(res as unknown as Record<string, unknown>)
      })
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
    if (stream.isDone && step === 'running' && jobId) {
      void trimmerApi.artifacts(jobId).then((res) => {
        setArtifacts(res as unknown as Record<string, unknown>)
        setStep('results')
      })
    }
  }, [stream.isDone, step, jobId])

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
    setActiveTab('process')
    setStep('operating')
  }

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
              <StatusMessage type="success" message="Trimmer completed." />
              <JsonViewer data={artifacts.result ?? artifacts} title="Equilibrium Results" />
              <div className="flex gap-3 flex-wrap mt-4">
                <button type="button" className={btnBase} onClick={restartTrimmer}>
                  <RotateCcw className="size-4" aria-hidden />
                  Change Settings & Re-run
                </button>
                <button type="button" className={btnPrimary} onClick={onComplete}>
                  Continue to Multi Loop Designer
                </button>
              </div>
            </>
          )}
        </>
      ),
    },
    {
      id: 'logs',
      label: 'Activity Log',
      content: <ActivityLog logs={stream.logs} />,
    },
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

      {(step === 'running' || step === 'results') && (
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      )}
    </div>
  )
}
