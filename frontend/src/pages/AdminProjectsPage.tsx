import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Activity, FolderKanban, Search, Sparkles, Star, Trash2, TrendingUp } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { AuthUser, ProjectSummary } from '../api/types'
import { AdminDownloadCsvButton } from '../components/admin/AdminDownloadCsvButton'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
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
import { formatDateTime } from '../lib/formatDateTime'

export function AdminProjectsPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:projects')
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
      const projectList = await adminApi.listProjects({
        user_id: userId ? Number(userId) : undefined,
        pipeline_type: pipelineFilter || undefined,
      })
      setProjects(projectList)
      try {
        setUsers(await adminApi.listUsers())
      } catch {
        setUsers([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [userId, pipelineFilter, canManage])

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

  const benchmarkStats = useMemo(() => {
    const evaluated = projects.filter(
      (p) =>
        (typeof p.score === 'number' && Number.isFinite(p.score)) ||
        (typeof p.rating === 'number' && p.rating > 0),
    )
    if (evaluated.length === 0) return null

    const scored = evaluated.filter((p) => typeof p.score === 'number' && Number.isFinite(p.score))
    const rated = evaluated.filter((p) => typeof p.rating === 'number' && p.rating > 0)

    const avgScore =
      scored.length > 0
        ? scored.reduce((acc, p) => acc + (p.score as number), 0) / scored.length
        : null

    const avgRating =
      rated.length > 0
        ? rated.reduce((acc, p) => acc + (p.rating as number), 0) / rated.length
        : null

    let alignmentPct: number | null = null
    if (avgScore !== null && avgRating !== null) {
      const diff = Math.abs(avgScore - avgRating / 5)
      alignmentPct = Math.max(0, Math.min(100, (1 - diff) * 100))
    }

    const successCount = scored.filter((p) => p.success === true).length

    return {
      totalEvaluated: evaluated.length,
      avgScore,
      avgRating,
      alignmentPct,
      successRate: scored.length > 0 ? (successCount / scored.length) * 100 : null,
    }
  }, [projects])

  const pagination = useClientPagination(filtered, {
    resetKey: `${query}|${userId}|${pipelineFilter}`,
  })

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

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
            <option value="adaptiveDesign">Adaptive Control</option>
            <option value="mpcDesign">Agentic MPC</option>
          </select>
        </label>
      </div>

      {/* AI System Benchmark vs Human Rating Alignment Overview */}
      {benchmarkStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-xs">
            <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
              <span>Evaluated Designs</span>
              <Activity className="size-4 text-cyan-500" />
            </div>
            <div className="mt-1 font-mono text-2xl font-bold text-foreground">
              {benchmarkStats.totalEvaluated}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-text">Completed simulation jobs</p>
          </div>

          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-xs">
            <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
              <span>Avg AI System Score</span>
              <Sparkles className="size-4 text-purple-500" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono text-2xl font-bold text-foreground">
              {benchmarkStats.avgScore !== null ? `${(benchmarkStats.avgScore * 100).toFixed(1)}%` : '—'}
              {benchmarkStats.successRate !== null && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold font-sans">
                  ({benchmarkStats.successRate.toFixed(0)}% pass)
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-text">Lyapunov / tracking score</p>
          </div>

          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-xs">
            <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
              <span>Avg Human Rating</span>
              <Star className="size-4 fill-amber-400 text-amber-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono text-2xl font-bold text-amber-600 dark:text-amber-400">
              {benchmarkStats.avgRating !== null ? benchmarkStats.avgRating.toFixed(2) : '—'}
              <span className="text-xs text-muted font-normal">/ 5.0</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-text">Engineer satisfaction grades</p>
          </div>

          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-xs">
            <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
              <span>AI vs Human Alignment</span>
              <TrendingUp className="size-4 text-emerald-500" />
            </div>
            <div className="mt-1 flex items-baseline gap-1 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {benchmarkStats.alignmentPct !== null ? `${benchmarkStats.alignmentPct.toFixed(1)}%` : '—'}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-text">Perception correlation index</p>
          </div>
        </div>
      )}

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
                  <th className="px-4 py-3 font-semibold">Score</th>
                  <th className="px-4 py-3 font-semibold">Rating</th>
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
                    <td className="px-4 py-3">
                      {project.score !== undefined && project.score !== null ? (
                        <div className="flex items-center gap-1.5 font-mono text-xs font-bold">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] ${
                              project.score >= 0.8
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : project.score >= 0.5
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {(project.score * 100).toFixed(0)}%
                          </span>
                          {project.success !== undefined && project.success !== null && (
                            <span className="text-[10px] text-muted-text font-normal">
                              ({project.success ? 'Success' : 'Failed'})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {project.rating && project.rating > 0 ? (
                        <div className="flex items-center gap-1 text-amber-500 font-mono text-xs">
                          <Star className="size-3.5 fill-amber-400 text-amber-400" />
                          <span className="font-bold">{project.rating}.0</span>
                        </div>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-text">
                      {formatDateTime(project.updated_at)}
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
