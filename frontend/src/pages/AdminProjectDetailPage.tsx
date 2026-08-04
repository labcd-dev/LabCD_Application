import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Trash2 } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { ProjectDetail } from '../api/types'
import { CodePreview } from '../components/CodePreview'
import { ProjectResultsView } from '../components/ProjectResultsView'
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
          <span className={statusBadgeClass(project.status)}>{project.status}</span>
        </div>
        <button type="button" className={btnBase} onClick={() => void handleDelete()}>
          <Trash2 className="size-3.5" />
          Delete
        </button>
      </header>

      {error && <StatusMessage type="error" message={error} />}

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
