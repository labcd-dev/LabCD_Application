import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  caseStudiesApi,
  healthApi,
  muloApi,
  recommenderApi,
  trimmerApi,
} from '../api/endpoints'
import type { MuloDesignerStateResponse } from '../api/types'
import { MuloAdvancedSettings } from '../components/MuloAdvancedSettings'
import { MuloCaseStudyEditor } from '../components/MuloCaseStudyEditor'
import {
  MuloPipelineStepIndicator,
  type MuloPipelineStep,
} from '../components/MuloPipelineStepIndicator'
import { MuloRecommenderStep } from '../components/MuloRecommenderStep'
import { MuloTrimmerStep } from '../components/MuloTrimmerStep'
import { ModelSelect } from '../components/ModelSelect'
import { StatusMessage } from '../components/StatusMessage'
import { usePipeline } from '../context/PipelineContext'
import {
  buildMuloRunConfig,
  normalizeControllerStructure,
  type MuloCaseStudyBundle,
  type MuloPidLoop,
  type MuloRunConfig,
  type MuloStage,
} from '../lib/muloDesignConfig'
import { btnBase, btnPrimary, btnWide, fieldInput, fieldLabel, pageIntro, pageSection } from '../lib/classes'

type DataSource = 'case_study' | 'pipeline'

function resolveInitialPipelineStep(
  stepParam: string | null,
  hasRecommender: boolean,
  hasHandoff: boolean,
  hasTrimmer: boolean,
): MuloPipelineStep {
  if (stepParam === 'recommender' || stepParam === 'trimmer' || stepParam === 'designer') {
    return stepParam
  }
  if (hasTrimmer || (hasRecommender && hasHandoff)) {
    return hasTrimmer ? 'designer' : 'trimmer'
  }
  if (hasRecommender || hasHandoff) {
    return 'trimmer'
  }
  return 'recommender'
}

export function MuloPage() {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const [searchParams, setSearchParams] = useSearchParams()

  const stepParam = searchParams.get('step')

  const isPipelineWorkflow = pipeline.pipeline === 'muloDesign' || Boolean(
    pipeline.fileContent && (pipeline.recommenderJobId || pipeline.handoff),
  ) || stepParam === 'recommender' || stepParam === 'trimmer'

  const [pipelineStep, setPipelineStep] = useState<MuloPipelineStep>(() =>
    isPipelineWorkflow
      ? resolveInitialPipelineStep(
          stepParam,
          Boolean(pipeline.recommenderJobId),
          Boolean(pipeline.handoff),
          Boolean(pipeline.trimmerJobId),
        )
      : 'designer',
  )

  const [stage, setStage] = useState<MuloStage>('setup')
  const [dataSource, setDataSource] = useState<DataSource>(() =>
    pipeline.recommenderJobId && pipeline.trimmerJobId ? 'pipeline' : 'case_study',
  )
  const [caseStudies, setCaseStudies] = useState<string[]>([])
  const [objectives, setObjectives] = useState<Record<string, string>>({})
  const [selectedCase, setSelectedCase] = useState('')
  const [models, setModels] = useState<string[]>(['gpt-4o-mini'])
  const [webSearchModels, setWebSearchModels] = useState<string[]>(['gpt-4o'])
  const [runConfig, setRunConfig] = useState<MuloRunConfig>(() =>
    buildMuloRunConfig({ control_objective: '' }),
  )
  const [designerState, setDesignerState] = useState<MuloDesignerStateResponse | null>(null)
  const [defaultStructure, setDefaultStructure] = useState<MuloPidLoop[]>([])
  const [defaultSimParams, setDefaultSimParams] = useState({ dt: 0.001, max_time: 50 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const jobId = pipeline.muloJobId

  useEffect(() => {
    if (
      stepParam === 'recommender'
      || stepParam === 'trimmer'
      || stepParam === 'designer'
    ) {
      setPipelineStep(stepParam)
    }
  }, [stepParam])

  useEffect(() => {
    healthApi.models().then((res) => {
      setModels(res.llm_models)
      setWebSearchModels(res.rag_models)
    }).catch(() => {})
    caseStudiesApi.list().then((res) => {
      setCaseStudies(res.mulo ?? [])
      setObjectives(res.mulo_objectives ?? {})
      if (res.mulo?.length) {
        setSelectedCase(res.mulo[0])
        setRunConfig((prev) => ({
          ...prev,
          case_study_file: res.mulo[0],
          control_objective: res.mulo_objectives?.[res.mulo[0]] ?? prev.control_objective,
        }))
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedCase || dataSource !== 'case_study') return
    setRunConfig((prev) => ({
      ...prev,
      case_study_file: selectedCase,
      control_objective: objectives[selectedCase] ?? prev.control_objective,
    }))
  }, [selectedCase, objectives, dataSource])

  const completedPipelineSteps = useMemo((): MuloPipelineStep[] => {
    const completed: MuloPipelineStep[] = []
    if (pipeline.handoff || pipeline.recommenderJobId) {
      completed.push('recommender')
    }
    if (pipeline.trimmerJobId) {
      completed.push('trimmer')
    }
    if (pipeline.muloJobId) {
      completed.push('designer')
    }
    return completed
  }, [pipeline.handoff, pipeline.recommenderJobId, pipeline.trimmerJobId, pipeline.muloJobId])

  const goToPipelineStep = useCallback((step: MuloPipelineStep) => {
    setPipelineStep(step)
    setSearchParams({ step }, { replace: true })
    if (step === 'designer' && pipeline.recommenderJobId && pipeline.trimmerJobId) {
      setDataSource('pipeline')
    }
    if (step !== 'designer') {
      setStage('setup')
      setError(null)
    }
  }, [pipeline.recommenderJobId, pipeline.trimmerJobId, setSearchParams])

  const goBackFromPipelineStep = useCallback(() => {
    if (pipelineStep === 'designer') {
      if (stage === 'edit_case_study') {
        setStage('setup')
        return
      }
      if (isPipelineWorkflow) {
        goToPipelineStep('trimmer')
        return
      }
      navigate('/studio')
      return
    }
    if (pipelineStep === 'trimmer') {
      goToPipelineStep('recommender')
      return
    }
    navigate('/studio')
  }, [pipelineStep, stage, isPipelineWorkflow, goToPipelineStep, navigate])

  const backLabel = (() => {
    if (pipelineStep === 'designer') {
      if (stage === 'edit_case_study') return 'Back to Parameter Configurations'
      if (isPipelineWorkflow) return 'Back to Trimmer'
      return 'Back to Studio'
    }
    if (pipelineStep === 'trimmer') return 'Back to Recommender'
    return 'Back to Studio'
  })()

  const loadCaseStudyBundle = useCallback(async (name: string) => {
    const bundle = (await caseStudiesApi.mulo(name)) as unknown as MuloCaseStudyBundle
    return {
      controller_structure: normalizeControllerStructure(bundle.controller),
      system_identification: bundle.system,
      trimming_result: bundle.trimming,
      equation: bundle.equation,
    }
  }, [])

  const loadPipelineBundle = useCallback(async () => {
    if (!pipeline.recommenderJobId || !pipeline.trimmerJobId) {
      throw new Error('Complete Recommender and Trimmer steps before using pipeline data.')
    }
    const [recState, trimArtifacts] = await Promise.all([
      recommenderApi.state(pipeline.recommenderJobId),
      trimmerApi.artifacts(pipeline.trimmerJobId),
    ])
    const controllerJson = (recState.controller_json ?? {}) as Record<string, string>
    const chosen = pipeline.handoff?.chosen_controller ?? controllerJson.Initial_controller
    if (!chosen || !controllerJson[chosen]) {
      throw new Error('Chosen controller not found in recommender state.')
    }
    const controller = JSON.parse(controllerJson[chosen]) as { pid_loops: MuloPidLoop[] }
    const systemIdentification = JSON.parse(String(recState.system_identification ?? '{}'))
    const trimmingResult = (trimArtifacts.result ?? trimArtifacts) as Record<string, unknown>

    return {
      controller_structure: controller.pid_loops,
      system_identification: systemIdentification,
      trimming_result: trimmingResult,
      equation: pipeline.fileContent,
    }
  }, [pipeline])

  const initializeDesigner = async () => {
    setLoading(true)
    setError(null)
    try {
      const bundle =
        dataSource === 'pipeline'
          ? await loadPipelineBundle()
          : await loadCaseStudyBundle(selectedCase)

      const config = buildMuloRunConfig({
        ...runConfig,
        case_study_file: dataSource === 'case_study' ? selectedCase : '',
        llm_model: runConfig.llm_model || pipeline.model,
      })

      const job = await muloApi.init({
        run_config: config as unknown as Record<string, unknown>,
        controller_structure: bundle.controller_structure as unknown as Record<string, unknown>[],
        system_identification: bundle.system_identification,
        trimming_result: bundle.trimming_result,
        equation: bundle.equation,
        project_id: pipeline.projectId,
        file_name: pipeline.fileName || selectedCase || undefined,
        file_type: pipeline.fileType || 'python',
      })

      pipeline.setMuloJobId(job.job_id)
      const state = await muloApi.state(job.job_id)
      setDesignerState(state)
      setDefaultStructure(state.controller_structure as unknown as MuloPidLoop[])
      const sim = (state.case_study.simulation_params ?? {}) as { dt?: number; max_time?: number }
      setDefaultSimParams({
        dt: sim.dt ?? 0.001,
        max_time: sim.max_time ?? 50,
      })
      setRunConfig(config)
      setStage('edit_case_study')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize designer')
    } finally {
      setLoading(false)
    }
  }

  const runOptimization = async (
    structure: MuloPidLoop[],
    simulationParams: { dt: number; max_time: number },
  ) => {
    if (!jobId || !designerState) return
    if (!pipeline.projectId) {
      setError('Create a project from Studio before starting optimization.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const caseStudy = {
        ...designerState.case_study,
        simulation_params: simulationParams,
      }
      await muloApi.configure(jobId, {
        case_study: caseStudy,
        controller_structure: structure as unknown as Record<string, unknown>[],
      })
      await muloApi.run(jobId)
      navigate(`/projects/${pipeline.projectId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start optimization')
    } finally {
      setLoading(false)
    }
  }

  const editorStructure = useMemo(
    () => (designerState?.controller_structure as unknown as MuloPidLoop[]) ?? defaultStructure,
    [designerState, defaultStructure],
  )

  const editorSimParams = useMemo(() => {
    const sim = (designerState?.case_study?.simulation_params ?? defaultSimParams) as {
      dt?: number
      max_time?: number
    }
    return { dt: sim.dt ?? 0.001, max_time: sim.max_time ?? 50 }
  }, [designerState, defaultSimParams])

  const canUsePipeline = Boolean(
    pipeline.fileContent && pipeline.recommenderJobId && pipeline.trimmerJobId,
  )

  const handleRecommenderComplete = () => {
    goToPipelineStep('trimmer')
  }

  const handleTrimmerComplete = () => {
    setDataSource('pipeline')
    goToPipelineStep('designer')
  }

  return (
    <section className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mt-0 text-foreground">Multi Loop Control Designer</h2>
          <p className={pageIntro}>
            LLM-enhanced genetic algorithm for multi-loop PID controller design.
            {isPipelineWorkflow && ' Run Recommender, Trimmer, and Designer in one workflow.'}
            {' '}Live optimization opens on the project page.
          </p>
        </div>
        <button type="button" className={btnBase} onClick={goBackFromPipelineStep}>
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel}
        </button>
      </div>

      {isPipelineWorkflow && (
        <MuloPipelineStepIndicator
          step={pipelineStep}
          completedSteps={completedPipelineSteps}
          onStepClick={(step) => {
            const order: MuloPipelineStep[] = ['recommender', 'trimmer', 'designer']
            const targetIndex = order.indexOf(step)
            const currentIndex = order.indexOf(pipelineStep)
            if (step === 'recommender' || completedPipelineSteps.includes(step) || targetIndex <= currentIndex) {
              goToPipelineStep(step)
            }
          }}
        />
      )}

      {error && pipelineStep === 'designer' && <StatusMessage type="error" message={error} />}

      {pipelineStep === 'recommender' && (
        <MuloRecommenderStep onComplete={handleRecommenderComplete} />
      )}

      {pipelineStep === 'trimmer' && (
        <MuloTrimmerStep onComplete={handleTrimmerComplete} />
      )}

      {pipelineStep === 'designer' && (
        <>
          {error && <StatusMessage type="error" message={error} />}

          {stage === 'setup' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mulo-source"
                    checked={dataSource === 'case_study'}
                    onChange={() => setDataSource('case_study')}
                  />
                  Case Study
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mulo-source"
                    checked={dataSource === 'pipeline'}
                    onChange={() => setDataSource('pipeline')}
                    disabled={!canUsePipeline}
                  />
                  From Pipeline (Recommender + Trimmer)
                </label>
              </div>

              {dataSource === 'case_study' ? (
                <label className={fieldLabel}>
                  <span>Case Study</span>
                  <select
                    className={fieldInput}
                    value={selectedCase}
                    onChange={(e) => setSelectedCase(e.target.value)}
                  >
                    {caseStudies.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <StatusMessage
                  type="info"
                  message={`Using pipeline data: ${pipeline.fileName || 'uploaded file'} with chosen controller "${pipeline.handoff?.chosen_controller ?? 'default'}".`}
                />
              )}

              {isPipelineWorkflow && !canUsePipeline && (
                <StatusMessage
                  type="warning"
                  message="Complete Recommender and Trimmer steps above, or select a case study."
                />
              )}

              <ModelSelect
                models={models}
                value={runConfig.llm_model}
                onChange={(llm_model) => setRunConfig((prev) => ({ ...prev, llm_model }))}
                label="LLM Model"
              />

              <MuloAdvancedSettings
                value={runConfig}
                onChange={setRunConfig}
                models={models}
                webSearchModels={webSearchModels}
              />

              <button
                type="button"
                className={`${btnPrimary} ${btnWide}`}
                disabled={loading || (dataSource === 'case_study' && !selectedCase) || (dataSource === 'pipeline' && !canUsePipeline)}
                onClick={() => void initializeDesigner()}
              >
                {loading ? 'Initializing Controller Designer Profile…' : 'Initialize Controller Designer Profile'}
              </button>
            </div>
          )}

          {stage === 'edit_case_study' && designerState && (
            <MuloCaseStudyEditor
              controllerStructure={editorStructure}
              simulationParams={editorSimParams}
              loopIndex={designerState.controller_index}
              onBack={() => setStage('setup')}
              onReset={() => {
                setDesignerState((prev) => {
                  if (!prev) return prev
                  return {
                    ...prev,
                    controller_structure: defaultStructure as unknown as Record<string, unknown>[],
                    case_study: {
                      ...prev.case_study,
                      simulation_params: defaultSimParams,
                    },
                  }
                })
              }}
              onRun={(structure, simulationParams) => void runOptimization(structure, simulationParams)}
              loading={loading}
            />
          )}
        </>
      )}
    </section>
  )
}
