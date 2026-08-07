import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { AuditLogEntry } from '../api/types'
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
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

type CategoryFilter = 'all' | 'auth' | 'admin'
type SuccessFilter = 'all' | 'success' | 'failure'

const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'auth', label: 'Auth' },
  { value: 'admin', label: 'Admin' },
]

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function formatDetails(details: Record<string, unknown> | null): string {
  if (!details) return '—'
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

export function AdminAuditLogPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:audit')
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>('all')
  const [actionFilter, setActionFilter] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const listParams = useMemo(() => {
    const success =
      successFilter === 'all' ? undefined : successFilter === 'success'
    return {
      category: category === 'all' ? undefined : category,
      action: actionFilter.trim() || undefined,
      success,
      q: query.trim() || undefined,
      limit: 200,
    }
  }, [actionFilter, category, query, successFilter])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await adminApi.listAuditLog(listParams)
      setEntries(list)
      setSelectedId((prev) => (prev && list.some((e) => e.id === prev) ? prev : null))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [listParams])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  const pagination = useClientPagination(entries, {
    resetKey: `${category}|${successFilter}|${actionFilter}|${query}`,
  })

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const selected = entries.find((e) => e.id === selectedId) ?? null

  const handleDownloadCsv = async () => {
    setError(null)
    try {
      await downloadCsv(
        () => adminApi.downloadAuditLogCsv(listParams),
        'audit_log.csv',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download CSV')
    }
  }

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Audit log</h1>
          <p className={pageIntro}>
            Auth and admin activity trail. Select a row to inspect payload details.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-xl border border-border bg-surface-muted p-1"
            role="group"
            aria-label="Filter by category"
          >
            {CATEGORY_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`${btnCompact} rounded-lg px-3 ${
                  category === filter.value
                    ? 'bg-surface-elevated text-foreground shadow-sm'
                    : 'bg-transparent text-muted-text hover:text-foreground'
                }`}
                onClick={() => setCategory(filter.value)}
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

      <section className={cardPanel}>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={fieldLabel}>Action</span>
            <input
              className={fieldInput}
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder="e.g. auth.login"
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Result</span>
            <select
              className={fieldInput}
              value={successFilter}
              onChange={(e) => setSuccessFilter(e.target.value as SuccessFilter)}
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </select>
          </label>
          <label className="block">
            <span className={fieldLabel}>Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-text" />
              <input
                className={`${fieldInput} pl-9`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="email, IP, resource…"
              />
            </div>
          </label>
        </div>

        <p className="mb-3 text-sm text-muted-text">
          {entries.length} event{entries.length === 1 ? '' : 's'}
        </p>

        {loading ? (
          <p className="text-sm text-muted-text">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-text">No audit events yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-text">
                    <th className="px-2 py-2 font-medium">When</th>
                    <th className="px-2 py-2 font-medium">Category</th>
                    <th className="px-2 py-2 font-medium">Action</th>
                    <th className="px-2 py-2 font-medium">Actor</th>
                    <th className="px-2 py-2 font-medium">Resource</th>
                    <th className="px-2 py-2 font-medium">Result</th>
                    <th className="px-2 py-2 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.pageItems.map((entry) => (
                    <tr
                      key={entry.id}
                      className={`cursor-pointer border-b border-border-subtle align-top ${
                        selectedId === entry.id ? 'bg-surface-muted' : 'hover:bg-surface-muted/60'
                      }`}
                      onClick={() =>
                        setSelectedId((prev) => (prev === entry.id ? null : entry.id))
                      }
                    >
                      <td className="whitespace-nowrap px-2 py-2 text-muted-text">
                        {formatWhen(entry.created_at)}
                      </td>
                      <td className="px-2 py-2 capitalize text-foreground">{entry.category}</td>
                      <td className="px-2 py-2 font-mono text-[0.8rem] text-foreground">
                        {entry.action}
                      </td>
                      <td className="px-2 py-2 text-foreground">
                        {entry.actor_email ?? (entry.actor_user_id != null ? `#${entry.actor_user_id}` : '—')}
                      </td>
                      <td className="px-2 py-2 text-foreground">
                        {entry.resource_type
                          ? `${entry.resource_type}${entry.resource_id ? ` #${entry.resource_id}` : ''}`
                          : '—'}
                      </td>
                      <td className="px-2 py-2 text-foreground">
                        {entry.success ? 'Success' : 'Failure'}
                      </td>
                      <td className="px-2 py-2 font-mono text-[0.8rem] text-muted-text">
                        {entry.ip_address || '—'}
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

      {selected && (
        <section className={cardPanel}>
          <h2 className="mb-3 text-base font-semibold text-foreground">
            Event #{selected.id}
          </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-text">When</dt>
              <dd className="text-foreground">{formatWhen(selected.created_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-text">Result</dt>
              <dd className="text-foreground">{selected.success ? 'Success' : 'Failure'}</dd>
            </div>
            <div>
              <dt className="text-muted-text">Category</dt>
              <dd className="capitalize text-foreground">{selected.category}</dd>
            </div>
            <div>
              <dt className="text-muted-text">Action</dt>
              <dd className="font-mono text-[0.8rem] text-foreground">{selected.action}</dd>
            </div>
            <div>
              <dt className="text-muted-text">Actor</dt>
              <dd className="text-foreground">
                {selected.actor_email ?? '—'}
                {selected.actor_user_id != null ? ` (id ${selected.actor_user_id})` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-muted-text">Resource</dt>
              <dd className="text-foreground">
                {selected.resource_type
                  ? `${selected.resource_type}${selected.resource_id ? ` #${selected.resource_id}` : ''}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-text">IP</dt>
              <dd className="font-mono text-[0.8rem] text-foreground">
                {selected.ip_address || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-text">User agent</dt>
              <dd className="break-all text-foreground">{selected.user_agent || '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-text">Details</dt>
              <dd className="mt-1 overflow-x-auto rounded-lg border border-border bg-surface-muted p-3">
                <pre className="m-0 whitespace-pre-wrap font-mono text-[0.8rem] text-foreground">
                  {formatDetails(selected.details)}
                </pre>
              </dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  )
}
