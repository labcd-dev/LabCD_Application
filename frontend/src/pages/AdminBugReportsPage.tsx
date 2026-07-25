import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { bugReportsApi } from '../api/endpoints'
import type { BugReport, BugReportSettings } from '../api/types'
import { AdminDownloadCsvButton } from '../components/admin/AdminDownloadCsvButton'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { downloadCsv } from '../lib/downloadCsv'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldCheckbox,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

type StatusFilter = 'open' | 'fixed' | 'all'

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'all', label: 'All' },
]

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function truncate(text: string, max = 120): string {
  const cleaned = text.trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max)}…`
}

export function AdminBugReportsPage() {
  const { user: currentUser } = useAuth()
  const [settings, setSettings] = useState<BugReportSettings>({ enabled: true })
  const [reports, setReports] = useState<BugReport[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextSettings, list] = await Promise.all([
        bugReportsApi.getSettings(),
        bugReportsApi.listAdmin({ status: statusFilter }),
      ])
      setSettings(nextSettings)
      setReports(list)
      setSelectedId((prev) => (prev && list.some((r) => r.id === prev) ? prev : null))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bug reports')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    if (!currentUser?.is_admin) return
    void load()
  }, [currentUser?.is_admin, load])

  if (!currentUser?.is_admin) {
    return <Navigate to="/studio" replace />
  }

  const selected = reports.find((r) => r.id === selectedId) ?? null

  const toggleEnabled = async (enabled: boolean) => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const next = await bugReportsApi.updateSettings({ enabled })
      setSettings(next)
      setMessage(
        next.enabled
          ? 'Bug reporting is enabled for users.'
          : 'Bug reporting is disabled. The report button is hidden.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings')
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (report: BugReport, next: 'open' | 'fixed') => {
    setUpdatingId(report.id)
    setError(null)
    setMessage(null)
    try {
      const updated = await bugReportsApi.updateStatus(report.id, next)
      setReports((prev) => {
        if (statusFilter !== 'all' && updated.status !== statusFilter) {
          return prev.filter((r) => r.id !== updated.id)
        }
        return prev.map((r) => (r.id === updated.id ? updated : r))
      })
      setMessage(next === 'fixed' ? 'Marked as fixed.' : 'Reopened.')
      if (selectedId === updated.id) setSelectedId(updated.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update report')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleDownloadCsv = async () => {
    setError(null)
    try {
      await downloadCsv(
        () => bugReportsApi.downloadCsv({ status: statusFilter }),
        'bug_reports.csv',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download CSV')
    }
  }

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Bug reports</h1>
          <p className={pageIntro}>
            User-submitted issues with optional screenshots. Mark items fixed when resolved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-xl border border-border bg-surface-muted p-1"
            role="group"
            aria-label="Filter by status"
          >
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`${btnCompact} rounded-lg px-3 ${
                  statusFilter === filter.value
                    ? 'bg-surface-elevated text-foreground shadow-sm'
                    : 'bg-transparent text-muted-text hover:text-foreground'
                }`}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
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
            onChange={(e) => void toggleEnabled(e.target.checked)}
          />
          <span>Enable bug reporting for users</span>
        </label>
        <p className="m-0 text-sm text-muted-text">
          When disabled, the floating report button is hidden and new submissions are rejected.
        </p>
      </section>

      <section className={cardPanel}>
        <p className="mb-3 text-sm text-muted-text">
          Showing {reports.length} report{reports.length === 1 ? '' : 's'}
          {statusFilter !== 'all' ? ` (${statusFilter})` : ''}
        </p>

        {loading ? (
          <p className="text-sm text-muted-text">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-muted-text">No bug reports yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-text">
                  <th className="px-2 py-2 font-medium">When</th>
                  <th className="px-2 py-2 font-medium">User</th>
                  <th className="px-2 py-2 font-medium">Description</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Image</th>
                  <th className="px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr
                    key={report.id}
                    className={`border-b border-border-subtle align-top ${
                      selectedId === report.id ? 'bg-surface-muted' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-2 py-2 text-muted-text">
                      {formatWhen(report.created_at)}
                    </td>
                    <td className="px-2 py-2 text-foreground">
                      {report.user_email ?? '—'}
                    </td>
                    <td className="max-w-[280px] px-2 py-2 text-foreground">
                      <button
                        type="button"
                        className="line-clamp-2 text-left hover:underline"
                        title={report.description}
                        onClick={() =>
                          setSelectedId((prev) => (prev === report.id ? null : report.id))
                        }
                      >
                        {truncate(report.description)}
                      </button>
                    </td>
                    <td className="px-2 py-2 capitalize text-foreground">{report.status}</td>
                    <td className="px-2 py-2">
                      {report.image_url ? (
                        <img
                          src={report.image_url}
                          alt=""
                          className="size-12 rounded-md border border-border object-cover"
                        />
                      ) : (
                        <span className="text-muted-text">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={`${btnBase} ${btnCompact}`}
                          onClick={() =>
                            setSelectedId((prev) => (prev === report.id ? null : report.id))
                          }
                        >
                          {selectedId === report.id ? 'Hide' : 'View'}
                        </button>
                        {report.status === 'fixed' ? (
                          <button
                            type="button"
                            className={`${btnBase} ${btnCompact}`}
                            disabled={updatingId === report.id}
                            onClick={() => void setStatus(report, 'open')}
                          >
                            Reopen
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`${btnPrimary} ${btnCompact}`}
                            disabled={updatingId === report.id}
                            onClick={() => void setStatus(report, 'fixed')}
                          >
                            Mark fixed
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section className={cardPanel}>
          <h2 className="mb-3 text-base font-semibold text-foreground">Report #{selected.id}</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-text">Submitted</dt>
              <dd className="text-foreground">{formatWhen(selected.created_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-text">Fixed at</dt>
              <dd className="text-foreground">{formatWhen(selected.fixed_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-text">User</dt>
              <dd className="text-foreground">{selected.user_email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-text">Status</dt>
              <dd className="capitalize text-foreground">{selected.status}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-text">Page URL</dt>
              <dd className="break-all font-mono text-[0.8rem] text-foreground">
                {selected.page_url || '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-text">Description</dt>
              <dd className="mt-1 whitespace-pre-wrap text-foreground">{selected.description}</dd>
            </div>
          </dl>
          {selected.image_url && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <a href={selected.image_url} target="_blank" rel="noreferrer">
                <img
                  src={selected.image_url}
                  alt="Bug screenshot"
                  className="max-h-[420px] w-full object-contain bg-surface-muted"
                />
              </a>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
