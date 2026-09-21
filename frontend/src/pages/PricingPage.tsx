import { useEffect, useMemo, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { billingApi } from '../api/endpoints'
import type { BillingStatus, PublicPlan } from '../api/types'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { btnBase, btnPrimary, pageIntro, pageSection, pageTitle } from '../lib/classes'

type Interval = 'month' | 'year'

// Friendly, static feature copy per plan_code (the plan.actions codes aren't
// user-facing labels). Keep this in sync with plan_service.STRIPE_BILLING_PLAN_DEFS
// if the seeded feature set ever changes.
const FEATURES: Record<string, string[]> = {
  plus: ['Single Loop pipeline', 'Core LLM models', 'Email support'],
  pro: ['Everything in Plus', 'Multi Loop pipeline', 'Full LLM model catalog', 'Priority support'],
  business: [
    'Everything in Pro',
    'Adaptive Control pipeline',
    'MPC pipeline',
    'Priority support',
  ],
  enterprise: [
    'Everything in Business',
    'Custom volume & usage limits',
    'SSO',
    'Dedicated support',
  ],
}

const CONTACT_EMAIL = 'sales@labcd.app'

function formatMoney(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function PricingPage() {
  const { user, hasAction } = useAuth()
  const [plans, setPlans] = useState<PublicPlan[]>([])
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [interval, setInterval] = useState<Interval>('month')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [busyPlanId, setBusyPlanId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [planRows, statusRow] = await Promise.all([
          billingApi.getPlans(),
          billingApi.getStatus(),
        ])
        if (cancelled) return
        setPlans(planRows)
        setStatus(statusRow)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load plans')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const hasYearlyOption = useMemo(
    () => plans.some((plan) => plan.price_yearly != null),
    [plans],
  )

  const handleSubscribe = async (plan: PublicPlan) => {
    setCheckoutError(null)
    setBusyPlanId(plan.id)
    try {
      const { url } = await billingApi.createCheckoutSession({
        plan_id: plan.id,
        interval,
      })
      window.location.href = url
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Failed to start checkout')
      setBusyPlanId(null)
    }
  }

  return (
    <div className={pageSection}>
      <div>
        <h1 className={pageTitle}>Plans & billing</h1>
        <p className={pageIntro}>
          Pick the plan that fits your team. Upgrade, downgrade, or cancel any time from your
          Profile page.
        </p>
      </div>

      {status && !status.stripe_enabled && hasAction('admin:api_keys') && (
        <StatusMessage
          type="warning"
          message="Stripe isn't configured yet. Add STRIPE_SECRET_KEY from Admin -> API keys to enable checkout."
        />
      )}
      {error && <StatusMessage type="error" message={error} />}
      {checkoutError && <StatusMessage type="error" message={checkoutError} />}

      {hasYearlyOption && (
        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted p-1">
          <button
            type="button"
            onClick={() => setInterval('month')}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              interval === 'month'
                ? 'bg-surface-elevated text-foreground shadow-sm'
                : 'text-muted-text'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval('year')}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              interval === 'year'
                ? 'bg-surface-elevated text-foreground shadow-sm'
                : 'text-muted-text'
            }`}
          >
            Yearly
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-text">Loading plans…</p>
      ) : plans.length === 0 ? (
        <StatusMessage
          type="info"
          message="No pricing plans are configured yet. Check back soon."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const isCurrent = user?.plan_id === plan.id
            const price = interval === 'year' ? plan.price_yearly ?? plan.price : plan.price
            const canBuy = plan.purchasable && !!status?.stripe_enabled
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border p-5 shadow-sm ${
                  plan.is_most_popular
                    ? 'border-primary/50 bg-surface-elevated shadow-[0_4px_24px_rgba(99,102,241,0.18)]'
                    : 'border-border bg-surface-elevated/90'
                }`}
              >
                {plan.is_most_popular && (
                  <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-gradient-to-r from-primary via-indigo-500 to-[#4a63e0] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm">
                    <Sparkles className="size-3" /> Most popular
                  </span>
                )}

                <h2 className="m-0 text-lg font-semibold text-foreground">{plan.name}</h2>
                <p className="mt-1 mb-0 min-h-[2.5em] text-sm text-muted-text">
                  {plan.description}
                </p>

                <div className="mt-4">
                  {plan.is_contact_sales ? (
                    <p className="m-0 text-2xl font-semibold text-foreground">Custom</p>
                  ) : (
                    <p className="m-0 text-2xl font-semibold text-foreground">
                      ${formatMoney(price)}
                      <span className="text-sm font-normal text-muted-text">
                        {interval === 'year' ? '/yr' : '/mo'}
                      </span>
                    </p>
                  )}
                </div>

                <ul className="mt-4 mb-0 flex-1 list-none space-y-2 p-0 text-sm">
                  {(FEATURES[plan.plan_code ?? ''] ?? []).map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      {feature}
                    </li>
                  ))}
                </ul>

                <div className="mt-5">
                  {plan.is_contact_sales ? (
                    <a
                      href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                        `${plan.name} plan`,
                      )}`}
                      className={`${btnBase} w-full`}
                    >
                      Contact us
                    </a>
                  ) : isCurrent ? (
                    <button type="button" className={`${btnBase} w-full`} disabled>
                      Current plan
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${plan.is_most_popular ? btnPrimary : btnBase} w-full`}
                      disabled={!canBuy || busyPlanId === plan.id}
                      onClick={() => void handleSubscribe(plan)}
                      title={!canBuy ? 'This plan is not yet available for checkout' : undefined}
                    >
                      {busyPlanId === plan.id
                        ? 'Redirecting…'
                        : canBuy
                          ? 'Subscribe'
                          : 'Coming soon'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
