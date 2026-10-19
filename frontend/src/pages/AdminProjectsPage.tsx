import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Activity, FolderKanban, Search, Sparkles, Star, Trash2, TrendingUp } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { ProjectBenchmarkStats, ProjectSummary, UserOption } from '../api/types'
import { AdminDateRangeFilter } from '../components/admin/AdminDateRangeFilter'
import { AdminDownloadCsvButton } from '../components/admin/AdminDownloadCsvButton'
import { AdminPagination } from '../components/admin/AdminPagination'
import { AdminSortHeader } from '../components/admin/AdminSortHeader'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useAdminDateRange } from '../hooks/useAdminDateRange'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useServerPagination } from '../hooks/useServerPagination'
import { useServerSort } from '../hooks/useServerSort'
import { downloadCsv } from '../lib/downloadCsv'
import {
  btnBase,
  btnCompact,
  cardPanel,
  fieldInput,
  fieldLabel,
} from '../lib/classes'
import {
  createdViaBadgeClass,
  createdViaLabel,
  pipelineLabel,
  statusBadgeClass,
} from '../lib/projectLabels'
import { formatDateTime } from '../lib/formatDateTime'

export function AdminProjectsPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:projects')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [benchmarkStats, setBenchmarkStats] = useState<ProjectBenchmarkStats | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query)
  const [userId, setUserId] = useState('')
  const [pipelineFilter, setPipelineFilter] = useState('')
  const dateRange = useAdminDateRange()

  const { sortBy, sortDir, toggle: toggleSort, resetKey: sortResetKey } = useServerSort(
    'updated_at',
    'desc',
  )

  const filterResetKey = `${debouncedQuery}|${userId}|${pipelineFilter}|${dateRange.dateFrom}|${dateRange.dateTo}|${sortResetKey}`

  const pagination = useServerPagination({
    total,
    resetKey: filterResetKey,
  })

  const listParams = useMemo(
    () => ({
      user_id: userId ? Number(userId) : undefined,
      pipeline_type: pipelineFilter || undefined,
      q: debouncedQuery.trim() || undefined,
      ...dateRange.params,
      sort_by: sortBy,
      sort_dir: sortDir,
      page: pagination.page,
      page_size: pagination.pageSize,
    }),
    [
      dateRange.params,
      debouncedQuery,
      pagination.page,
      pagination.pageSize,
      pipelineFilter,
      sortBy,
      sortDir,
      userId,
    ],
  )

  const exportParams = useMemo(
    () => ({
      user_id: userId ? Number(userId) : undefined,
      pipeline_type: pipelineFilter || undefined,
      q: debouncedQuery.trim() || undefined,
      ...dateRange.params,
      sort_by: sortBy,
      sort_dir: sortDir,
    }),
    [dateRange.params, debouncedQuery, pipelineFilter, sortBy, sortDir, userId],
  )

  const benchmarkParams = useMemo(
    () => ({
      user_id: userId ? Number(userId) : undefined,
      pipeline_type: pipelineFilter || undefined,
      q: debouncedQuery.trim() || undefined,
      ...dateRange.params,
    }),
    [dateRange.params, debouncedQuery, pipelineFilter, userId],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const projectPage = await adminApi.listProjects(listParams)
      setProjects(projectPage.items)
      setTotal(projectPage.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [listParams])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    void adminApi
      .getProjectBenchmarkStats(benchmarkParams)
      .then((stats) => {
        if (!cancelled) setBenchmarkStats(stats.total_evaluated > 0 ? stats : null)
      })
      .catch(() => {
        if (!cancelled) setBenchmarkStats(null)
      })
    return () => {
      cancelled = true
    }
  }, [benchmarkParams, canManage])

  useEffect(() => {
    if (!canManage) return
    void adminApi
      .listUserOptions()
      .then(setUserOptions)
      .catch(() => setUserOptions([]))
  }, [canManage])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const handleDelete = async (projectId: number) => {
    if (!window.confirm('Delete this user project? This cannot be undone.')) return
    try {
      await adminApi.deleteProject(projectId)
      await load()
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
                  () => adminApi.downloadProjectsCsv(exportParams),
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
                  () => adminApi.downloadProjectsProfilingCsv(exportParams),
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

      <div className={`${cardPanel} space-y-3`}>
        <div className="grid gap-3 sm:grid-cols-3">
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
              {userOptions.map((u) => (
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
        <AdminDateRangeFilter
          dateFrom={dateRange.dateFrom}
          dateTo={dateRange.dateTo}
          onDateFromChange={dateRange.setDateFrom}
          onDateToChange={dateRange.setDateTo}
          onClear={dateRange.clear}
          fromLabel="Updated from"
          toLabel="Updated to"
        />
      </div>

      {benchmarkStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-xs">
            <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
              <span>Evaluated Designs</span>
              <Activity className="size-4 text-cyan-500" />
            </div>
            <div className="mt-1 font-mono text-2xl font-bold text-foreground">
              {benchmarkStats.total_evaluated}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-text">Completed simulation jobs</p>
          </div>

          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-xs">
            <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
              <span>Avg AI System Score</span>
              <Sparkles className="size-4 text-purple-500" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono text-2xl font-bold text-foreground">
              {benchmarkStats.avg_score !== null
                ? `${(benchmarkStats.avg_score * 100).toFixed(1)}%`
                : '—'}
              {benchmarkStats.success_rate !== null && (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold font-sans">
                  ({benchmarkStats.success_rate.toFixed(0)}% pass)
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
              {benchmarkStats.avg_rating !== null ? benchmarkStats.avg_rating.toFixed(2) : '—'}
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
              {benchmarkStats.alignment_pct !== null
                ? `${benchmarkStats.alignment_pct.toFixed(1)}%`
                : '—'}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-text">Perception correlation index</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-muted-text">Loading projects…</p>
      ) : total === 0 ? (
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
                  <AdminSortHeader
                    label="Project"
                    sortKey="title"
                    activeKey={sortBy}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="px-4 py-3"
                  />
                  <AdminSortHeader
                    label="Owner"
                    sortKey="owner_email"
                    activeKey={sortBy}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="px-4 py-3"
                  />
                  <AdminSortHeader
                    label="Pipeline"
                    sortKey="pipeline_type"
                    activeKey={sortBy}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="px-4 py-3"
                  />
                  <AdminSortHeader
                    label="Status"
                    sortKey="status"
                    activeKey={sortBy}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="px-4 py-3"
                  />
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <AdminSortHeader
                    label="Score"
                    sortKey="score"
                    activeKey={sortBy}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="px-4 py-3"
                  />
                  <AdminSortHeader
                    label="Rating"
                    sortKey="rating"
                    activeKey={sortBy}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="px-4 py-3"
                  />
                  <AdminSortHeader
                    label="Updated"
                    sortKey="updated_at"
                    activeKey={sortBy}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="px-4 py-3"
                  />
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
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
                      <span className={createdViaBadgeClass(project.created_via)}>
                        {createdViaLabel(project.created_via)}
                      </span>
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
