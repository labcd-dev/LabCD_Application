import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Data } from 'plotly.js'
import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  RefreshCw,
  Repeat2,
  Users,
} from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { adminApi } from '../api/endpoints'
import type { AnalyticsResponse, TelegramAnalyticsSettings } from '../api/types'
import { PlotlyChart } from '../components/PlotlyChart'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldCheckbox,
  fieldInput,
  fieldLabel,
} from '../lib/classes'

const RANGE_OPTIONS = [7, 30, 90] as const

const MODULE_LABELS: Record<string, string> = {
  silo: 'Silo',
  mulo: 'Mulo',
  recommender: 'Recommender',
  trimmer: 'Trimmer',
  regularize: 'Regularizer',
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function formatCount(value: number | undefined, loading: boolean): string {
  if (loading || value == null) return '—'
  return value.toLocaleString()
}

const EMPTY_TELEGRAM: TelegramAnalyticsSettings = {
  enabled: false,
  chat_id: '',
  send_hour_utc: 8,
  bot_token_configured: false,
  bot_token_masked: '',
  last_sent_date: null,
}

export function AdminAnalyticsPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:analytics')
  const [days, setDays] = useState<(typeof RANGE_OPTIONS)[number]>(30)
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [telegram, setTelegram] = useState<TelegramAnalyticsSettings>(EMPTY_TELEGRAM)
  const [draftChatId, setDraftChatId] = useState('')
  const [draftHour, setDraftHour] = useState(8)
  const [draftBotToken, setDraftBotToken] = useState('')
  const [clearBotToken, setClearBotToken] = useState(false)
  const [savingTelegram, setSavingTelegram] = useState(false)
  const [testingTelegram, setTestingTelegram] = useState(false)

  const load = useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true)
      setError(null)
      try {
        const [response, telegramSettings] = await Promise.all([
          adminApi.getAnalytics(days),
          adminApi.getTelegramAnalyticsSettings(),
        ])
        setData(response)
        setTelegram(telegramSettings)
        setDraftChatId(telegramSettings.chat_id)
        setDraftHour(telegramSettings.send_hour_utc)
        setDraftBotToken('')
        setClearBotToken(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load analytics')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [days],
  )

  useEffect(() => {
    if (!canManage) return
    setLoading(true)
    void load()
  }, [load, canManage])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const dauSeries = data?.dau_series ?? []
  const mauSeries = data?.mau_series ?? []
  const modules = data?.modules ?? []
  const llms = data?.llms ?? []
  const mostUsedLlm = data?.most_used_llm ?? null

  const activityChart: Data[] = [
    {
      type: 'scatter',
      mode: 'lines',
      name: 'DAU',
      x: dauSeries.map((p) => p.date),
      y: dauSeries.map((p) => p.count),
      line: { width: 2, shape: 'spline' },
      hovertemplate: '%{x}<br>DAU: %{y}<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines',
      name: 'MAU (trailing 30d)',
      x: mauSeries.map((p) => p.date),
      y: mauSeries.map((p) => p.count),
      line: { width: 2, shape: 'spline' },
      hovertemplate: '%{x}<br>MAU: %{y}<extra></extra>',
    },
  ]

  const moduleChart: Data[] = [
    {
      type: 'bar',
      name: 'Runs',
      x: modules.map((m) => MODULE_LABELS[m.module] ?? m.module),
      y: modules.map((m) => m.count),
      hovertemplate: '%{x}: %{y}<extra></extra>',
    },
  ]

  const llmChart: Data[] = [
    {
      type: 'bar',
      name: 'Runs',
      x: llms.map((row) => row.model),
      y: llms.map((row) => row.count),
      hovertemplate: '%{x}: %{y}<extra></extra>',
    },
  ]

  const buildTelegramUpdate = () => {
    const body: {
      enabled: boolean
      chat_id: string
      send_hour_utc: number
      bot_token?: string
    } = {
      enabled: telegram.enabled,
      chat_id: draftChatId.trim(),
      send_hour_utc: draftHour,
    }
    if (clearBotToken) {
      body.bot_token = ''
    } else if (draftBotToken.trim()) {
      body.bot_token = draftBotToken.trim()
    }
    return body
  }

  const saveTelegram = async () => {
    setSavingTelegram(true)
    setError(null)
    setMessage(null)
    try {
      const next = await adminApi.updateTelegramAnalyticsSettings(buildTelegramUpdate())
      setTelegram(next)
      setDraftChatId(next.chat_id)
      setDraftHour(next.send_hour_utc)
      setDraftBotToken('')
      setClearBotToken(false)
      setMessage('Telegram daily report settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Telegram settings')
    } finally {
      setSavingTelegram(false)
    }
  }

  const toggleTelegramEnabled = async (enabled: boolean) => {
    setSavingTelegram(true)
    setError(null)
    setMessage(null)
    try {
      const next = await adminApi.updateTelegramAnalyticsSettings({ enabled })
      setTelegram(next)
      setMessage(
        next.enabled
          ? 'Telegram daily report enabled.'
          : 'Telegram daily report disabled.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update Telegram settings')
    } finally {
      setSavingTelegram(false)
    }
  }

  const sendTestReport = async () => {
    setTestingTelegram(true)
    setError(null)
    setMessage(null)
    try {
      const hasDraftChanges =
        draftChatId.trim() !== telegram.chat_id ||
        draftHour !== telegram.send_hour_utc ||
        clearBotToken ||
        Boolean(draftBotToken.trim())
      if (hasDraftChanges) {
        const saved = await adminApi.updateTelegramAnalyticsSettings(buildTelegramUpdate())
        setTelegram(saved)
        setDraftChatId(saved.chat_id)
        setDraftHour(saved.send_hour_utc)
        setDraftBotToken('')
        setClearBotToken(false)
      }
      const result = await adminApi.testTelegramAnalyticsReport()
      const refreshed = await adminApi.getTelegramAnalyticsSettings()
      setTelegram(refreshed)
      setMessage(result.detail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test report')
    } finally {
      setTestingTelegram(false)
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
            Analytics
          </h1>
          <p className="m-0 max-w-xl text-muted-text leading-relaxed">
            Daily and monthly active users, retention, most-used product modules, and LLM
            usage.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${btnCompact} border-0 ${
                  days === option
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-text hover:bg-surface-muted'
                }`}
                onClick={() => setDays(option)}
                disabled={loading || refreshing}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${btnBase} ${btnCompact}`}
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      </header>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Daily active users"
          value={formatCount(data?.dau_today, loading)}
          hint="Distinct users active today (UTC)"
          icon={Users}
        />
        <MetricCard
          label="Monthly active users"
          value={formatCount(data?.mau, loading)}
          hint="Distinct users in last 30 days"
          icon={CalendarDays}
        />
        <MetricCard
          label="D7 retention"
          value={loading ? '—' : formatPercent(data?.retention_d7)}
          hint="Cohort return rate on/after day 7"
          icon={Repeat2}
        />
        <MetricCard
          label="D30 retention"
          value={loading ? '—' : formatPercent(data?.retention_d30)}
          hint="Cohort return rate on/after day 30"
          icon={BarChart3}
        />
        <MetricCard
          label="Most used LLM"
          value={loading ? '—' : mostUsedLlm ?? '—'}
          hint={`Top model in selected ${days}d range`}
          icon={BrainCircuit}
          compactValue
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Active users" empty={!loading && dauSeries.length === 0}>
          <PlotlyChart
            data={activityChart}
            layout={{
              margin: { l: 40, r: 12, t: 12, b: 40 },
              legend: { orientation: 'h', y: 1.15 },
              xaxis: { title: { text: 'Date' } },
              yaxis: { title: { text: 'Users' }, rangemode: 'tozero' },
            }}
            height={280}
            revision={dauSeries.length + mauSeries.length}
          />
        </ChartCard>
        <ChartCard title="Most used modules" empty={!loading && modules.length === 0}>
          <PlotlyChart
            data={moduleChart}
            layout={{
              margin: { l: 40, r: 12, t: 12, b: 60 },
              showlegend: false,
              xaxis: { title: { text: 'Module' } },
              yaxis: { title: { text: 'Runs' }, rangemode: 'tozero' },
            }}
            height={280}
            revision={modules.length}
          />
        </ChartCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-1">
        <ChartCard title="Most used LLMs" empty={!loading && llms.length === 0}>
          <PlotlyChart
            data={llmChart}
            layout={{
              margin: { l: 40, r: 12, t: 12, b: 80 },
              showlegend: false,
              xaxis: { title: { text: 'Model' }, tickangle: -25 },
              yaxis: { title: { text: 'Runs' }, rangemode: 'tozero' },
            }}
            height={280}
            revision={llms.length}
          />
        </ChartCard>
      </section>

      <section className={cardPanel}>
        <h2 className="m-0 mb-1 text-base font-semibold text-foreground">
          Telegram daily report
        </h2>
        <p className="m-0 mb-4 text-sm text-muted-text leading-relaxed">
          Send a once-per-day digest (DAU, MAU, retention, module runs, LLM usage) to a
          Telegram channel. Bot token is stored in the API <code className="text-xs">.env</code>{' '}
          (same pattern as provider API keys). Leave the token empty to log digests to the
          console.
        </p>
        <label className={fieldCheckbox}>
          <input
            type="checkbox"
            checked={telegram.enabled}
            disabled={savingTelegram || loading}
            onChange={(e) => void toggleTelegramEnabled(e.target.checked)}
          />
          <span>Enable daily Telegram digest</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={fieldLabel}>
            <span>Bot token</span>
            <input
              className={fieldInput}
              type="password"
              value={draftBotToken}
              onChange={(e) => {
                setDraftBotToken(e.target.value)
                if (e.target.value) setClearBotToken(false)
              }}
              placeholder={
                telegram.bot_token_configured
                  ? 'Leave blank to keep current'
                  : '123456:ABC-your-bot-token'
              }
              disabled={savingTelegram || loading || clearBotToken}
              autoComplete="off"
            />
          </label>
          <label className={fieldLabel}>
            <span>Channel / chat ID</span>
            <input
              className={fieldInput}
              value={draftChatId}
              onChange={(e) => setDraftChatId(e.target.value)}
              placeholder="-100xxxxxxxxxx"
              disabled={savingTelegram || loading}
              autoComplete="off"
            />
          </label>
          <label className={fieldLabel}>
            <span>Send hour (UTC, 0–23)</span>
            <input
              className={fieldInput}
              type="number"
              min={0}
              max={23}
              value={draftHour}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (Number.isNaN(next)) return
                setDraftHour(Math.max(0, Math.min(23, Math.trunc(next))))
              }}
              disabled={savingTelegram || loading}
            />
          </label>
        </div>
        <label className={fieldCheckbox}>
          <input
            type="checkbox"
            checked={clearBotToken}
            disabled={savingTelegram || loading || !telegram.bot_token_configured}
            onChange={(e) => {
              setClearBotToken(e.target.checked)
              if (e.target.checked) setDraftBotToken('')
            }}
          />
          <span>Clear bot token</span>
        </label>
        <dl className="mt-2 mb-4 grid gap-2 text-sm text-muted-text sm:grid-cols-2">
          <div>
            <dt className="inline font-medium text-foreground">Bot token: </dt>
            <dd className="inline m-0">
              {telegram.bot_token_configured
                ? `configured ${telegram.bot_token_masked}`
                : 'not set (console fallback)'}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Last sent (UTC date): </dt>
            <dd className="inline m-0">{telegram.last_sent_date ?? '—'}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnPrimary}
            onClick={() => void saveTelegram()}
            disabled={savingTelegram || testingTelegram || loading}
          >
            Save settings
          </button>
          <button
            type="button"
            className={btnBase}
            onClick={() => void sendTestReport()}
            disabled={savingTelegram || testingTelegram || loading}
          >
            {testingTelegram ? 'Sending…' : 'Send test now'}
          </button>
        </div>
      </section>
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  compactValue = false,
}: {
  label: string
  value: string
  hint: string
  icon: typeof Users
  compactValue?: boolean
}) {
  return (
    <div
      className={`${cardPanel} relative overflow-hidden transition-transform duration-200 hover:-translate-y-0.5`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
          <div
            className={`mt-2 font-semibold tracking-tight text-foreground ${
              compactValue
                ? 'break-all text-base sm:text-lg'
                : 'text-2xl sm:text-3xl'
            }`}
            title={value}
          >
            {value}
          </div>
          <div className="mt-1 text-sm text-muted-text">{hint}</div>
        </div>
        <div className="rounded-xl bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] p-2.5 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
      </div>
    </div>
  )
}

function ChartCard({
  title,
  empty,
  children,
}: {
  title: string
  empty: boolean
  children: ReactNode
}) {
  return (
    <div className={cardPanel}>
      <h2 className="m-0 mb-2 text-sm font-semibold text-foreground">{title}</h2>
      {empty ? (
        <p className="m-0 py-12 text-center text-sm text-muted-text">
          No data yet for this range. Metrics start after users are active, modules run, or
          LLMs are used.
        </p>
      ) : (
        children
      )}
    </div>
  )
}
