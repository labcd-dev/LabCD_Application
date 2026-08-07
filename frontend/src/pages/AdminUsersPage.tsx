import { Navigate, Link } from 'react-router-dom'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Eye,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserPlus,
  UserX,
  X,
} from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { AuthUser, PlanInfo, RoleInfo } from '../api/types'
import { AdminDownloadCsvButton } from '../components/admin/AdminDownloadCsvButton'
import { AdminPagination } from '../components/admin/AdminPagination'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import { downloadCsv } from '../lib/downloadCsv'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldCheckbox,
  fieldInput,
  fieldLabel,
} from '../lib/classes'
import { passwordMeetsPolicy, passwordPolicyError } from '../lib/passwordStrength'

export function AdminUsersPage() {
  const { user: currentUser, hasAction } = useAuth()
  const [users, setUsers] = useState<AuthUser[]>([])
  const [plans, setPlans] = useState<PlanInfo[]>([])
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [defaultPlanId, setDefaultPlanId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState<number | ''>('')
  const [isActive, setIsActive] = useState(true)
  const [planId, setPlanId] = useState<number | ''>('')
  const [editingUserId, setEditingUserId] = useState<number | null>(null)

  const canManage = hasAction('admin:users')

  const activePlans = useMemo(
    () => plans.filter((plan) => plan.is_active),
    [plans],
  )

  const activeRoles = useMemo(
    () => roles.filter((role) => role.is_active || role.is_system),
    [roles],
  )

  const refreshUsers = async () => {
    const [userList, planList, roleList] = await Promise.all([
      adminApi.listUsers(),
      adminApi.listPlans(),
      adminApi.listRoles(),
    ])
    setUsers(userList)
    setPlans(planList)
    setRoles(roleList)
  }

  useEffect(() => {
    if (!canManage) return
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [userList, planList, roleList, defaultPlan] = await Promise.all([
          adminApi.listUsers(),
          adminApi.listPlans(),
          adminApi.listRoles(),
          adminApi.getDefaultPlan(),
        ])
        setUsers(userList)
        setPlans(planList)
        setRoles(roleList)
        setDefaultPlanId(defaultPlan.plan_id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load users')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [canManage])

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.plan_name?.toLowerCase().includes(q) ?? false) ||
        (u.role_name?.toLowerCase().includes(q) ?? false) ||
        u.actions.some((a) => a.toLowerCase().includes(q)),
    )
  }, [users, query])

  const pagination = useClientPagination(filteredUsers, { resetKey: query })

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const defaultUserRoleId =
    roles.find((r) => r.name === 'User')?.id ?? activeRoles[0]?.id ?? ''

  const isSelf = (user: AuthUser) => user.id === currentUser!.id

  const openCreate = () => {
    setEditingUserId(null)
    setEmail('')
    setPassword('')
    setRoleId(defaultUserRoleId)
    setIsActive(true)
    setPlanId(defaultPlanId ?? activePlans[0]?.id ?? '')
    setMessage(null)
    setError(null)
    setPanelOpen(true)
  }

  const startEdit = (user: AuthUser) => {
    setEditingUserId(user.id)
    setEmail(user.email)
    setPassword('')
    setRoleId(user.role_id ?? '')
    setIsActive(user.is_active)
    setPlanId(user.plan_id ?? '')
    setMessage(null)
    setError(null)
    setPanelOpen(true)
  }

  const closePanel = () => {
    setPanelOpen(false)
    setEditingUserId(null)
    setEmail('')
    setPassword('')
    setRoleId('')
    setIsActive(true)
    setPlanId('')
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (editingUserId == null || password) {
      const policyError = passwordPolicyError(password, { email })
      if (policyError || !passwordMeetsPolicy(password, { email })) {
        setError(policyError ?? 'Password does not meet requirements')
        return
      }
    }
    const resolvedPlanId = planId === '' ? null : Number(planId)
    const resolvedRoleId = roleId === '' ? null : Number(roleId)
    try {
      if (editingUserId == null) {
        await adminApi.createUser({
          email,
          password,
          role_id: resolvedRoleId,
          plan_id: resolvedPlanId,
        })
        setMessage(`Created user ${email}`)
      } else {
        await adminApi.updateUser(editingUserId, {
          role_id: resolvedRoleId,
          is_active: isActive,
          plan_id: resolvedPlanId,
          ...(password ? { password } : {}),
        })
        setMessage(`Updated user ${email}`)
      }
      closePanel()
      await refreshUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const handleToggleActive = async (user: AuthUser) => {
    if (isSelf(user)) return
    setError(null)
    setMessage(null)
    try {
      await adminApi.updateUser(user.id, { is_active: !user.is_active })
      setMessage(user.is_active ? `Suspended ${user.email}` : `Reactivated ${user.email}`)
      await refreshUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const handleDelete = async (user: AuthUser) => {
    if (isSelf(user)) return
    if (
      !window.confirm(
        `Delete user "${user.email}"? This permanently removes the account and related projects. This cannot be undone.`,
      )
    ) {
      return
    }
    setError(null)
    setMessage(null)
    try {
      await adminApi.deleteUser(user.id)
      setMessage(`Deleted ${user.email}`)
      await refreshUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const planOptions = useMemo(() => {
    const options = [...activePlans]
    if (planId !== '') {
      const current = plans.find((plan) => plan.id === planId)
      if (current && !options.some((plan) => plan.id === current.id)) {
        options.push(current)
      }
    }
    return options.length > 0 ? options : plans
  }, [plans, activePlans, planId])

  const roleOptions = useMemo(() => {
    const options = [...activeRoles]
    if (roleId !== '') {
      const current = roles.find((role) => role.id === roleId)
      if (current && !options.some((role) => role.id === current.id)) {
        options.push(current)
      }
    }
    return options.length > 0 ? options : roles
  }, [roles, activeRoles, roleId])

  return (
    <div className="admin-fade-in space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Access control
          </p>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground">
            Users
          </h1>
          <p className="m-0 max-w-lg text-muted-text leading-relaxed">
            Create accounts and assign a plan. Module access comes from the plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminDownloadCsvButton
            onClick={async () => {
              setError(null)
              try {
                await downloadCsv(() => adminApi.downloadUsersCsv(), 'users.csv')
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to download CSV')
              }
            }}
            disabled={loading}
          />
          <button type="button" className={btnPrimary} onClick={openCreate}>
            <Plus className="size-4" aria-hidden />
            New user
          </button>
        </div>
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
            placeholder="Search by email, plan, or module…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search users"
          />
        </div>

        {loading ? (
          <p className="py-8 text-center text-muted-text">Loading users…</p>
        ) : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-2xl bg-surface-muted p-4 text-primary">
              <UserPlus className="size-8" aria-hidden />
            </div>
            <p className="m-0 font-medium text-foreground">
              {query ? 'No users match your search' : 'No users yet'}
            </p>
            <p className="m-0 text-sm text-muted-text">
              {query
                ? 'Try a different email or plan name.'
                : 'Create the first account and assign a plan.'}
            </p>
            {!query && (
              <button type="button" className={btnPrimary} onClick={openCreate}>
                <Plus className="size-4" aria-hidden />
                New user
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-xl border border-border-subtle">
              <table className="admin-users-table w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/80 text-left">
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Email</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Role</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Status</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Plan</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Modules</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Created</th>
                    <th className="px-4 py-3 text-right font-medium text-foreground-secondary">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.pageItems.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-border-subtle transition-colors last:border-b-0 hover:bg-surface-hover/50"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        <Link
                          to={`/admin/users/${user.id}`}
                          className="text-foreground hover:text-primary"
                        >
                          {user.email}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {user.role_name || (user.is_admin ? 'Admin' : 'User') ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
                              user.is_admin
                                ? 'bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] text-primary'
                                : 'bg-surface-elevated font-medium text-muted-text ring-1 ring-border'
                            }`}
                          >
                            {user.is_admin ? <Shield className="size-3" aria-hidden /> : null}
                            {user.role_name || (user.is_admin ? 'Admin' : 'User')}
                          </span>
                        ) : (
                          <span className="text-muted-text">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {user.is_active ? (
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
                        {user.plan_name ? (
                          <span className="font-medium text-foreground">{user.plan_name}</span>
                        ) : (
                          <span className="text-muted-text">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {user.actions.length === 0 ? (
                          <span className="text-muted-text">None</span>
                        ) : (
                          <div className="flex max-w-md flex-wrap gap-1.5">
                            {user.actions.map((code) => (
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
                      <td className="whitespace-nowrap px-4 py-3 text-muted-text">
                        {new Date(user.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Link
                            to={`/admin/users/${user.id}`}
                            className={`${btnBase} ${btnCompact}`}
                          >
                            <Eye className="size-3.5" aria-hidden />
                            View
                          </Link>
                          <button
                            type="button"
                            className={`${btnBase} ${btnCompact}`}
                            onClick={() => startEdit(user)}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`${btnBase} ${btnCompact}`}
                            disabled={isSelf(user)}
                            title={isSelf(user) ? 'You cannot suspend your own account' : undefined}
                            onClick={() => void handleToggleActive(user)}
                          >
                            <UserX className="size-3.5" aria-hidden />
                            {user.is_active ? 'Suspend' : 'Reactivate'}
                          </button>
                          <button
                            type="button"
                            className={`${btnBase} ${btnCompact}`}
                            disabled={isSelf(user)}
                            title={isSelf(user) ? 'You cannot delete your own account' : undefined}
                            onClick={() => void handleDelete(user)}
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
            aria-labelledby="admin-user-panel-title"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2
                id="admin-user-panel-title"
                className="m-0 text-lg font-semibold text-foreground"
              >
                {editingUserId == null ? 'Create user' : 'Edit user'}
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
                  <span>Email</span>
                  <input
                    className={fieldInput}
                    type="email"
                    required
                    disabled={editingUserId != null}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className={fieldLabel}>
                  <span>{editingUserId == null ? 'Password' : 'New password (optional)'}</span>
                  <input
                    className={fieldInput}
                    type="password"
                    minLength={12}
                    required={editingUserId == null}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {password ? <PasswordStrengthMeter password={password} email={email} /> : null}
                </label>
                <label className={fieldLabel}>
                  <span>Role</span>
                  <select
                    className={fieldInput}
                    value={roleId === '' ? '' : String(roleId)}
                    onChange={(e) =>
                      setRoleId(e.target.value ? Number(e.target.value) : '')
                    }
                  >
                    <option value="">No role</option>
                    {roleOptions.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                        {role.is_system ? ' (system)' : ''}
                        {!role.is_active ? ' — inactive' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {editingUserId != null && (
                  <label className={fieldCheckbox}>
                    <input
                      type="checkbox"
                      checked={isActive}
                      disabled={editingUserId === currentUser!.id}
                      onChange={(e) => setIsActive(e.target.checked)}
                    />
                    <span>Account active</span>
                  </label>
                )}

                <label className={fieldLabel}>
                  <span>Plan</span>
                  <select
                    className={fieldInput}
                    value={planId === '' ? '' : String(planId)}
                    onChange={(e) =>
                      setPlanId(e.target.value ? Number(e.target.value) : '')
                    }
                  >
                    <option value="">No plan</option>
                    {planOptions.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} ({plan.price === 0 ? 'Free' : `$${plan.price}`})
                        {!plan.is_active ? ' — inactive' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {planId !== '' && (
                  <p className="m-0 text-xs text-muted-text">
                    Modules:{' '}
                    {(plans.find((p) => p.id === planId)?.actions ?? []).join(', ') || 'None'}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
                <button type="submit" className={btnPrimary}>
                  {editingUserId == null ? 'Create user' : 'Save changes'}
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
