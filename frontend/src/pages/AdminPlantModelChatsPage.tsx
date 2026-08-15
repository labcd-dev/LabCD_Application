import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { MessagesSquare, Search, Trash2 } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { AuthUser, PlantModelConversationSummary } from '../api/types'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import {
  btnBase,
  btnCompact,
  cardPanel,
  fieldInput,
  fieldLabel,
} from '../lib/classes'
import { statusBadgeClass } from '../lib/projectLabels'

export function AdminPlantModelChatsPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:plant_model')
  const [conversations, setConversations] = useState<PlantModelConversationSummary[]>([])
  const [users, setUsers] = useState<AuthUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [userId, setUserId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await adminApi.listPlantModelConversations({
        user_id: userId ? Number(userId) : undefined,
        status: statusFilter || undefined,
      })
      setConversations(rows)
      try {
        setUsers(await adminApi.listUsers())
      } catch {
        setUsers([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [userId, statusFilter, canManage])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.system_name ?? '').toLowerCase().includes(q) ||
        (c.owner_email ?? '').toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q) ||
        c.llm_model.toLowerCase().includes(q),
    )
  }, [conversations, query])

  const pagination = useClientPagination(filtered, {
    resetKey: `${query}|${userId}|${statusFilter}`,
  })

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const handleDelete = async (conversationId: number) => {
    if (!window.confirm('Delete this plant-model chat? This cannot be undone.')) return
    try {
      await adminApi.deletePlantModelConversation(conversationId)
      setConversations((prev) => prev.filter((c) => c.id !== conversationId))
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
              placeholder="Title, owner, model…"
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
      </div>

      {loading ? (
        <p className="text-muted-text">Loading chats…</p>
      ) : filtered.length === 0 ? (
        <div className={`${cardPanel} text-center`}>
          <MessagesSquare className="mx-auto mb-3 size-10 text-muted" />
          <p className="m-0 font-medium text-foreground">No chats found</p>
          <p className="mt-1 mb-0 text-sm text-muted-text">
            Conversations appear here after users start Design plant-model chats.
          </p>
        </div>
      ) : (
        <div className={`${cardPanel} space-y-3`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-semibold">Chat</th>
                  <th className="px-4 py-3 font-semibold">Owner</th>
                  <th className="px-4 py-3 font-semibold">LLM</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagination.pageItems.map((chat) => (
                  <tr key={chat.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {chat.system_name || chat.title}
                      </div>
                      {chat.system_name && chat.system_name !== chat.title ? (
                        <div className="text-xs text-muted-text">{chat.title}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-text">
                      {chat.owner_email ?? (chat.user_id != null ? `#${chat.user_id}` : '—')}
                    </td>
                    <td className="px-4 py-3 text-muted-text">{chat.llm_model}</td>
                    <td className="px-4 py-3">
                      <span className={statusBadgeClass(chat.status)}>{chat.status}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-text">
                      {new Date(chat.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link
                          to={`/admin/plant-model/${chat.id}`}
                          className={`${btnBase} ${btnCompact}`}
                        >
                          View
                        </Link>
                        <button
                          type="button"
                          className={`${btnBase} ${btnCompact}`}
                          onClick={() => void handleDelete(chat.id)}
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
