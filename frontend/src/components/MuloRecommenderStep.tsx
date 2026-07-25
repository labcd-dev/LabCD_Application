import { useCallback, useEffect, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { healthApi, jobsApi, recommenderApi } from '../api/endpoints'
import { ActivityLog } from './ActivityLog'
import { JsonViewer } from './JsonViewer'
import { ModelSelect } from './ModelSelect'
import { ProgressBar } from './ProgressBar'
import { StatusMessage } from './StatusMessage'
import { Tabs } from './Tabs'
import { usePipeline } from '../context/PipelineContext'
import { useJobStream } from '../hooks/useJobStream'
import { btnBase, btnPrimary, cardPanel, mutedText } from '../lib/classes'

type Step = 'idle' | 'running' | 'review' | 'comparison'

const RAG_OPTIONS = [
  { value: 'OPENAI_WEB_SEARCH', label: 'Web Search API' },
  { value: 'BLOCK_DIAGRAM_SEARCH', label: 'Block Diagram Search' },
]

interface MuloRecommenderStepProps {
  onComplete: () => void
}

export function MuloRecommenderStep({ onComplete }: MuloRecommenderStepProps) {
  const pipeline = usePipeline()
  const [step, setStep] = useState<Step>(() =>
    pipeline.recommenderJobId ? 'review' : 'idle',
  )
  const [activeTab, setActiveTab] = useState('process')
  const [ragModels, setRagModels] = useState<string[]>(['gpt-4o'])
  const [ragModel, setRagModel] = useState('gpt-4o')
  const [ragFlags, setRagFlags] = useState<string[]>([])
  const [state, setState] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [ragError, setRagError] = useState('')
  const [chosenController, setChosenController] = useState<string | null>(null)

  const jobId = pipeline.recommenderJobId
  const stream = useJobStream({ module: 'recommender', jobId, enabled: step === 'running' })

  useEffect(() => {
    healthApi.models().then((res) => setRagModels(res.rag_models)).catch(() => {})
  }, [])

  const startRecommender = async (recommenderStep = 'initial_run') => {
    if (!pipeline.fileContent || !pipeline.fileName) {
      setError('Upload and process a file on the Home page first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const job = await recommenderApi.start({
        file_content: pipeline.fileContent,
        file_name: pipeline.fileName,
        model: pipeline.model,
        step: recommenderStep,
      })
      pipeline.setRecommenderJobId(job.job_id)
      setStep('running')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recommender')
    } finally {
      setLoading(false)
    }
  }

  const loadState = useCallback(async () => {
    if (!jobId) return
    const nextState = await recommenderApi.state(jobId)
    setState(nextState)
  }, [jobId])

  useEffect(() => {
    if (jobId && (step === 'review' || step === 'comparison') && !state) {
      void loadState()
    }
  }, [jobId, step, state, loadState])

  useEffect(() => {
    if (stream.isDone && step === 'running') {
      void loadState().then(async () => {
        if (jobId) {
          const ragStatus = await recommenderApi.ragStatus(jobId)
          setRagError(ragStatus.error_message)
          setStep(ragStatus.next_step === 'comparison' ? 'comparison' : 'review')
        }
      })
    }
  }, [stream.isDone, step, jobId, loadState])

  const startRag = async () => {
    if (!jobId) return
    setLoading(true)
    try {
      const job = await recommenderApi.ragDecision(jobId, {
        flags: ragFlags,
        model: ragModel,
      })
      pipeline.setRecommenderJobId(job.job_id)
      setStep('running')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RAG decision failed')
    } finally {
      setLoading(false)
    }
  }

  const controllerJson = (state?.controller_json ?? {}) as Record<string, unknown>

  const resolveControllerPayload = (selection?: string | null): string | null => {
    const key = selection ?? chosenController ?? 'Initial_controller'
    const value = controllerJson[key]
    if (typeof value === 'string') return value
    if (value != null) return JSON.stringify(value)
    if (selection && selection.startsWith('{')) return selection
    return null
  }

  const goToTrimmer = async (controller?: string | null) => {
    if (!jobId) return
    setLoading(true)
    try {
      const handoff = await recommenderApi.handoff(jobId, {
        chosen_controller: resolveControllerPayload(controller),
      })
      pipeline.setHandoff(handoff)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Handoff failed')
    } finally {
      setLoading(false)
    }
  }

  const restartRecommender = () => {
    pipeline.setRecommenderJobId(null)
    pipeline.setHandoff(null)
    pipeline.setTrimmerJobId(null)
    pipeline.setMuloJobId(null)
    pipeline.setTrimmingParams({})
    pipeline.setStatesInputs([])
    setState(null)
    setChosenController(null)
    setRagFlags([])
    setRagError('')
    setError(null)
    setActiveTab('process')
    setStep('idle')
  }

  const controllerGraph = (state?.controller_graph ?? {}) as Record<string, string>
  const controllerKeys = Object.keys(controllerJson)

  const graphImageUrl = useMemo(() => {
    if (!jobId) return null
    const filename = `${pipeline.fileName}_controller_graph_Initial.png`
    return jobsApi.downloadArtifact(jobId, filename)
  }, [jobId, pipeline.fileName])

  const resultImageClass = 'max-w-full border border-border rounded-lg my-4'

  const tabs = [
    {
      id: 'process',
      label: step === 'review' || step === 'comparison' ? 'Final Result' : 'Process',
      content: (
        <>
          {step === 'running' && (
            <>
              <ProgressBar value={stream.progress} label={stream.statusText || 'Running recommender...'} />
              {stream.error && <StatusMessage type="error" message={stream.error} />}
            </>
          )}
          {step === 'review' && (
            <>
              {ragError && <StatusMessage type="warning" message={ragError} />}
              {graphImageUrl && (
                <img
                  src={graphImageUrl}
                  alt="Controller graph"
                  className={resultImageClass}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              )}
              <div className="flex gap-3 flex-wrap mt-4">
                <button type="button" className={btnBase} onClick={restartRecommender}>
                  <RotateCcw className="size-4" aria-hidden />
                  Change Settings & Re-run
                </button>
                <button type="button" className={btnPrimary} onClick={() => void goToTrimmer()}>
                  Satisfied – Continue to Trimmer
                </button>
              </div>
              <div className={`${cardPanel} mt-4`}>
                <h4 className="mt-0 text-foreground">RAG Enhancement</h4>
                <div className="flex flex-col gap-2">
                  {RAG_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ragFlags.includes(opt.value)}
                        onChange={(e) =>
                          setRagFlags((prev) =>
                            e.target.checked
                              ? [...prev, opt.value]
                              : prev.filter((f) => f !== opt.value),
                          )
                        }
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <ModelSelect
                  models={ragModels}
                  value={ragModel}
                  onChange={setRagModel}
                  label="RAG Model"
                />
                <button
                  type="button"
                  className={btnBase}
                  disabled={ragFlags.length === 0 || loading}
                  onClick={() => void startRag()}
                >
                  Continue with RAG Enhancement
                </button>
              </div>
            </>
          )}
          {step === 'comparison' && (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
                {graphImageUrl && (
                  <figure>
                    <img src={graphImageUrl} alt="Original output" className={resultImageClass} />
                    <figcaption>Original Output</figcaption>
                  </figure>
                )}
                {Object.entries(controllerGraph).map(([key, path]) =>
                  key !== 'Initial_controller' ? (
                    <figure key={key}>
                      <img src={path} alt={key} className={resultImageClass} />
                      <figcaption>{key}</figcaption>
                    </figure>
                  ) : null,
                )}
              </div>
              <div className="flex flex-col gap-2">
                {controllerKeys.map((key) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="controller-choice"
                      checked={chosenController === key}
                      onChange={() => setChosenController(key)}
                    />
                    {key.replace('_controller', '')}
                  </label>
                ))}
              </div>
              <div className="flex gap-3 flex-wrap mt-4">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={!chosenController || loading}
                  onClick={() => void goToTrimmer(chosenController)}
                >
                  Save Choice – Continue to Trimmer
                </button>
                <button type="button" className={btnBase} onClick={restartRecommender}>
                  <RotateCcw className="size-4" aria-hidden />
                  Change Settings & Re-run
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
    {
      id: 'json',
      label: 'JSON Result',
      content: (
        <>
          {controllerKeys.length === 0 && <p className={mutedText}>No JSON output yet.</p>}
          {controllerKeys.map((key) => (
            <JsonViewer key={key} title={key} data={controllerJson[key]} />
          ))}
        </>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <h3 className="mt-0 text-foreground">Recommender</h3>
      {error && <StatusMessage type="error" message={error} />}

      {step === 'idle' && (
        <>
          <p className="text-muted-text leading-relaxed">
            Analyze uploaded dynamics and recommend controller architecture.
          </p>
          <button
            type="button"
            className={btnPrimary}
            disabled={loading || !pipeline.fileContent}
            onClick={() => void startRecommender()}
          >
            Start Recommender
          </button>
        </>
      )}

      {(step === 'running' || step === 'review' || step === 'comparison') && (
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      )}
    </div>
  )
}
