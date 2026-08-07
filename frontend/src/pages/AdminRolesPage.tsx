import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Pencil, Plus, Search, Shield, Trash2, X } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { ActionInfo, RoleInfo } from '../api/types'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldCheckbox,
  fieldInput,
  fieldLabel,
} from '../lib/classes'

function groupActions(actions: ActionInfo[]) {
  const admin = actions.filter((a) => a.code.startsWith('admin:'))
  const other = actions.filter((a) => !a.code.startsWith('admin:'))
  return { admin, other }
}

export function AdminRolesPage() {
  const { hasAction } = useAuth()
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [actions, setActions] = useState<ActionInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)

  const [editingRoleId, setEditingRoleId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [isSystemRole, setIsSystemRole] = useState(false)
  const [selectedActions, setSelectedActions] = useState<string[]>([])

  const canManage = hasAction('admin:roles')

  const reload = async () => {
    const [roleList, actionList] = await Promise.all([
      adminApi.listRoles(),
      adminApi.listActions(),
    ])
    setRoles(roleList)
    setActions(actionList)
  }

  useEffect(() => {
    if (!canManage) return
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        await reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load roles')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [canManage])

  const filteredRoles = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return roles
    return roles.filter(
      (role) =>
        role.name.toLowerCase().includes(q) ||
        role.description.toLowerCase().includes(q) ||
        role.actions.some((code) => code.toLowerCase().includes(q)),
    )
  }, [roles, query])

  const pagination = useClientPagination(filteredRoles, { resetKey: query })
  const grouped = useMemo(() => groupActions(actions), [actions])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const toggleAction = (code: string) => {
    setSelectedActions((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    )
  }

  const openCreate = () => {
    setEditingRoleId(null)
    setName('')
    setDescription('')
    setIsActive(true)
    setIsSystemRole(false)
    setSelectedActions([])
    setMessage(null)
    setError(null)
    setPanelOpen(true)
  }

  const startEdit = (role: RoleInfo) => {
    setEditingRoleId(role.id)
    setName(role.name)
    setDescription(role.description)
    setIsActive(role.is_active)
    setIsSystemRole(role.is_system)
    setSelectedActions(role.actions)
    setMessage(null)
    setError(null)
    setPanelOpen(true)
  }

  const closePanel = () => {
    setPanelOpen(false)
    setEditingRoleId(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    try {
      if (editingRoleId == null) {
        await adminApi.createRole({
          name,
          description,
          actions: selectedActions,
          is_active: isActive,
        })
        setMessage(`Created role ${name}`)
      } else {
        await adminApi.updateRole(editingRoleId, {
          name: isSystemRole ? undefined : name,
          description,
          actions: selectedActions,
          is_active: isSystemRole ? undefined : isActive,
        })
        setMessage(`Updated role ${name}`)
      }
      closePanel()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const handleDelete = async (role: RoleInfo) => {
    if (role.is_system) return
    if (!window.confirm(`Delete role "${role.name}"?`)) return
    setError(null)
    setMessage(null)
    try {
      await adminApi.deleteRole(role.id)
      setMessage(`Deleted role ${role.name}`)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const renderActionGroup = (title: string, items: ActionInfo[]) => (
    <fieldset className="mb-2 space-y-2 border-0 p-0">
      <legend className="mb-2 text-sm font-medium text-foreground">{title}</legend>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
        {items.length === 0 ? (
          <p className="m-0 px-2.5 py-2 text-sm text-muted-text">None</p>
        ) : (
          items.map((action) => {
            const checked = selectedActions.includes(action.code)
            return (
              <label
                key={action.code}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                  checked
                    ? 'bg-[color-mix(in_srgb,var(--app-primary)_10%,transparent)]'
                    : 'hover:bg-surface-hover'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  onChange={() => toggleAction(action.code)}
                />
                <span>
                  <span className="block font-mono text-sm text-foreground">{action.code}</span>
                  {action.description ? (
                    <span className="text-xs text-muted-text">{action.description}</span>
                  ) : null}
                </span>
              </label>
            )
          })
        )}
      </div>
    </fieldset>
  )

  return (
    <div className="admin-fade-in space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Access control
          </p>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground">Roles</h1>
          <p className="m-0 max-w-lg text-muted-text leading-relaxed">
            Create roles and assign admin or module permissions. Each user has one role;
            plan modules still apply on top.
          </p>
        </div>
        <button type="button" className={btnPrimary} onClick={openCreate}>
          <Plus className="size-4" aria-hidden />
          New role
        </button>
      </header>

      {error && !panelOpen && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      <div className={`${cardPanel} space-y-4`}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            className={`${fieldInput} w-full pl-10`}
            type="search"
            placeholder="Search by name or permission…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search roles"
          />
        </div>

        {loading ? (
          <p className="py-8 text-center text-muted-text">Loading roles…</p>
        ) : filteredRoles.length === 0 ? (
          <p className="py-8 text-center text-muted-text">
            {query ? 'No roles match your search' : 'No roles yet'}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-xl border border-border-subtle">
              <table className="admin-users-table w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/80 text-left">
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Role</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Status</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">
                      Permissions
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-foreground-secondary">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.pageItems.map((role) => (
                    <tr
                      key={role.id}
                      className="border-b border-border-subtle transition-colors last:border-b-0 hover:bg-surface-hover/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          {role.name}
                          {role.is_system ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] px-2 py-0.5 text-xs font-semibold text-primary">
                              <Shield className="size-3" aria-hidden />
                              System
                            </span>
                          ) : null}
                        </div>
                        {role.description ? (
                          <div className="mt-0.5 text-xs text-muted-text">{role.description}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {role.is_active ? (
                          <span className="rounded-md bg-[var(--app-status-success-bg)] px-2 py-0.5 text-xs font-medium text-[var(--app-status-success-text)]">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-md bg-[var(--app-status-warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--app-status-warning-text)]">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {role.actions.length === 0 ? (
                          <span className="text-muted-text">None</span>
                        ) : (
                          <div className="flex max-w-md flex-wrap gap-1.5">
                            {role.actions.map((code) => (
                              <span
                                key={code}
                                className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono text-[0.68rem] text-foreground-secondary ring-1 ring-border-subtle"
                              >
                                {code}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            className={`${btnBase} ${btnCompact}`}
                            onClick={() => startEdit(role)}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`${btnBase} ${btnCompact}`}
                            onClick={() => void handleDelete(role)}
                            disabled={role.is_system}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            Delete
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

      {panelOpen && (
        <>
          <button
            type="button"
            className="admin-fade-in fixed inset-0 z-40 bg-foreground/35 backdrop-blur-[2px]"
            aria-label="Close panel"
            onClick={closePanel}
          />
          <aside
            className="admin-slide-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface-elevated shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-role-panel-title"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2
                id="admin-role-panel-title"
                className="m-0 text-lg font-semibold text-foreground"
              >
                {editingRoleId == null ? 'Create role' : 'Edit role'}
              </h2>
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                onClick={closePanel}
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex-1 space-y-1 overflow-y-auto px-5 py-4">
                {error && <StatusMessage type="error" message={error} />}

                <label className={fieldLabel}>
                  <span>Name</span>
                  <input
                    className={fieldInput}
                    required
                    disabled={isSystemRole}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className={fieldLabel}>
                  <span>Description</span>
                  <textarea
                    className={fieldInput}
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                {!isSystemRole && (
                  <label className={fieldCheckbox}>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                    />
                    <span>Active</span>
                  </label>
                )}

                {renderActionGroup('Admin permissions', grouped.admin)}
                {renderActionGroup('Module & pipeline permissions', grouped.other)}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
                <button type="submit" className={btnPrimary}>
                  {editingRoleId == null ? 'Create role' : 'Save changes'}
                </button>
                <button type="button" className={btnBase} onClick={closePanel}>
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  )
}
