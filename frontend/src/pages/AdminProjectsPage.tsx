import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban, Search, Trash2 } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { AuthUser, ProjectSummary } from '../api/types'
import { AdminDownloadCsvButton } from '../components/admin/AdminDownloadCsvButton'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
import { useClientPagination } from '../hooks/useClientPagination'
import { downloadCsv } from '../lib/downloadCsv'
import {
  btnBase,
  btnCompact,
  cardPanel,
  fieldInput,
  fieldLabel,
} from '../lib/classes'
import { pipelineLabel, statusBadgeClass } from '../lib/projectLabels'

export function AdminProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [users, setUsers] = useState<AuthUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [userId, setUserId] = useState('')
  const [pipelineFilter, setPipelineFilter] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [projectList, userList] = await Promise.all([
        adminApi.listProjects({
          user_id: userId ? Number(userId) : undefined,
          pipeline_type: pipelineFilter || undefined,
        }),
        adminApi.listUsers(),
      ])
      setProjects(projectList)
      setUsers(userList)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [userId, pipelineFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.file_name.toLowerCase().includes(q) ||
        (p.owner_email ?? '').toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q),
    )
  }, [projects, query])

  const pagination = useClientPagination(filtered, {
    resetKey: `${query}|${userId}|${pipelineFilter}`,
  })

  const handleDelete = async (projectId: number) => {
    if (!window.confirm('Delete this user project? This cannot be undone.')) return
    try {
      await adminApi.deleteProject(projectId)
      setProjects((prev) => prev.filter((p) => p.id !== projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  return (
    <div className="admin-fade-in space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Administration
          </p>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Projects
          </h1>
          <p className="m-0 max-w-xl text-muted-text leading-relaxed">
            View and manage design projects created by users (uploaded files and saved results).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminDownloadCsvButton
            onClick={async () => {
              setError(null)
              try {
                await downloadCsv(
                  () =>
                    adminApi.downloadProjectsCsv({
                      user_id: userId ? Number(userId) : undefined,
                      pipeline_type: pipelineFilter || undefined,
                    }),
                  'projects.csv',
                )
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to download CSV')
              }
            }}
            disabled={loading}
          />
          <AdminDownloadCsvButton
            label="Download profiling CSV"
            onClick={async () => {
              setError(null)
              try {
                await downloadCsv(
                  () =>
                    adminApi.downloadProjectsProfilingCsv({
                      user_id: userId ? Number(userId) : undefined,
                      pipeline_type: pipelineFilter || undefined,
                    }),
                  'project_profiling.csv',
                )
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : 'Failed to download profiling CSV',
                )
              }
            }}
            disabled={loading}
          />
        </div>
      </header>

      {error && <StatusMessage type="error" message={error} />}

      <div className={`${cardPanel} grid gap-3 sm:grid-cols-3`}>
        <div className="relative sm:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-[2.35rem] size-4 text-muted" />
          <label className={fieldLabel}>
            <span>Search</span>
            <input
              className={`${fieldInput} pl-9`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title, owner, file…"
            />
          </label>
        </div>
        <label className={fieldLabel}>
          <span>Owner</span>
          <select
            className={fieldInput}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabel}>
          <span>Pipeline</span>
          <select
            className={fieldInput}
            value={pipelineFilter}
            onChange={(e) => setPipelineFilter(e.target.value)}
          >
            <option value="">All</option>
            <option value="siloDesign">Single Loop</option>
            <option value="muloDesign">Multi Loop</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-muted-text">Loading projects…</p>
      ) : filtered.length === 0 ? (
        <div className={`${cardPanel} text-center`}>
          <FolderKanban className="mx-auto mb-3 size-10 text-muted" />
          <p className="m-0 font-medium text-foreground">No projects found</p>
          <p className="mt-1 mb-0 text-sm text-muted-text">
            Projects appear here after users start Single or Multi Loop designs.
          </p>
        </div>
      ) : (
        <div className={`${cardPanel} space-y-3`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Owner</th>
                  <th className="px-4 py-3 font-semibold">Pipeline</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagination.pageItems.map((project) => (
                  <tr key={project.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{project.title}</div>
                      <div className="text-xs text-muted-text">{project.file_name || 'No file'}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-text">{project.owner_email ?? `#${project.user_id}`}</td>
                    <td className="px-4 py-3">{pipelineLabel(project.pipeline_type)}</td>
                    <td className="px-4 py-3">
                      <span className={statusBadgeClass(project.status)}>{project.status}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-text">
                      {new Date(project.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link
                          to={`/admin/projects/${project.id}`}
                          className={`${btnBase} ${btnCompact}`}
                        >
                          View
                        </Link>
                        {project.file_url ? (
                          <a
                            href={project.file_url}
                            download={project.file_name || `project-${project.id}.py`}
                            target="_blank"
                            rel="noreferrer"
                            className={`${btnBase} ${btnCompact}`}
                            title="Download uploaded file"
                          >
                            File
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className={`${btnBase} ${btnCompact}`}
                          onClick={() => void handleDelete(project.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminPagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            from={pagination.from}
            to={pagination.to}
            onPageChange={pagination.setPage}
          />
        </div>
      )}
    </div>
  )
}
