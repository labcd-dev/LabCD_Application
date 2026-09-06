import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Loader2, Search } from 'lucide-react'
import { plantArtifactApi, plantModelApi } from '../api/endpoints'
import type { PlantModelConversationSummary } from '../api/types'
import {
  LaunchModuleModal,
  type LaunchPipeline,
} from '../components/LaunchModuleModal'
import { StatusMessage } from '../components/StatusMessage'
import { usePipeline } from '../context/PipelineContext'
import { btnBase, btnCompact, btnPrimary } from '../lib/classes'
import { parseApiDate } from '../lib/formatDateTime'

type StatusFilter = 'all' | 'tuned' | 'untuned'

const SPARK_PATHS = [
  'M2,34 C10,34 12,10 22,8 C34,6 40,20 50,20 C62,20 66,12 78,12 L104,12',
  'M2,30 C14,30 16,6 28,6 C40,6 42,26 56,26 C70,26 72,14 86,14 L104,16',
  'M2,32 C20,32 30,20 46,20 C66,20 74,16 90,16 L104,15',
]

const SPARK_ENDPOINTS = [
  { x: 104, y: 12 },
  { x: 104, y: 16 },
  { x: 104, y: 15 },
]

function sparkPath(seed: number): string {
  return SPARK_PATHS[Math.abs(seed) % SPARK_PATHS.length]
}

function sparkEndpoint(seed: number): { x: number; y: number } {
  return SPARK_ENDPOINTS[Math.abs(seed) % SPARK_ENDPOINTS.length]
}

function relativeUpdatedAt(value: string): string {
  const date = parseApiDate(value)
  if (!date) return 'Updated recently'
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return 'Updated just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? 'Updated 1h ago' : `Updated ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Updated yesterday'
  if (days < 7) return `Updated ${days}d ago`
  if (days < 14) return 'Updated 1w ago'
  return `Updated ${Math.floor(days / 7)}w ago`
}

function displayName(row: PlantModelConversationSummary): string {
  return row.system_name?.trim() || row.title || 'Untitled system'
}

export function CaseStudiesPage() {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const [searchParams, setSearchParams] = useSearchParams()
  const newIdRaw = searchParams.get('new')
  const newId = newIdRaw ? Number(newIdRaw) : null

  const [rows, setRows] = useState<PlantModelConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [launchTarget, setLaunchTarget] = useState<PlantModelConversationSummary | null>(null)
  const [launching, setLaunching] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await plantModelApi.listConversations())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load case studies')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const bannerRow =
    newId != null && !Number.isNaN(newId)
      ? rows.find((row) => row.id === newId) ?? null
      : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter === 'tuned' && row.status !== 'complete') return false
      if (filter === 'untuned' && row.status !== 'active') return false
      if (!q) return true
      const name = displayName(row).toLowerCase()
      return name.includes(q) || row.title.toLowerCase().includes(q)
    })
  }, [rows, query, filter])

  const dismissBanner = () => {
    setBannerDismissed(true)
    if (searchParams.has('new')) {
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }

  const handleLaunch = async (selected: LaunchPipeline) => {
    if (!launchTarget) return
    setLaunching(true)
    setError(null)
    try {
      const detail = await plantModelApi.getConversation(launchTarget.id)
      const result = detail.final_result
      if (!result?.python_code) {
        setError('This case study has no completed plant model yet. Continue the chat first.')
        setLaunchTarget(null)
        return
      }
      const safeName =
        result.system_name.trim().replace(/[^\w\-]+/g, '_') || 'dynamics'
      pipeline.setFile(`${safeName}.py`, 'python', result.python_code)
      pipeline.setPipeline(selected)
      if (detail.llm_model) {
        pipeline.setModel(detail.llm_model)
      }
      if (selected === 'adaptiveDesign' || selected === 'mpcDesign') {
        try {
          const artifacts = await plantArtifactApi.listArtifacts()
          const matched = artifacts.find(
            (a) => a.system_name?.trim().toLowerCase() === result.system_name.trim().toLowerCase()
          )
          if (matched) {
            sessionStorage.setItem('labcd_last_artifact_id', matched.artifact_id)
          }
        } catch {
          // ignore lookup errors
        }
      }
      setLaunchTarget(null)
      if (selected === 'adaptiveDesign') {
        navigate('/adaptive')
      } else if (selected === 'mpcDesign') {
        navigate('/mpc')
      } else {
        navigate('/studio')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch studio')
    } finally {
      setLaunching(false)
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em] text-foreground">
            Your case studies
          </h1>
          <p className="mt-1 mb-0 text-[13px] text-muted-text">
            Every plant model you start in chat lives here — pick one to continue or tune.
          </p>
        </div>
      </header>

      {error && <StatusMessage type="error" message={error} />}

      {bannerRow && !bannerDismissed && (
        <div className="mb-1 flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--app-status-success-text)_28%,transparent)] bg-[var(--app-status-success-bg)] px-4 py-3 text-[13px] text-[var(--app-status-success-text)]">
          <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">{displayName(bannerRow)}</strong> was just saved from
            your chat. Configure it below to start tuning.
          </span>
          <button
            type="button"
            className={`${btnBase} ${btnCompact} shrink-0`}
            onClick={dismissBanner}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-[10px] border border-border bg-surface-elevated px-3 py-2">
          <Search className="size-[15px] shrink-0 text-muted" aria-hidden />
          <input
            type="search"
            className="min-w-0 flex-1 border-none bg-transparent font-inherit text-[13px] text-foreground outline-none placeholder:text-muted"
            placeholder="Search case studies..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search case studies"
          />
        </div>
        <div className="flex gap-1.5">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'tuned', label: 'Tuned' },
              { id: 'untuned', label: 'Untuned' },
            ] as const
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              className={`rounded-lg border px-3 py-[7px] text-xs font-semibold transition-all duration-125 ${
                filter === pill.id
                  ? 'border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
                  : 'border-border bg-surface-elevated text-muted-text hover:text-foreground'
              }`}
              aria-pressed={filter === pill.id}
              onClick={() => setFilter(pill.id)}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <span className="text-sm">Loading case studies…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-border px-5 py-20 text-center text-muted">
          <h3 className="m-0 mb-1.5 text-base font-semibold text-foreground">
            {rows.length === 0 ? 'No case studies yet' : 'No matching case studies'}
          </h3>
          <p className="m-0 mb-[18px] text-[13px]">
            {rows.length === 0
              ? 'Start a chat to describe a system and confirm your first plant model.'
              : 'Try a different search or filter.'}
          </p>
          {rows.length === 0 && (
            <Link to="/design" className={`${btnPrimary} inline-flex`}>
              Start a chat
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-3.5">
          {filtered.map((row) => {
            const name = displayName(row)
            const isComplete = row.status === 'complete'
            const canLaunch = isComplete || Boolean(row.system_name?.trim())
            const highlight = newId === row.id && !bannerDismissed
            return (
              <article
                key={row.id}
                className={`card-alive group relative flex flex-col gap-3 rounded-xl p-4 overflow-hidden ${
                  highlight
                    ? 'border-[color-mix(in_srgb,var(--app-status-success-text)_40%,transparent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--app-status-success-text)_20%,transparent)]'
                    : ''
                }`}
              >
                {/* Luminous top-edge hairline */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="mb-1 truncate text-[14.5px] font-semibold text-foreground group-hover:text-primary transition-colors">
                      {name}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-muted/90 px-2 py-0.5 text-[10.5px] font-semibold text-muted">
                        <span
                          className={`inline-block size-1.5 rounded-full ${
                            isComplete
                              ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-[live-ping_2.4s_infinite]'
                              : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse'
                          }`}
                        />
                        {isComplete ? 'model ready' : 'in progress'}
                      </span>
                      {isComplete && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--app-status-success-text)_28%,transparent)] bg-[color-mix(in_srgb,var(--app-status-success-text)_10%,transparent)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--app-status-success-text)] shadow-[0_0_10px_rgba(34,211,167,0.12)]">
                          <Check className="size-2.5" strokeWidth={3} /> tuned
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Oscilloscope Sparkline Waveform */}
                <div className="relative h-[48px] overflow-hidden rounded-lg border border-border-subtle bg-surface-muted/60">
                  <svg
                    viewBox="0 0 106 40"
                    preserveAspectRatio="none"
                    className="block size-full"
                    aria-hidden
                  >
                    <defs>
                      <linearGradient id={`spark-grad-${row.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="var(--app-primary)" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="var(--app-primary)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id={`spark-glow-${row.id}`} x="-10%" y="-10%" width="120%" height="120%">
                        <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="var(--app-primary)" floodOpacity="0.6" />
                      </filter>
                    </defs>
                    <path
                      d={`${sparkPath(row.id)} L104,40 L2,40 Z`}
                      fill={`url(#spark-grad-${row.id})`}
                    />
                    <path
                      d={sparkPath(row.id)}
                      fill="none"
                      stroke="var(--app-primary)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      filter={`url(#spark-glow-${row.id})`}
                    />
                    <circle
                      cx={sparkEndpoint(row.id).x}
                      cy={sparkEndpoint(row.id).y}
                      r="2"
                      className="fill-primary"
                    />
                    <circle
                      cx={sparkEndpoint(row.id).x}
                      cy={sparkEndpoint(row.id).y}
                      r="4"
                      className="fill-primary animate-ping opacity-35"
                    />
                  </svg>
                </div>

                <div className="flex justify-between items-center gap-2 text-[11.5px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block size-1 rounded-full bg-slate-500" />
                    {relativeUpdatedAt(row.updated_at)}
                  </span>
                  <span className={canLaunch ? 'text-primary font-medium' : 'text-slate-400'}>
                    {canLaunch ? 'Ready to tune' : 'Not tuned yet'}
                  </span>
                </div>

                <div className="mt-0.5 flex gap-2">
                  <Link
                    to={`/design?conversation=${row.id}`}
                    className={`${btnBase} ${btnCompact} flex-1 justify-center no-underline whitespace-nowrap text-xs px-2`}
                  >
                    Continue chat
                  </Link>
                  <button
                    type="button"
                    className={`${btnPrimary} ${btnCompact} flex-1 justify-center whitespace-nowrap text-xs px-2`}
                    disabled={!canLaunch}
                    title={
                      canLaunch
                        ? 'Choose a module and launch Studio'
                        : 'Finish the plant model in chat first'
                    }
                    onClick={() => setLaunchTarget(row)}
                  >
                    {isComplete ? 'Re-tune' : 'Configure & launch'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <LaunchModuleModal
        open={launchTarget != null}
        title={launchTarget ? displayName(launchTarget) : ''}
        subtitle={
          launchTarget?.status === 'complete'
            ? 'Select Single Loop or Multi Loop, then launch Studio.'
            : undefined
        }
        launching={launching}
        onClose={() => {
          if (!launching) setLaunchTarget(null)
        }}
        onLaunch={(selected) => void handleLaunch(selected)}
      />
    </section>
  )
}
