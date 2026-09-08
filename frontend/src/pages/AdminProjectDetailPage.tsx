import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Clock, Coins, Download, Flame, MessageSquare, Trash2 } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { ProjectDetail } from '../api/types'
import { CodePreview } from '../components/CodePreview'
import { ProjectResultsView } from '../components/ProjectResultsView'
import { ScoreReportBadge } from '../components/ScoreReportBadge'
import { StatusMessage } from '../components/StatusMessage'
import { btnBase, btnCompact, btnPrimary, cardPanel } from '../lib/classes'
import { pipelineLabel, statusBadgeClass } from '../lib/projectLabels'

export function AdminProjectDetailPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const id = Number(projectId)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
        setProject(await adminApi.getProject(id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [id])

  const handleDelete = async () => {
    if (!project) return
    if (!window.confirm('Delete this user project? This cannot be undone.')) return
    try {
      await adminApi.deleteProject(project.id)
      navigate('/admin/projects', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  if (loading) {
    return <p className="text-muted-text">Loading project…</p>
  }

  if (!project) {
    return (
      <div className="space-y-4">
        {error && <StatusMessage type="error" message={error} />}
        <Link to="/admin/projects" className={btnBase}>
          <ArrowLeft className="size-4" />
          Back
        </Link>
      </div>
    )
  }

  const downloadName = project.file_name || `project-${project.id}.py`
  const sm = project.session_metadata
  const tokens = sm?.tokens
  const totalTokens =
    typeof tokens?.total === 'number'
      ? tokens.total
      : typeof (tokens as any)?.total_tokens === 'number'
      ? (tokens as any).total_tokens
      : null
  const costUsd = typeof sm?.cost_usd === 'number' ? sm.cost_usd : null
  const wallClockTime =
    typeof sm?.wall_clock_time_s === 'number'
      ? sm.wall_clock_time_s
      : typeof (sm as any)?.wall_clock_time_seconds === 'number'
      ? (sm as any).wall_clock_time_seconds
      : null
  const errorCounts = typeof sm?.error_counts === 'number' ? sm.error_counts : null

  const userComment =
    project.design_grade?.comment ??
    (project.results?.design_grade as any)?.comment ??
    null
  const userRating =
    project.rating ??
    project.design_grade?.rating ??
    (project.results?.design_grade as any)?.rating ??
    null

  return (
    <div className="admin-fade-in space-y-6">
      <Link to="/admin/projects" className={`${btnBase} ${btnCompact} w-fit`}>
        <ArrowLeft className="size-3.5" />
        All projects
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground">
            {project.title}
          </h1>
          <p className="m-0 text-muted-text">
            Owner: {project.owner_email ?? `user #${project.user_id}`} ·{' '}
            {pipelineLabel(project.pipeline_type)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={statusBadgeClass(project.status)}>{project.status}</span>
            {(project.score !== undefined || userRating !== null || project.success !== undefined) && (
              <ScoreReportBadge
                moduleType={
                  project.pipeline_type === 'adaptiveDesign'
                    ? 'adaptive'
                    : project.pipeline_type === 'mpcDesign'
                    ? 'mpc'
                    : 'project'
                }
                projectId={project.id}
                jobId={project.job_id}
                score={project.score}
                success={project.success}
                rating={userRating}
                comment={userComment}
                sessionMetadata={project.session_metadata}
                readOnly={true}
                compact
              />
            )}
          </div>
        </div>
        <button type="button" className={btnBase} onClick={() => void handleDelete()}>
          <Trash2 className="size-3.5" />
          Delete
        </button>
      </header>

      {error && <StatusMessage type="error" message={error} />}

      {/* Greenfield Session Telemetry & Deliverables Card */}
      {sm && (
        <div className={cardPanel}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="m-0 text-base font-semibold text-foreground">
              Execution Telemetry &amp; Session Metrics
            </h2>
            {userRating && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                ★ User Rating: {userRating}/5
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border border-border bg-surface-muted p-3">
              <span className="text-muted-text flex items-center gap-1 font-medium">
                <Clock className="size-3.5 text-cyan-500" /> Wall Clock Time
              </span>
              <div className="mt-1 font-mono text-base font-bold text-foreground">
                {wallClockTime !== null ? `${wallClockTime.toFixed(2)}s` : '—'}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface-muted p-3">
              <span className="text-muted-text flex items-center gap-1 font-medium">
                <Flame className="size-3.5 text-purple-500" /> Total LLM Tokens
              </span>
              <div className="mt-1 font-mono text-base font-bold text-foreground">
                {totalTokens !== null ? totalTokens.toLocaleString() : '—'}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface-muted p-3">
              <span className="text-muted-text flex items-center gap-1 font-medium">
                <Coins className="size-3.5 text-amber-500" /> Cost (USD)
              </span>
              <div className="mt-1 font-mono text-base font-bold text-amber-600 dark:text-amber-400">
                {costUsd !== null ? `$${costUsd.toFixed(4)}` : '—'}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface-muted p-3">
              <span className="text-muted-text flex items-center gap-1 font-medium">
                Errors Logged
              </span>
              <div className="mt-1 font-mono text-base font-bold text-foreground">
                {errorCounts !== null ? errorCounts : 0}
              </div>
            </div>
          </div>

          {userComment && (
            <div className="mt-3.5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">
                <MessageSquare className="size-3.5 text-amber-500" />
                Engineering Feedback / User Notes:
              </div>
              <p className="m-0 text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                {userComment}
              </p>
            </div>
          )}
        </div>
      )}

      {!sm && userComment && (
        <div className={cardPanel}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">
            <MessageSquare className="size-3.5 text-amber-500" />
            Engineering Feedback / User Notes:
          </div>
          <p className="m-0 text-xs text-foreground whitespace-pre-wrap leading-relaxed">
            {userComment}
          </p>
        </div>
      )}

      <div className={cardPanel}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-semibold text-foreground">Uploaded file</h2>
            <p className="mt-1 mb-0 text-sm text-muted-text">
              {project.file_name || 'Untitled'} ({project.file_type})
            </p>
          </div>
          {project.file_url ? (
            <a
              href={project.file_url}
              download={downloadName}
              target="_blank"
              rel="noreferrer"
              className={`${btnPrimary} ${btnCompact}`}
            >
              <Download className="size-3.5" />
              Download file
            </a>
          ) : null}
        </div>
        <CodePreview value={project.file_content || '# No file content'} readOnly />
      </div>

      <div className={cardPanel}>
        <h2 className="m-0 mb-2 text-lg font-semibold text-foreground">Results</h2>
        <ProjectResultsView
          pipelineType={project.pipeline_type}
          results={project.results}
          projectId={project.id}
          jobId={project.job_id}
          artifactScope="admin"
        />
      </div>
    </div>
  )
}
