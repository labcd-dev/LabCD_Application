import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban, Package, Shield, UserCheck, Users, Zap } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { OverviewStats, PlanInfo } from '../api/types'
import { AdminDownloadCsvButton } from '../components/admin/AdminDownloadCsvButton'
import { StatusMessage } from '../components/StatusMessage'
import { downloadCsv } from '../lib/downloadCsv'
import { btnPrimary, cardPanel } from '../lib/classes'

export function AdminOverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [plans, setPlans] = useState<PlanInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [overviewStats, planList] = await Promise.all([
          adminApi.getOverviewStats(),
          adminApi.listPlans({ page: 1, page_size: 100 }),
        ])
        setStats(overviewStats)
        setPlans(planList.items)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load overview')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const defaultPlanId = stats?.default_plan_id ?? null
  const defaultPlanName = stats?.default_plan_name ?? null

  const statCards = [
    {
      label: 'Total users',
      value: loading ? '—' : String(stats?.users_total ?? 0),
      icon: Users,
      hint: 'Accounts on this platform',
    },
    {
      label: 'Active',
      value: loading ? '—' : String(stats?.users_active ?? 0),
      icon: UserCheck,
      hint: 'Can sign in today',
    },
    {
      label: 'Plans',
      value: loading ? '—' : String(stats?.plans_active ?? 0),
      icon: Package,
      hint: defaultPlanName
        ? `Default registration: ${defaultPlanName}`
        : 'Active access tiers',
    },
    {
      label: 'Projects',
      value: loading ? '—' : String(stats?.projects_total ?? 0),
      icon: FolderKanban,
      hint: 'User design sessions',
    },
    {
      label: 'Admins',
      value: loading ? '—' : String(stats?.users_admins ?? 0),
      icon: Shield,
      hint: 'Full control access',
    },
    {
      label: 'Catalog size',
      value: loading ? '—' : String(stats?.max_modules ?? 0),
      icon: Zap,
      hint: 'Most modules on a single plan',
    },
  ]

  return (
    <div className="admin-fade-in space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Administration
          </p>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Overview
          </h1>
          <p className="m-0 max-w-xl text-muted-text leading-relaxed">
            Manage plans, assign them to users, and choose the default plan for registration.
          </p>
        </div>
        <AdminDownloadCsvButton
          label="Download all Data"
          onClick={async () => {
            setError(null)
            try {
              await downloadCsv(() => adminApi.downloadOverviewCsv(), 'admin_all_data.xlsx')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to download data')
            }
          }}
          disabled={loading}
        />
      </header>

      {error && <StatusMessage type="error" message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statCards.map(({ label, value, icon: Icon, hint }) => (
          <div
            key={label}
            className={`${cardPanel} relative overflow-hidden transition-transform duration-200 hover:-translate-y-0.5`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  {label}
                </div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                  {value}
                </div>
                <div className="mt-1 text-sm text-muted-text">{hint}</div>
              </div>
              <div className="rounded-xl bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] p-2.5 text-primary">
                <Icon className="size-5" aria-hidden />
              </div>
            </div>
          </div>
        ))}
      </div>

      <section className={`${cardPanel} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="m-0 text-lg font-semibold text-foreground">Plans & modules</h2>
          <p className="mt-1 mb-0 text-sm text-muted-text leading-relaxed">
            Create priced plans, attach modules, and set the default plan for new registrations.
          </p>
        </div>
        <Link to="/admin/plans" className={`${btnPrimary} shrink-0`}>
          <Package className="size-4" aria-hidden />
          Manage plans
        </Link>
      </section>

      <section className={`${cardPanel} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="m-0 text-lg font-semibold text-foreground">Users</h2>
          <p className="mt-1 mb-0 text-sm text-muted-text leading-relaxed">
            Create accounts, set admin role, and assign a plan for module access.
          </p>
        </div>
        <Link to="/admin/users" className={`${btnPrimary} shrink-0`}>
          <Users className="size-4" aria-hidden />
          Manage users
        </Link>
      </section>

      <section className={`${cardPanel} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="m-0 text-lg font-semibold text-foreground">User projects</h2>
          <p className="mt-1 mb-0 text-sm text-muted-text leading-relaxed">
            Inspect uploaded dynamics files and design results across all user projects.
          </p>
        </div>
        <Link to="/admin/projects" className={`${btnPrimary} shrink-0`}>
          <FolderKanban className="size-4" aria-hidden />
          Manage projects
        </Link>
      </section>

      {!loading && plans.length > 0 && (
        <section className={cardPanel}>
          <h2 className="m-0 text-lg font-semibold text-foreground">Plan catalog</h2>
          <p className="mt-1 mb-4 text-sm text-muted-text">
            Access tiers available for assignment.
          </p>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {plans.map((plan) => (
              <li
                key={plan.id}
                className="rounded-lg border border-border-subtle bg-surface-muted px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-foreground">{plan.name}</div>
                  <div className="text-sm text-muted-text">
                    {plan.price === 0 ? 'Free' : `$${plan.price}`}
                  </div>
                </div>
                {plan.description ? (
                  <div className="mt-0.5 text-xs text-muted-text">{plan.description}</div>
                ) : null}
                <div className="mt-1 text-xs text-muted-text">
                  {plan.actions.length} module{plan.actions.length === 1 ? '' : 's'}
                  {plan.id === defaultPlanId ? ' · default' : ''}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
