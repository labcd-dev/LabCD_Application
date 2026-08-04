import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, RotateCcw } from 'lucide-react'
import { projectsApi, muloApi } from '../api/endpoints'
import type { ProjectDetail } from '../api/types'
import { CodePreview } from '../components/CodePreview'
import { MuloLiveRunPanel } from '../components/MuloLiveRunPanel'
import { ProjectResultsView } from '../components/ProjectResultsView'
import { SiloLiveRunPanel } from '../components/SiloLiveRunPanel'
import { StatusMessage } from '../components/StatusMessage'
import { usePipeline } from '../context/PipelineContext'
import { useFeedbackSurveyPrompt } from '../hooks/useFeedbackSurveyPrompt'
import { usePoll } from '../hooks/usePoll'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldInput,
  fieldLabel,
  pageIntro,
  pageSection,
} from '../lib/classes'
import { pipelineLabel, statusBadgeClass } from '../lib/projectLabels'
import { canRetryProject, retryProject } from '../lib/retryProject'

export function ProjectDetailPage() {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const { projectId } = useParams()
  const id = Number(projectId)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [muloAwaitingContinue, setMuloAwaitingContinue] = useState(false)
  const { promptAfterDesignSuccess, feedbackModal } = useFeedbackSurveyPrompt()
  const prevStatusRef = useRef<string | null>(null)

  const refreshProject = useCallback(async () => {
    if (!Number.isFinite(id)) return null
    const detail = await projectsApi.get(id)
    setProject(detail)
    setTitle(detail.title)
    return detail
  }, [id])

  useEffect(() => {
    setMuloAwaitingContinue(false)
    prevStatusRef.current = null
  }, [id])

  useEffect(() => {
    if (!project || project.pipeline_type !== 'muloDesign' || !project.job_id) return
    if (project.status === 'running') return
    if (project.status !== 'completed') return
    const jobId = project.job_id
    let active = true
    void muloApi
      .state(jobId)
      .then((state) => {
        if (active && !state.is_complete) {
          setMuloAwaitingContinue(true)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [project?.id, project?.status, project?.job_id, project?.pipeline_type])

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setError('Invalid project id')
      setLoading(false)
      return
    }
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        await refreshProject()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [id, refreshProject])

  const isLive =
    project?.status === 'running'
    && Boolean(project.job_id)
    && !(
      project.results
      && typeof project.results === 'object'
      && !Array.isArray(project.results)
      && 'trimmer' in project.results
    )

  const fetchWhileRunning = useCallback(async () => {
    if (!Number.isFinite(id)) return null
    return projectsApi.get(id)
  }, [id])

  const projectPoll = usePoll(
    fetchWhileRunning,
    4000,
    Boolean(isLive || muloAwaitingContinue),
  )

  useEffect(() => {
    if (!projectPoll.data) return
    setProject(projectPoll.data)
    setTitle(projectPoll.data.title)
    if (projectPoll.data.status === 'running') {
      setMuloAwaitingContinue(false)
    }
  }, [projectPoll.data])

  useEffect(() => {
    if (project?.status === 'running') {
      setMuloAwaitingContinue(false)
    }
  }, [project?.status])

  // Keep the survey modal on this page: live panels unmount when status becomes
  // completed, which previously discarded the prompt mid-flight.
  useEffect(() => {
    if (!project) return
    const prev = prevStatusRef.current
    prevStatusRef.current = project.status
    if (prev === 'running' && project.status === 'completed') {
      if (project.pipeline_type === 'siloDesign') {
        void promptAfterDesignSuccess('siloDesign')
      }
      // Multi-loop prompts from MuloLiveRunPanel only when all cascades finish.
    }
  }, [project, promptAfterDesignSuccess])

  const handleRunTerminal = useCallback(() => {
    void refreshProject().catch(() => {})
  }, [refreshProject])

  const handleAwaitingContinue = useCallback((awaiting: boolean) => {
    setMuloAwaitingContinue(awaiting)
  }, [])

  const saveTitle = async () => {
    if (!project || !title.trim()) return
    try {
      const updated = await projectsApi.update(project.id, { title: title.trim() })
      setProject(updated)
      setRenaming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename project')
    }
  }

  const handleRetry = async () => {
    if (!project || !canRetryProject(project.status)) return
    setRetrying(true)
    setError(null)
    try {
      await retryProject(project, pipeline, navigate)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry project')
      setRetrying(false)
    }
  }

  if (loading) {
    return <p className="text-muted-text">Loading project…</p>
  }

  if (!project) {
    return (
      <section className={pageSection}>
        {error && <StatusMessage type="error" message={error} />}
        <Link to="/projects" className={btnBase}>
          <ArrowLeft className="size-4" />
          Back to projects
        </Link>
      </section>
    )
  }

  const liveJobId = project.job_id
  const hasTrimmerResults = Boolean(
    project.results
    && typeof project.results === 'object'
    && !Array.isArray(project.results)
    && 'trimmer' in project.results,
  )
  const showSiloLive =
    project.pipeline_type === 'siloDesign' && project.status === 'running' && Boolean(liveJobId)
  const showMuloLive =
    project.pipeline_type === 'muloDesign'
    && Boolean(liveJobId)
    && !hasTrimmerResults
    && (project.status === 'running' || muloAwaitingContinue)
  const showResults = !showSiloLive && !showMuloLive

  return (
    <section className={pageSection}>
      {feedbackModal}
      <Link to="/projects" className={`${btnBase} ${btnCompact} w-fit`}>
        <ArrowLeft className="size-3.5" />
        All projects
      </Link>

      <header className="space-y-3">
        {renaming ? (
          <label className={fieldLabel}>
            <span>Title</span>
            <div className="flex flex-wrap gap-2">
              <input
                className={`${fieldInput} min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[200px]`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button type="button" className={btnPrimary} onClick={() => void saveTitle()}>
                Save
              </button>
              <button type="button" className={btnBase} onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </div>
          </label>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <h2 className="m-0 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {project.title}
              </h2>
              <p className={`${pageIntro} m-0`}>
                {pipelineLabel(project.pipeline_type)} · Updated{' '}
                {new Date(project.updated_at).toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-2">
                <span className={statusBadgeClass(project.status)}>{project.status}</span>
                {project.llm_model ? (
                  <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-muted-text font-mono">
                    {project.llm_model}
                  </span>
                ) : null}
                {project.job_id ? (
                  <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-muted-text font-mono">
                    job {project.job_id.slice(0, 8)}…
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {canRetryProject(project.status) && !muloAwaitingContinue && (
                <button
                  type="button"
                  className={`${btnPrimary} max-sm:flex-1`}
                  disabled={retrying}
                  onClick={() => void handleRetry()}
                >
                  <RotateCcw className="size-3.5" />
                  {retrying ? 'Opening…' : 'Retry Project'}
                </button>
              )}
              <button type="button" className={`${btnBase} max-sm:flex-1`} onClick={() => setRenaming(true)}>
                <Pencil className="size-3.5" />
                Rename
              </button>
            </div>
          </div>
        )}
      </header>

      {error && <StatusMessage type="error" message={error} />}

      {project.control_objective ? (
        <div className={cardPanel}>
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted">
            Control objective
          </h3>
          <p className="mt-2 mb-0 text-foreground whitespace-pre-wrap">{project.control_objective}</p>
        </div>
      ) : null}

      {(showSiloLive || showMuloLive) && (
        <div className={cardPanel}>
          <h3 className="m-0 mb-2 text-lg font-semibold text-foreground">
            {project.status === 'running' ? 'Running' : 'Design progress'}
          </h3>
          <p className="mt-0 mb-3 text-sm text-muted-text">
            Live status, plots, and logs for this project. You can start another project from Studio
            while this one continues.
          </p>
          {showSiloLive && liveJobId && (
            <SiloLiveRunPanel
              jobId={liveJobId}
              onTerminal={handleRunTerminal}
              onDesignSuccess={() => void promptAfterDesignSuccess('siloDesign')}
            />
          )}
          {showMuloLive && liveJobId && (
            <MuloLiveRunPanel
              jobId={liveJobId}
              onTerminal={handleRunTerminal}
              onAwaitingContinueChange={handleAwaitingContinue}
              onDesignSuccess={() => void promptAfterDesignSuccess('muloDesign')}
            />
          )}
        </div>
      )}

      <div className={cardPanel}>
        <h3 className="m-0 mb-2 text-lg font-semibold text-foreground">Uploaded file</h3>
        <p className="mt-0 mb-3 text-sm text-muted-text">
          {project.file_name || 'Untitled'} ({project.file_type})
        </p>
        <CodePreview value={project.file_content || '# No file content stored'} readOnly />
      </div>

      {showResults && (
        <div className={cardPanel}>
          <h3 className="m-0 mb-2 text-lg font-semibold text-foreground">Results</h3>
          <p className="mt-0 mb-3 text-sm text-muted-text">
            Snapshot saved when the design job finished (or last update).
          </p>
          <ProjectResultsView
            pipelineType={project.pipeline_type}
            results={project.results}
            projectId={project.id}
            jobId={project.job_id}
          />
        </div>
      )}
    </section>
  )
}
