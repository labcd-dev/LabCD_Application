import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { MessagesSquare, Search, Trash2 } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { PlantModelConversationSummary, UserOption } from '../api/types'
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
import { statusBadgeClass } from '../lib/projectLabels'
import { formatDateTime } from '../lib/formatDateTime'

export function AdminPlantModelChatsPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:plant_model')
  const [conversations, setConversations] = useState<PlantModelConversationSummary[]>([])
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query)
  const [userId, setUserId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const dateRange = useAdminDateRange()

  const { sortBy, sortDir, toggle: toggleSort, resetKey: sortResetKey } = useServerSort(
    'updated_at',
    'desc',
  )

  const pagination = useServerPagination({
    total,
    resetKey: `${debouncedQuery}|${userId}|${statusFilter}|${dateRange.dateFrom}|${dateRange.dateTo}|${sortResetKey}`,
  })

  const listParams = useMemo(
    () => ({
      user_id: userId ? Number(userId) : undefined,
      status: statusFilter || undefined,
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
      sortBy,
      sortDir,
      statusFilter,
      userId,
    ],
  )

  const exportParams = useMemo(
    () => ({
      user_id: userId ? Number(userId) : undefined,
      status: statusFilter || undefined,
      q: debouncedQuery.trim() || undefined,
      ...dateRange.params,
      sort_by: sortBy,
      sort_dir: sortDir,
    }),
    [dateRange.params, debouncedQuery, sortBy, sortDir, statusFilter, userId],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const page = await adminApi.listPlantModelConversations(listParams)
      setConversations(page.items)
      setTotal(page.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats')
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
    void adminApi
      .listUserOptions()
      .then(setUserOptions)
      .catch(() => setUserOptions([]))
  }, [canManage])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const handleDelete = async (conversationId: number) => {
    if (!window.confirm('Delete this plant-model chat? This cannot be undone.')) return
    try {
      await adminApi.deletePlantModelConversation(conversationId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete chat')
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
            Plant model chats
          </h1>
          <p className="m-0 max-w-xl text-muted-text leading-relaxed">
            View and manage plant-model conversations and saved dynamics models from Design chat.
          </p>
        </div>
        <AdminDownloadCsvButton
          onClick={async () => {
            setError(null)
            try {
              await downloadCsv(
                () => adminApi.downloadPlantModelConversationsCsv(exportParams),
                'plant_model_conversations.csv',
              )
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to download CSV')
            }
          }}
          disabled={loading}
        />
      </header>

      {error && <StatusMessage type="error" message={error} />}

      <div className={`${cardPanel} space-y-3`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-[2.35rem] size-4 text-muted" />
            <label className={fieldLabel}>
              <span>Search</span>
              <input
                className={`${fieldInput} pl-9`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Title, owner, model…"
              />
            </label>
          </div>
          <label className={`${fieldLabel} min-w-[10rem] flex-1`}>
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
          <label className={`${fieldLabel} min-w-[10rem] flex-1`}>
            <span>Status</span>
            <select
              className={fieldInput}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
            </select>
          </label>
          <AdminDateRangeFilter
            className="mb-4"
            dateFrom={dateRange.dateFrom}
            dateTo={dateRange.dateTo}
            onDateFromChange={dateRange.setDateFrom}
            onDateToChange={dateRange.setDateTo}
            onClear={dateRange.clear}
            label="Updated"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-muted-text">Loading chats…</p>
      ) : total === 0 ? (
        <div className={`${cardPanel} text-center`}>
          <MessagesSquare className="mx-auto mb-3 size-10 text-muted" />
          <p className="m-0 font-medium text-foreground">No conversations found</p>
          <p className="mt-1 mb-0 text-sm text-muted-text">
            Chats appear here when users use Design chat to build plant models.
          </p>
        </div>
      ) : (
        <div className={`${cardPanel} space-y-3`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-muted">
                  <AdminSortHeader
                    label="System / title"
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
                    label="Model"
                    sortKey="llm_model"
                    activeKey={sortBy}
                    dir={sortDir}
                    onSort={toggleSort}
                    className="px-4 py-3"
                  />
                  <AdminSortHeader
                    label="Complexity"
                    sortKey="complexity"
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
                {conversations.map((conversation) => (
                  <tr key={conversation.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {conversation.system_name || conversation.title}
                      </div>
                      {conversation.system_name && (
                        <div className="text-xs text-muted-text">{conversation.title}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-text">
                      {conversation.owner_email ?? `#${conversation.user_id}`}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{conversation.llm_model}</td>
                    <td className="px-4 py-3">{conversation.complexity ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={statusBadgeClass(conversation.status)}>
                        {conversation.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-text">
                      {formatDateTime(conversation.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link
                          to={`/admin/plant-model/${conversation.id}`}
                          className={`${btnBase} ${btnCompact}`}
                        >
                          View
                        </Link>
                        <button
                          type="button"
                          className={`${btnBase} ${btnCompact}`}
                          onClick={() => void handleDelete(conversation.id)}
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
