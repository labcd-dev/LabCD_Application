import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { ErrorEvent, ErrorTrackingSettings } from '../api/types'
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

const emptySettings: ErrorTrackingSettings = {
  enabled: false,
  frontend: false,
  backend: false,
  api: false,
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

export function AdminErrorsPage() {
  const { user: currentUser } = useAuth()
  const [settings, setSettings] = useState<ErrorTrackingSettings>(emptySettings)
  const [events, setEvents] = useState<ErrorEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [source, setSource] = useState('')
  const [statusCode, setStatusCode] = useState('')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const statusFilter = statusCode.trim() ? Number(statusCode) : undefined
      const [nextSettings, list] = await Promise.all([
        adminApi.getErrorTrackingSettings(),
        adminApi.listErrors({
          source: source || undefined,
          status_code: Number.isFinite(statusFilter) ? statusFilter : undefined,
          q: query.trim() || undefined,
          limit: 200,
        }),
      ])
      setSettings(nextSettings)
      setErrorTrackingConfig(nextSettings)
      if (nextSettings.enabled && nextSettings.frontend) {
        installGlobalErrorHandlers()
      }
      setEvents(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load errors')
    } finally {
      setLoading(false)
    }
  }, [query, source, statusCode])

  useEffect(() => {
    if (!currentUser?.is_admin) return
    void load()
  }, [currentUser?.is_admin, load])

  const filteredHint = useMemo(() => {
    const parts: string[] = []
    if (source) parts.push(`source=${source}`)
    if (statusCode.trim()) parts.push(`status=${statusCode.trim()}`)
    if (query.trim()) parts.push(`q="${query.trim()}"`)
    return parts.length ? parts.join(', ') : 'all events'
  }, [query, source, statusCode])

  const pagination = useClientPagination(events, {
    resetKey: `${source}|${statusCode}|${query}`,
  })

  if (!currentUser?.is_admin) {
    return <Navigate to="/studio" replace />
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
      const statusFilter = statusCode.trim() ? Number(statusCode) : undefined
      await downloadCsv(
        () =>
          adminApi.downloadErrorsCsv({
            source: source || undefined,
            status_code: Number.isFinite(statusFilter) ? statusFilter : undefined,
            q: query.trim() || undefined,
          }),
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
          Loaded {events.length} event{events.length === 1 ? '' : 's'} ({filteredHint})
        </p>

        {loading ? (
          <p className="text-sm text-muted-text">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-text">No error events yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-text">
                    <th className="px-2 py-2 font-medium">When</th>
                    <th className="px-2 py-2 font-medium">Source</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Path</th>
                    <th className="px-2 py-2 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.pageItems.map((event) => (
                    <tr key={event.id} className="border-b border-border-subtle align-top">
                      <td className="whitespace-nowrap px-2 py-2 text-muted-text">
                        {formatWhen(event.created_at)}
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
