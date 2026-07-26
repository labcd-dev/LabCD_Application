import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Pencil,
  Play,
  Save,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { healthApi, projectsApi, regularizerApi, uploadApi } from '../api/endpoints'
import { CodePreview } from '../components/CodePreview'
import { FileUpload } from '../components/FileUpload'
import { ModelSelect } from '../components/ModelSelect'
import { PipelineSelector } from '../components/PipelineSelector'
import { ProcessingCard } from '../components/ProcessingCard'
import { SetupStepIndicator, type SetupStepId } from '../components/SetupStepIndicator'
import { StatusMessage } from '../components/StatusMessage'
import { usePipeline } from '../context/PipelineContext'
import {
  btnBase,
  btnPrimary,
  btnWide,
  cardPanel,
  pageIntro,
  pageSection,
} from '../lib/classes'

type Stage = 'upload' | 'processing' | 'result' | 'standardizing' | 'ready'

export function HomePage() {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const [stage, setStage] = useState<Stage>('upload')
  const [models, setModels] = useState<string[]>(['gpt-4o'])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editMode, setEditMode] = useState(false)

  useEffect(() => {
    pipeline.reset()
    setStage('upload')
    setEditMode(false)
    setError(null)
    // Fresh studio session only — do not resume another project's workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset once on mount
  }, [])

  useEffect(() => {
    healthApi.models().then((res) => setModels(res.llm_models)).catch(() => {})
  }, [])

  const handleFileSelect = async (file: File) => {
    setError(null)
    setLoading(true)
    try {
      const uploaded = await uploadApi.upload(file)
      pipeline.setFile(uploaded.file_name, uploaded.file_type, uploaded.file_content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const runRegularizer = async () => {
    if (!pipeline.fileContent) return
    setLoading(true)
    setError(null)
    setStage('processing')
    try {
      const result = await regularizerApi.regularize({
        file_content: pipeline.fileContent,
        file_name: pipeline.fileName,
        file_type: pipeline.fileType,
        model: pipeline.model,
      })
      pipeline.setRegularizeResult(
        result.file_content,
        result.change_applied,
        result.human_intervention,
      )
      if (!result.change_applied) {
        setStage('standardizing')
        const standardized = await regularizerApi.standardize({
          file_content: result.file_content,
          model: pipeline.model,
          silo_pipeline: pipeline.pipeline === 'siloDesign',
        })
        pipeline.updateFileContent(standardized.file_content)
        setStage('ready')
      } else {
        setStage('result')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regularization failed')
      setStage('upload')
    } finally {
      setLoading(false)
    }
  }

  const runStandardize = async () => {
    setLoading(true)
    setError(null)
    setStage('standardizing')
    try {
      const result = await regularizerApi.standardize({
        file_content: pipeline.fileContent,
        model: pipeline.model,
        silo_pipeline: pipeline.pipeline === 'siloDesign',
      })
      pipeline.updateFileContent(result.file_content)
      setStage('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Standardization failed')
      setStage('result')
    } finally {
      setLoading(false)
    }
  }

  const proceedToPipeline = async () => {
    if (!pipeline.pipeline || !pipeline.fileContent) return
    setLoading(true)
    setError(null)
    try {
      const project = await projectsApi.create({
        title: pipeline.fileName || undefined,
        pipeline_type: pipeline.pipeline,
        file_name: pipeline.fileName,
        file_type: pipeline.fileType,
        file_content: pipeline.fileContent,
        llm_model: pipeline.model,
      })
      pipeline.setProjectId(project.id)
      if (pipeline.pipeline === 'muloDesign') {
        navigate('/mulo?step=recommender')
      } else if (pipeline.pipeline === 'siloDesign') {
        navigate('/silo')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  const goBackToUpload = () => {
    setEditMode(false)
    setError(null)
    setStage('upload')
  }

  const goBackFromReady = () => {
    setEditMode(false)
    setError(null)
    setStage(pipeline.changeApplied ? 'result' : 'upload')
  }

  const handleSetupStepClick = (step: SetupStepId) => {
    if (stage === 'processing' || stage === 'standardizing') return
    if (step === 'upload') {
      goBackToUpload()
      return
    }
    if (step === 'process' && (stage === 'result' || stage === 'ready') && pipeline.changeApplied) {
      setEditMode(false)
      setStage('result')
      return
    }
    if (step === 'ready' && stage === 'ready') {
      return
    }
  }

  const nextLabel =
    pipeline.pipeline === 'muloDesign' ? 'Multi Loop Designer' : 'Silo Designer'

  return (
    <section className={pageSection}>
      <header className="setup-hero setup-animate-in">
        <div className="setup-hero__icon-wrap" aria-hidden>
          <Settings2 className="setup-hero__icon" />
        </div>
        <div className="setup-hero__content">
          <h2 className="setup-hero__title">Control Design Setup</h2>
          <p className={`${pageIntro} setup-hero__intro`}>
            Upload a system definition file, choose a pipeline, and start the design process.
          </p>
        </div>
      </header>

      <SetupStepIndicator stage={stage} onStepClick={handleSetupStepClick} />

      {error && <StatusMessage type="error" message={error} />}

      {stage === 'upload' && (
        <div className="setup-stage setup-animate-in">
          <div className={`${cardPanel} setup-panel`}>
            <div className="grid grid-cols-[2fr_1fr] gap-4 max-md:grid-cols-1">
              <FileUpload onFileSelect={handleFileSelect} disabled={loading} />
              <ModelSelect
                models={models}
                value={pipeline.model}
                onChange={pipeline.setModel}
                disabled={Boolean(pipeline.projectId)}
                hint={
                  pipeline.projectId
                    ? 'Locked for this project. Start a new setup to choose a different model.'
                    : undefined
                }
              />
            </div>

            {pipeline.fileContent && (
              <StatusMessage
                type="success"
                message={`File loaded: ${pipeline.fileName} (${pipeline.fileType})`}
              />
            )}

            <PipelineSelector
              value={pipeline.pipeline}
              onChange={pipeline.setPipeline}
            />

            {pipeline.pipeline && pipeline.fileContent && (
              <button
                type="button"
                className={`${btnPrimary} ${btnWide} setup-cta`}
                disabled={loading}
                onClick={() => void runRegularizer()}
              >
                <Play className="size-4" aria-hidden />
                Start Process
              </button>
            )}
          </div>
        </div>
      )}

      {stage === 'processing' && (
        <ProcessingCard
          icon={Cpu}
          title="Processing file..."
          description="Evaluating syntax and fixing errors via API."
        />
      )}

      {stage === 'standardizing' && (
        <ProcessingCard
          icon={Sparkles}
          title="Standardizing code..."
          description="Generating standard format Python file via API."
        />
      )}

      {stage === 'result' && pipeline.changeApplied && (
        <div className="setup-stage setup-animate-in">
          <div className={`${cardPanel} setup-panel`}>
            <h3 className="setup-panel__heading">
              <Cpu className="size-5 text-primary" aria-hidden />
              Code Pre-Processing Result
            </h3>

            {pipeline.fileType === 'matlab' && (
              <StatusMessage type="success" message="MATLAB file converted to Python." />
            )}
            {pipeline.changeApplied && !pipeline.humanIntervention && (
              <StatusMessage type="success" message="Syntax errors auto-repaired." />
            )}
            {pipeline.humanIntervention && (
              <StatusMessage
                type="warning"
                message="Automated fixer could not resolve all syntax issues. Review and edit the code."
              />
            )}

            {!editMode ? (
              <>
                <CodePreview
                  value={pipeline.fileContent}
                  readOnly
                  language={pipeline.fileType === 'matlab' ? 'matlab' : 'python'}
                />
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                  <button type="button" className={btnBase} onClick={goBackToUpload}>
                    <ArrowLeft className="size-4" aria-hidden />
                    Back
                  </button>
                  <button type="button" className={btnBase} onClick={() => setEditMode(true)}>
                    <Pencil className="size-4" aria-hidden />
                    Edit Code
                  </button>
                  <button type="button" className={`${btnPrimary} max-sm:w-full`} onClick={() => void runStandardize()}>
                    <Sparkles className="size-4" aria-hidden />
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <CodePreview
                  value={pipeline.fileContent}
                  onChange={pipeline.updateFileContent}
                  language={pipeline.fileType === 'matlab' ? 'matlab' : 'python'}
                />
                <div className="flex gap-3 flex-wrap mt-4">
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => setEditMode(false)}
                  >
                    <Save className="size-4" aria-hidden />
                    Save Changes
                  </button>
                  <button type="button" className={btnBase} onClick={() => setEditMode(false)}>
                    <X className="size-4" aria-hidden />
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {stage === 'ready' && (
        <div className="setup-stage setup-animate-in">
          <div className={`${cardPanel} setup-panel setup-panel--ready`}>
            <div className="setup-ready-banner" role="status">
              <CheckCircle2 className="setup-ready-banner__icon" aria-hidden />
              <div>
                <p className="setup-ready-banner__title">File is ready</p>
                <p className="setup-ready-banner__text">
                  Your system definition is standardized and ready for the selected pipeline.
                </p>
              </div>
            </div>

            <CodePreview
              value={pipeline.fileContent}
              readOnly
              height={300}
              language={pipeline.fileType === 'matlab' ? 'matlab' : 'python'}
            />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
              <button type="button" className={btnBase} onClick={goBackFromReady}>
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </button>
              <button
                type="button"
                className={`${btnPrimary} w-full setup-cta sm:mt-0 sm:w-auto`}
                onClick={() => void proceedToPipeline()}
              >
                Continue to {nextLabel}
                <ArrowRight className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
