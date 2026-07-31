import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import {
  Check,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { adminApi, healthApi } from '../api/endpoints'
import type { ActionInfo, PlanInfo } from '../api/types'
import { AdminDownloadCsvButton } from '../components/admin/AdminDownloadCsvButton'
import { AdminPagination } from '../components/admin/AdminPagination'
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

export function AdminPlansPage() {
  const { user: currentUser } = useAuth()
  const [plans, setPlans] = useState<PlanInfo[]>([])
  const [actions, setActions] = useState<ActionInfo[]>([])
  const [catalogModels, setCatalogModels] = useState<string[]>([])
  const [defaultPlanId, setDefaultPlanId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)

  const [editingPlanId, setEditingPlanId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('0')
  const [isActive, setIsActive] = useState(true)
  const [selectedActions, setSelectedActions] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])

  const reload = async () => {
    const [planList, actionList, defaultPlan, models] = await Promise.all([
      adminApi.listPlans(),
      adminApi.listActions(),
      adminApi.getDefaultPlan(),
      healthApi.models(),
    ])
    setPlans(planList)
    setActions(actionList)
    setDefaultPlanId(defaultPlan.plan_id)
    setCatalogModels(models.llm_models)
  }

  useEffect(() => {
    if (!currentUser?.is_admin) return
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        await reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load plans')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [currentUser?.is_admin])

  const filteredPlans = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return plans
    return plans.filter(
      (plan) =>
        plan.name.toLowerCase().includes(q) ||
        plan.description.toLowerCase().includes(q) ||
        plan.actions.some((code) => code.toLowerCase().includes(q)) ||
        (plan.models ?? []).some((model) => model.toLowerCase().includes(q)),
    )
  }, [plans, query])

  const pagination = useClientPagination(filteredPlans, { resetKey: query })

  if (!currentUser?.is_admin) {
    return <Navigate to="/studio" replace />
  }

  const toggleAction = (code: string) => {
    setSelectedActions((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    )
  }

  const toggleModel = (model: string) => {
    setSelectedModels((prev) =>
      prev.includes(model) ? prev.filter((item) => item !== model) : [...prev, model],
    )
  }

  const openCreate = () => {
    setEditingPlanId(null)
    setName('')
    setDescription('')
    setPrice('0')
    setIsActive(true)
    setSelectedActions([])
    setSelectedModels([])
    setMessage(null)
    setError(null)
    setPanelOpen(true)
  }

  const startEdit = (plan: PlanInfo) => {
    setEditingPlanId(plan.id)
    setName(plan.name)
    setDescription(plan.description)
    setPrice(String(plan.price))
    setIsActive(plan.is_active)
    setSelectedActions(plan.actions)
    setSelectedModels(plan.models ?? [])
    setMessage(null)
    setError(null)
    setPanelOpen(true)
  }

  const closePanel = () => {
    setPanelOpen(false)
    setEditingPlanId(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    const parsedPrice = Number(price)
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      setError('Price must be a non-negative number')
      return
    }
    try {
      if (editingPlanId == null) {
        await adminApi.createPlan({
          name,
          description,
          price: parsedPrice,
          actions: selectedActions,
          models: selectedModels,
          is_active: isActive,
        })
        setMessage(`Created plan ${name}`)
      } else {
        await adminApi.updatePlan(editingPlanId, {
          name,
          description,
          price: parsedPrice,
          actions: selectedActions,
          models: selectedModels,
          is_active: isActive,
        })
        setMessage(`Updated plan ${name}`)
      }
      closePanel()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const handleSetDefault = async (planId: number) => {
    setError(null)
    setMessage(null)
    try {
      await adminApi.setDefaultPlan(planId)
      setMessage('Default registration plan updated')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default plan')
    }
  }

  const handleDelete = async (plan: PlanInfo) => {
    if (!window.confirm(`Delete plan "${plan.name}"?`)) return
    setError(null)
    setMessage(null)
    try {
      await adminApi.deletePlan(plan.id)
      setMessage(`Deleted plan ${plan.name}`)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const formatPrice = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)

  return (
    <div className="admin-fade-in space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Access control
          </p>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground">
            Plans
          </h1>
          <p className="m-0 max-w-lg text-muted-text leading-relaxed">
            Define priced plans and attach modules and AI models. New users receive the
            default plan on registration.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminDownloadCsvButton
            onClick={async () => {
              setError(null)
              try {
                await downloadCsv(() => adminApi.downloadPlansCsv(), 'plans.csv')
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to download CSV')
              }
            }}
            disabled={loading}
          />
          <button type="button" className={btnPrimary} onClick={openCreate}>
            <Plus className="size-4" aria-hidden />
            New plan
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
            placeholder="Search by name, module, or model…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search plans"
          />
        </div>

        {loading ? (
          <p className="py-8 text-center text-muted-text">Loading plans…</p>
        ) : filteredPlans.length === 0 ? (
          <p className="py-8 text-center text-muted-text">
            {query ? 'No plans match your search' : 'No plans yet'}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-xl border border-border-subtle">
              <table className="admin-users-table w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/80 text-left">
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Plan</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Price</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Status</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Modules</th>
                    <th className="px-4 py-3 font-medium text-foreground-secondary">Models</th>
                    <th className="px-4 py-3 text-right font-medium text-foreground-secondary">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.pageItems.map((plan) => {
                    const isDefault = plan.id === defaultPlanId
                    const planModels = plan.models ?? []
                    return (
                      <tr
                        key={plan.id}
                        className="border-b border-border-subtle transition-colors last:border-b-0 hover:bg-surface-hover/50"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{plan.name}</div>
                          {plan.description ? (
                            <div className="mt-0.5 text-xs text-muted-text">{plan.description}</div>
                          ) : null}
                          {isDefault ? (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] px-2 py-0.5 text-xs font-semibold text-primary">
                              <Star className="size-3" aria-hidden />
                              Default for registration
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {formatPrice(plan.price)}
                        </td>
                        <td className="px-4 py-3">
                          {plan.is_active ? (
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
                          {plan.actions.length === 0 ? (
                            <span className="text-muted-text">None</span>
                          ) : (
                            <div className="flex max-w-xs flex-wrap gap-1.5">
                              {plan.actions.map((code) => (
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
                          {planModels.length === 0 ? (
                            <span className="text-muted-text">None</span>
                          ) : (
                            <div className="flex max-w-xs flex-wrap gap-1.5">
                              {planModels.map((model) => (
                                <span
                                  key={model}
                                  className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono text-[0.68rem] text-foreground-secondary ring-1 ring-border-subtle"
                                >
                                  {model}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            {!isDefault && plan.is_active && (
                              <button
                                type="button"
                                className={`${btnBase} ${btnCompact}`}
                                onClick={() => void handleSetDefault(plan.id)}
                              >
                                <Check className="size-3.5" aria-hidden />
                                Set default
                              </button>
                            )}
                            <button
                              type="button"
                              className={`${btnBase} ${btnCompact}`}
                              onClick={() => startEdit(plan)}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                              Edit
                            </button>
                            <button
                              type="button"
                              className={`${btnBase} ${btnCompact}`}
                              onClick={() => void handleDelete(plan)}
                              disabled={isDefault}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
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
            aria-labelledby="admin-plan-panel-title"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2
                id="admin-plan-panel-title"
                className="m-0 text-lg font-semibold text-foreground"
              >
                {editingPlanId == null ? 'Create plan' : 'Edit plan'}
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
                <label className={fieldLabel}>
                  <span>Price (USD)</span>
                  <input
                    className={fieldInput}
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </label>
                <label className={fieldCheckbox}>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <span>Active</span>
                </label>

                <fieldset className="mb-2 space-y-2 border-0 p-0">
                  <legend className="mb-2 text-sm font-medium text-foreground">Modules</legend>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                    {actions.map((action) => {
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
                            <span className="block font-mono text-sm text-foreground">
                              {action.code}
                            </span>
                            {action.description ? (
                              <span className="text-xs text-muted-text">{action.description}</span>
                            ) : null}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>

                <fieldset className="mb-2 space-y-2 border-0 p-0">
                  <legend className="mb-2 text-sm font-medium text-foreground">
                    AI models
                  </legend>
                  <p className="m-0 mb-2 text-xs text-muted-text">
                    Users on this plan only see and can run the selected models.
                  </p>
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                    {catalogModels.length === 0 ? (
                      <p className="m-0 px-2.5 py-2 text-sm text-muted-text">
                        No models available
                      </p>
                    ) : (
                      catalogModels.map((model) => {
                        const checked = selectedModels.includes(model)
                        return (
                          <label
                            key={model}
                            className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                              checked
                                ? 'bg-[color-mix(in_srgb,var(--app-primary)_10%,transparent)]'
                                : 'hover:bg-surface-hover'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleModel(model)}
                            />
                            <span className="font-mono text-sm text-foreground">{model}</span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </fieldset>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
                <button type="submit" className={btnPrimary}>
                  {editingPlanId == null ? 'Create plan' : 'Save changes'}
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
