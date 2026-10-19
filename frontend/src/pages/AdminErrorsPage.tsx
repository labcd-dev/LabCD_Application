import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { ErrorEvent, ErrorTrackingSettings } from '../api/types'
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
  fieldCheckbox,
  fieldInput,
  fieldLabel,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'
import {
  installGlobalErrorHandlers,
  setErrorTrackingConfig,
} from '../lib/errorTracking'
import { formatDateTime } from '../lib/formatDateTime'

const emptySettings: ErrorTrackingSettings = {
  enabled: false,
  frontend: false,
  backend: false,
  api: false,
}

export function AdminErrorsPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:errors')
  const [settings, setSettings] = useState<ErrorTrackingSettings>(emptySettings)
  const [events, setEvents] = useState<ErrorEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [source, setSource] = useState('')
  const [statusCode, setStatusCode] = useState('')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query)
  const [total, setTotal] = useState(0)
  const dateRange = useAdminDateRange()
  const { sortBy, sortDir, toggle: toggleSort, resetKey: sortResetKey } = useServerSort(
    'created_at',
    'desc',
  )
  const pagination = useServerPagination({
    total,
    resetKey: `${source}|${statusCode}|${debouncedQuery}|${dateRange.dateFrom}|${dateRange.dateTo}|${sortResetKey}`,
  })

  useEffect(() => {
    if (!canManage) return
    void adminApi.getErrorTrackingSettings().then((nextSettings) => {
      setSettings(nextSettings)
      setErrorTrackingConfig(nextSettings)
      if (nextSettings.enabled && nextSettings.frontend) {
        installGlobalErrorHandlers()
      }
    }).catch(() => {
      /* settings load failure is non-fatal for the list */
    })
  }, [canManage])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const statusFilter = statusCode.trim() ? Number(statusCode) : undefined
      const page = await adminApi.listErrors({
        source: source || undefined,
        status_code: Number.isFinite(statusFilter) ? statusFilter : undefined,
        q: debouncedQuery.trim() || undefined,
        ...dateRange.params,
        sort_by: sortBy,
        sort_dir: sortDir,
        page: pagination.page,
        page_size: pagination.pageSize,
      })
      setEvents(page.items)
      setTotal(page.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load errors')
    } finally {
      setLoading(false)
    }
  }, [
    dateRange.params,
    debouncedQuery,
    pagination.page,
    pagination.pageSize,
    sortBy,
    sortDir,
    source,
    statusCode,
  ])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  const filteredHint = useMemo(() => {
    const parts: string[] = []
    if (source) parts.push(`source=${source}`)
    if (statusCode.trim()) parts.push(`status=${statusCode.trim()}`)
    if (query.trim()) parts.push(`q="${query.trim()}"`)
    if (dateRange.dateFrom) parts.push(`from=${dateRange.dateFrom}`)
    if (dateRange.dateTo) parts.push(`to=${dateRange.dateTo}`)
    return parts.length ? parts.join(', ') : 'all events'
  }, [dateRange.dateFrom, dateRange.dateTo, query, source, statusCode])

  const exportParams = useMemo(() => {
    const statusFilter = statusCode.trim() ? Number(statusCode) : undefined
    return {
      source: source || undefined,
      status_code: Number.isFinite(statusFilter) ? statusFilter : undefined,
      q: debouncedQuery.trim() || undefined,
      ...dateRange.params,
      sort_by: sortBy,
      sort_dir: sortDir,
    }
  }, [dateRange.params, debouncedQuery, sortBy, sortDir, source, statusCode])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const updateToggle = async (patch: Partial<ErrorTrackingSettings>) => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const next = await adminApi.updateErrorTrackingSettings(patch)
      setSettings(next)
      setErrorTrackingConfig(next)
      if (next.enabled && next.frontend) {
        installGlobalErrorHandlers()
      }
      setMessage(
        next.enabled
          ? 'Error tracking module updated.'
          : 'Error tracking module disabled. Collectors are idle.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings')
    } finally {
      setSaving(false)
    }
  }

  const handleDownloadCsv = async () => {
    setError(null)
    try {
      await downloadCsv(
        () => adminApi.downloadErrorsCsv(exportParams),
        'error_events.csv',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download CSV')
    }
  }

  return (
    <div className={pageSection}>
      <div>
        <h1 className={pageTitle}>Error tracking</h1>
        <p className={pageIntro}>
          Capture frontend, backend, and API errors. When the module is disabled, collectors do
          no work and use no database resources.
        </p>
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      <section className={cardPanel}>
        <h2 className="mb-3 text-base font-semibold text-foreground">Module settings</h2>
        <label className={fieldCheckbox}>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={saving}
            onChange={(e) => void updateToggle({ enabled: e.target.checked })}
          />
          <span>Enable error tracking module</span>
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className={fieldCheckbox}>
            <input
              type="checkbox"
              checked={settings.frontend}
              disabled={saving || !settings.enabled}
              onChange={(e) => void updateToggle({ frontend: e.target.checked })}
            />
            <span>Frontend errors</span>
          </label>
          <label className={fieldCheckbox}>
            <input
              type="checkbox"
              checked={settings.backend}
              disabled={saving || !settings.enabled}
              onChange={(e) => void updateToggle({ backend: e.target.checked })}
            />
            <span>Backend exceptions</span>
          </label>
          <label className={fieldCheckbox}>
            <input
              type="checkbox"
              checked={settings.api}
              disabled={saving || !settings.enabled}
              onChange={(e) => void updateToggle({ api: e.target.checked })}
            />
            <span>API 4xx / 5xx</span>
          </label>
        </div>
      </section>

      <section className={cardPanel}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className={`${fieldLabel} mb-0 min-w-[140px] flex-1`}>
            <span>Source</span>
            <select
              className={fieldInput}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">All</option>
              <option value="frontend">frontend</option>
              <option value="backend">backend</option>
              <option value="api">api</option>
            </select>
          </label>
          <label className={`${fieldLabel} mb-0 w-28`}>
            <span>Status</span>
            <input
              className={fieldInput}
              value={statusCode}
              onChange={(e) => setStatusCode(e.target.value)}
              placeholder="e.g. 500"
              inputMode="numeric"
            />
          </label>
          <label className={`${fieldLabel} mb-0 min-w-[180px] flex-[2]`}>
            <span>Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                className={`${fieldInput} pl-9`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Message, path, URL…"
              />
            </div>
          </label>
          <AdminDateRangeFilter
            dateFrom={dateRange.dateFrom}
            dateTo={dateRange.dateTo}
            onDateFromChange={dateRange.setDateFrom}
            onDateToChange={dateRange.setDateTo}
            onClear={dateRange.clear}
          />
          <button
            type="button"
            className={`${btnBase} ${btnCompact}`}
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <AdminDownloadCsvButton
            onClick={() => void handleDownloadCsv()}
            disabled={loading}
          />
        </div>

        <p className="mb-3 text-sm text-muted-text">
          {total} event{total === 1 ? '' : 's'} ({filteredHint})
        </p>

        {loading ? (
          <p className="text-sm text-muted-text">Loading…</p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-text">No error events yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-text">
                    <AdminSortHeader
                      label="When"
                      sortKey="created_at"
                      activeKey={sortBy}
                      dir={sortDir}
                      onSort={toggleSort}
                      className="px-2 py-2"
                    />
                    <AdminSortHeader
                      label="Source"
                      sortKey="source"
                      activeKey={sortBy}
                      dir={sortDir}
                      onSort={toggleSort}
                      className="px-2 py-2"
                    />
                    <AdminSortHeader
                      label="Status"
                      sortKey="status_code"
                      activeKey={sortBy}
                      dir={sortDir}
                      onSort={toggleSort}
                      className="px-2 py-2"
                    />
                    <AdminSortHeader
                      label="Path"
                      sortKey="path"
                      activeKey={sortBy}
                      dir={sortDir}
                      onSort={toggleSort}
                      className="px-2 py-2"
                    />
                    <AdminSortHeader
                      label="Message"
                      sortKey="message"
                      activeKey={sortBy}
                      dir={sortDir}
                      onSort={toggleSort}
                      className="px-2 py-2"
                    />
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-border-subtle align-top">
                      <td className="whitespace-nowrap px-2 py-2 text-muted-text">
                        {formatDateTime(event.created_at)}
                      </td>
                      <td className="px-2 py-2 font-medium text-foreground">{event.source}</td>
                      <td className="px-2 py-2 text-foreground">{event.status_code ?? '—'}</td>
                      <td className="max-w-[180px] truncate px-2 py-2 font-mono text-[0.75rem] text-muted-text">
                        {event.method ? `${event.method} ` : ''}
                        {event.path || event.page_url || '—'}
                      </td>
                      <td className="max-w-[320px] px-2 py-2 text-foreground">
                        <div className="line-clamp-2" title={event.message}>
                          {event.message}
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
      </section>
    </div>
  )
}
