import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity,
  Check,
  Cpu,
  FolderOpen,
  Layers,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react'
import { plantArtifactApi, plantModelApi, projectsApi } from '../api/endpoints'
import type { PlantModelConversationSummary, ProjectPipelineType, ProjectSummary } from '../api/types'
import {
  LaunchModuleModal,
  type LaunchPipeline,
} from '../components/LaunchModuleModal'
import { ConfirmModal } from '../components/ConfirmModal'
import { StatusMessage } from '../components/StatusMessage'
import { usePipeline } from '../context/PipelineContext'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldInput,
  pageIntro,
  pageSection,
} from '../lib/classes'
import { pipelineBadgeClass, pipelineLabel, statusBadgeClass } from '../lib/projectLabels'
import { canRetryProject, retryProject } from '../lib/retryProject'
import { formatDateTime, parseApiDate } from '../lib/formatDateTime'

type CaseStatusFilter = 'all' | 'tuned' | 'untuned'
type ProjPipelineFilter = 'all' | ProjectPipelineType

interface ModuleFilterOption {
  id: ProjPipelineFilter
  label: string
  shortLabel: string
  icon: typeof Sparkles
  accentColor: string
  activeStyle: string
}

const MODULE_FILTERS: ModuleFilterOption[] = [
  {
    id: 'all',
    label: 'All Runs',
    shortLabel: 'All',
    icon: Layers,
    accentColor: 'text-foreground',
    activeStyle: 'border-primary bg-[color-mix(in_srgb,var(--app-primary)_15%,transparent)] text-primary shadow-xs font-bold',
  },
  {
    id: 'siloDesign',
    label: 'Single Loop',
    shortLabel: 'SISO',
    icon: Sparkles,
    accentColor: 'text-blue-500',
    activeStyle: 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400 shadow-xs font-bold',
  },
  {
    id: 'muloDesign',
    label: 'Multi Loop',
    shortLabel: 'MIMO',
    icon: Cpu,
    accentColor: 'text-indigo-500',
    activeStyle: 'border-indigo-500 bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold',
  },
  {
    id: 'adaptiveDesign',
    label: 'Adaptive Control',
    shortLabel: 'Adaptive',
    icon: Activity,
    accentColor: 'text-cyan-500',
    activeStyle: 'border-cyan-500 bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 shadow-xs font-bold',
  },
  {
    id: 'mpcDesign',
    label: 'MPC Control',
    shortLabel: 'MPC',
    icon: Workflow,
    accentColor: 'text-purple-500',
    activeStyle: 'border-purple-500 bg-purple-500/15 text-purple-600 dark:text-purple-300 shadow-xs font-bold',
  },
]

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

export function ProjectsPage({
  defaultTab = 'cases',
}: {
  defaultTab?: 'cases' | 'history'
} = {}) {
  const navigate = useNavigate()
  const pipeline = usePipeline()
  const [searchParams] = useSearchParams()

  const tabParam = searchParams.get('tab') as 'cases' | 'history' | null
  const [activeTab, setActiveTab] = useState<'cases' | 'history'>(tabParam || defaultTab)

  // Case studies state
  const [caseRows, setCaseRows] = useState<PlantModelConversationSummary[]>([])
  const [caseLoading, setCaseLoading] = useState(true)
  const [caseError, setCaseError] = useState<string | null>(null)
  const [caseQuery, setCaseQuery] = useState('')
  const [caseFilter, setCaseFilter] = useState<CaseStatusFilter>('all')
  const [launchTarget, setLaunchTarget] = useState<PlantModelConversationSummary | null>(null)
  const [launching, setLaunching] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // Projects state
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projLoading, setProjLoading] = useState(true)
  const [projError, setProjError] = useState<string | null>(null)
  const [projQuery, setProjQuery] = useState('')
  const [projFilter, setProjFilter] = useState<ProjPipelineFilter>('all')
  const [retryingId, setRetryingId] = useState<number | null>(null)

  const newIdRaw = searchParams.get('new')
  const newId = newIdRaw ? Number(newIdRaw) : null

  // Fetch both sets of data once on mount so tab switching is instantaneous
  useEffect(() => {
    let active = true

    // Load case studies
    setCaseLoading(true)
    plantModelApi
      .listConversations()
      .then((data) => {
        if (active) {
          setCaseRows(data)
          setCaseError(null)
        }
      })
      .catch((err) => {
        if (active) {
          setCaseError(err instanceof Error ? err.message : 'Failed to load case studies')
        }
      })
      .finally(() => {
        if (active) setCaseLoading(false)
      })

    // Load projects
    setProjLoading(true)
    projectsApi
      .list()
      .then((data) => {
        if (active) {
          setProjects(data)
          setProjError(null)
        }
      })
      .catch((err) => {
        if (active) {
          setProjError(err instanceof Error ? err.message : 'Failed to load projects')
        }
      })
      .finally(() => {
        if (active) setProjLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  // Sync tab from URL if changed externally
  useEffect(() => {
    if (tabParam && (tabParam === 'cases' || tabParam === 'history')) {
      setActiveTab(tabParam)
    }
  }, [tabParam])

  // Zero-jump tab changer: updates URL quietly without triggering page jump
  const handleTabChange = (tab: 'cases' | 'history') => {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    window.history.replaceState(null, '', url.toString())
  }

  const bannerRow =
    newId != null && !Number.isNaN(newId)
      ? caseRows.find((row) => row.id === newId) ?? null
      : searchParams.get('artifact_id') && caseRows.length > 0
        ? caseRows[0]
        : null

  const dismissBanner = () => {
    setBannerDismissed(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('new')
    url.searchParams.delete('artifact_id')
    window.history.replaceState(null, '', url.toString())
  }

  const handleLaunch = async (selected: LaunchPipeline) => {
    if (!launchTarget) return
    setLaunching(true)
    setCaseError(null)
    try {
      const detail = await plantModelApi.getConversation(launchTarget.id)
      const result = detail.final_result
      if (!result?.python_code) {
        setCaseError('This case study has no completed plant model yet. Continue the chat first.')
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
      } else if (selected === 'siloDesign') {
        navigate('/silo')
      } else if (selected === 'muloDesign') {
        navigate('/recommender')
      } else {
        navigate('/case-studies')
      }
    } catch (err) {
      setCaseError(err instanceof Error ? err.message : 'Failed to launch module')
    } finally {
      setLaunching(false)
    }
  }

  const handleRetry = async (projectId: number) => {
    setRetryingId(projectId)
    setProjError(null)
    try {
      const detail = await projectsApi.get(projectId)
      await retryProject(detail, pipeline, navigate)
    } catch (err) {
      setProjError(err instanceof Error ? err.message : 'Failed to retry project')
      setRetryingId(null)
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<PlantModelConversationSummary | null>(null)
  const [deletingCaseId, setDeletingCaseId] = useState<number | null>(null)

  const handleDeleteCase = (row: PlantModelConversationSummary) => {
    setDeleteTarget(row)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setDeletingCaseId(deleteTarget.id)
    setCaseError(null)
    try {
      await plantModelApi.deleteConversation(deleteTarget.id)
      setCaseRows((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      if (newId === deleteTarget.id) {
        dismissBanner()
      }
      setDeleteTarget(null)
    } catch (err) {
      setCaseError(err instanceof Error ? err.message : 'Failed to delete case study')
    } finally {
      setDeletingCaseId(null)
    }
  }

  // Filtered case studies
  const filteredCases = useMemo(() => {
    const q = caseQuery.trim().toLowerCase()
    return caseRows.filter((row) => {
      if (caseFilter === 'tuned' && row.status !== 'complete') return false
      if (caseFilter === 'untuned' && row.status !== 'active') return false
      if (!q) return true
      const name = displayName(row).toLowerCase()
      return name.includes(q) || row.title.toLowerCase().includes(q)
    })
  }, [caseRows, caseQuery, caseFilter])

  // Dynamic counts per module for project filters
  const moduleCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: projects.length,
      siloDesign: 0,
      muloDesign: 0,
      adaptiveDesign: 0,
      mpcDesign: 0,
    }
    for (const p of projects) {
      if (p.pipeline_type && counts[p.pipeline_type] !== undefined) {
        counts[p.pipeline_type] = (counts[p.pipeline_type] || 0) + 1
      }
    }
    return counts
  }, [projects])

  // Filtered projects
  const filteredProjects = useMemo(() => {
    const q = projQuery.trim().toLowerCase()
    return projects.filter((project) => {
      if (projFilter !== 'all' && project.pipeline_type !== projFilter) return false
      if (!q) return true
      return (
        project.title.toLowerCase().includes(q) ||
        project.file_name.toLowerCase().includes(q) ||
        project.status.toLowerCase().includes(q)
      )
    })
  }, [projects, projQuery, projFilter])

  return (
    <section className={pageSection}>
      {/* Universal Fixed-Height Header */}
      <header className="space-y-3 pb-1 border-b border-border/60">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary shadow-[0_0_10px_rgba(99,102,241,0.15)]">
                <Layers className="size-3" />
                Control Workspace
              </span>
              <span className="text-xs text-muted">
                {activeTab === 'cases'
                  ? `${caseRows.length} Systems Available`
                  : `${projects.length} Saved Design Runs`}
              </span>
            </div>
            <h1 className="m-0 text-xl font-bold tracking-tight text-foreground sm:text-2xl flex items-center gap-2.5">
              {activeTab === 'cases' ? (
                <>
                  <Cpu className="size-6 text-primary" />
                  Case Studies & Benchmark Systems
                </>
              ) : (
                <>
                  <FolderOpen className="size-6 text-indigo-400" />
                  Project History & Design Runs
                </>
              )}
            </h1>
            <p className={`${pageIntro} mt-1 mb-0 max-w-2xl`}>
              {activeTab === 'cases'
                ? 'Benchmark systems and dynamic models identified via AI chat — configure and launch directly into MPC, Adaptive, or Classical control modules.'
                : 'Review your historical Single Loop, Multi Loop, Adaptive, and MPC control optimization runs, inspect model code, and re-run controllers with new parameters.'}
            </p>
          </div>

          {/* Frictionless Segmented Tab Switcher (Case Studies Priority) */}
          <div className="flex items-center rounded-xl border border-border bg-surface-elevated/80 p-1 backdrop-blur-md shadow-sm">
            <button
              type="button"
              onClick={() => handleTabChange('cases')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all duration-150 ${
                activeTab === 'cases'
                  ? 'border border-primary/35 bg-[color-mix(in_srgb,var(--app-primary)_18%,transparent)] text-primary shadow-[0_0_12px_rgba(99,102,241,0.22)]'
                  : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
              }`}
            >
              <Cpu className="size-3.5" />
              <span>Case Studies</span>
              {caseRows.length > 0 && (
                <span className="ml-0.5 rounded-full bg-surface-muted px-2 py-0.2 text-[10.5px] font-mono font-medium">
                  {caseRows.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('history')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all duration-150 ${
                activeTab === 'history'
                  ? 'border border-primary/35 bg-[color-mix(in_srgb,var(--app-primary)_18%,transparent)] text-primary shadow-[0_0_12px_rgba(99,102,241,0.22)]'
                  : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
              }`}
            >
              <RotateCcw className="size-3.5" />
              <span>Projects</span>
              {projects.length > 0 && (
                <span className="ml-0.5 rounded-full bg-surface-muted px-2 py-0.2 text-[10.5px] font-mono font-medium">
                  {projects.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* TAB 1: CASE STUDIES PANEL (PRIMARY / DEFAULT)                            */}
      {/* Kept mounted in DOM — visibility toggled via display classes to stop jumps*/}
      {/* ========================================================================= */}
      <div
        className={`space-y-4 ${
          activeTab === 'cases' ? 'block animate-in fade-in-50 duration-150' : 'hidden'
        }`}
        aria-hidden={activeTab !== 'cases'}
      >
        {caseError && <StatusMessage type="error" message={caseError} />}

        {bannerRow && !bannerDismissed && (
          <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--app-status-success-text)_28%,transparent)] bg-[var(--app-status-success-bg)] px-4 py-3 text-[13px] text-[var(--app-status-success-text)] shadow-sm">
            <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
            <span className="min-w-0 flex-1">
              <strong className="font-semibold">{displayName(bannerRow)}</strong> was just saved
              from your chat. Pick an engine below to start optimization.
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

        {/* Toolbar: Perfectly Height-Matched with Tab 2 */}
        <div className={`${cardPanel} flex flex-col gap-3 sm:flex-row sm:items-center min-h-[58px]`}>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              className={`${fieldInput} w-full pl-9`}
              placeholder="Search case studies by system name or title..."
              value={caseQuery}
              onChange={(e) => setCaseQuery(e.target.value)}
              aria-label="Search case studies"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['all', 'All Systems'],
                ['tuned', 'Tuned'],
                ['untuned', 'In Progress'],
              ] as const
            ).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                className={`${btnBase} ${btnCompact} ${
                  caseFilter === val
                    ? 'border-primary bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
                    : ''
                }`}
                onClick={() => setCaseFilter(val)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {caseLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
            <span className="text-sm">Loading verified benchmark systems…</span>
          </div>
        ) : filteredCases.length === 0 ? (
          <div className={`${cardPanel} text-center py-16 text-muted`}>
            <Cpu className="mx-auto mb-3 size-10 text-muted/60" />
            <h3 className="m-0 mb-1.5 text-base font-semibold text-foreground">
              {caseRows.length === 0 ? 'No case studies yet' : 'No matching case studies'}
            </h3>
            <p className="m-0 mb-4 text-xs text-muted-text">
              {caseRows.length === 0
                ? 'Start a chat to describe a physical system or generate a state-space model.'
                : 'Try adjusting your search terms or filter.'}
            </p>
            {caseRows.length === 0 && (
              <Link to="/design" className={`${btnPrimary} inline-flex gap-2`}>
                <Sparkles className="size-3.5" />
                Describe System in Chat
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-3.5">
            {filteredCases.map((row) => {
              const name = displayName(row)
              const isComplete = row.status === 'complete'
              const canLaunch = isComplete || Boolean(row.system_name?.trim())
              const highlight = newId === row.id && !bannerDismissed
              return (
                <article
                  key={row.id}
                  className={`group relative flex flex-col gap-3 rounded-xl p-4 overflow-hidden border border-border bg-surface-elevated transition-colors duration-150 hover:border-[color-mix(in_srgb,var(--app-foreground)_18%,transparent)] ${
                    highlight
                      ? 'border-[color-mix(in_srgb,var(--app-status-success-text)_40%,transparent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--app-status-success-text)_20%,transparent)]'
                      : ''
                  }`}
                >
                  {/* Top-edge luminous hairline */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
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
                          {isComplete ? 'model verified' : 'in progress'}
                        </span>
                        {isComplete && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--app-status-success-text)_28%,transparent)] bg-[color-mix(in_srgb,var(--app-status-success-text)_10%,transparent)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--app-status-success-text)] shadow-[0_0_10px_rgba(34,211,167,0.12)]">
                            <Check className="size-2.5" strokeWidth={3} /> tuned
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDeleteCase(row)
                      }}
                      disabled={deletingCaseId === row.id}
                      className="grid size-7 shrink-0 place-items-center rounded-lg border border-transparent text-muted/50 transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-500 active:scale-95 disabled:opacity-50"
                      title={`Delete "${name}"`}
                      aria-label={`Delete "${name}"`}
                    >
                      {deletingCaseId === row.id ? (
                        <Loader2 className="size-3.5 animate-spin text-red-500" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </button>
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
                          ? 'Choose a controller engine and launch'
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
              ? 'Select MPC, Adaptive, Single Loop, or Multi Loop module to begin.'
              : undefined
          }
          launching={launching}
          onClose={() => {
            if (!launching) setLaunchTarget(null)
          }}
          onLaunch={handleLaunch}
        />

        <ConfirmModal
          open={deleteTarget != null}
          title={`Delete "${deleteTarget ? displayName(deleteTarget) : ''}"?`}
          description="Are you sure you want to delete this case study benchmark? This action cannot be undone and will permanently remove its physical plant dynamics."
          confirmText={deletingCaseId != null ? 'Deleting...' : 'Delete Case Study'}
          cancelText="Cancel"
          variant="danger"
          loading={deletingCaseId != null}
          onClose={() => {
            if (!deletingCaseId) setDeleteTarget(null)
          }}
          onConfirm={handleConfirmDelete}
        />
      </div>

      {/* ========================================================================= */}
      {/* TAB 2: PROJECT HISTORY PANEL                                             */}
      {/* Kept mounted in DOM — visibility toggled via display classes to stop jumps*/}
      {/* ========================================================================= */}
      <div
        className={`space-y-4 ${
          activeTab === 'history' ? 'block animate-in fade-in-50 duration-150' : 'hidden'
        }`}
        aria-hidden={activeTab !== 'history'}
      >
        {projError && <StatusMessage type="error" message={projError} />}

        {/* Toolbar: Perfectly Height-Matched with Tab 1 */}
        <div className={`${cardPanel} flex flex-col gap-3 sm:flex-row sm:items-center min-h-[58px]`}>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              className={`${fieldInput} w-full pl-9`}
              placeholder="Search project runs by title, file, or status..."
              value={projQuery}
              onChange={(e) => setProjQuery(e.target.value)}
              aria-label="Search project runs"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 max-w-full">
            {MODULE_FILTERS.map((mod) => {
              const Icon = mod.icon
              const count = moduleCounts[mod.id] || 0
              const isActive = projFilter === mod.id

              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => setProjFilter(mod.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all shrink-0 whitespace-nowrap border ${
                    isActive
                      ? mod.activeStyle
                      : 'border-border bg-surface hover:bg-surface-hover text-muted-text hover:text-foreground'
                  }`}
                >
                  <Icon className={`size-3.5 ${isActive ? 'text-current' : mod.accentColor}`} />
                  <span>{mod.label}</span>
                  <span
                    className={`ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-mono font-medium ${
                      isActive
                        ? 'bg-primary/20 text-current'
                        : 'bg-surface-muted text-muted-text'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {projLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
            <span className="text-sm">Loading project history…</span>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className={`${cardPanel} text-center py-16`}>
            <FolderOpen className="mx-auto mb-3 size-10 text-muted" />
            <p className="m-0 text-foreground font-medium">No projects found</p>
            <p className="mt-1 mb-4 text-xs text-muted-text">
              Run an optimization in MPC, Adaptive, Single Loop, or Multi Loop to log design history.
            </p>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => handleTabChange('cases')}
            >
              Browse Case Studies to Launch
            </button>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {filteredProjects.map((project) => (
              <li
                key={project.id}
                className={`${cardPanel} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/projects/${project.id}`}
                      className="truncate text-base font-semibold text-foreground hover:text-primary transition-colors"
                    >
                      {project.title}
                    </Link>
                    <span className={statusBadgeClass(project.status)}>{project.status}</span>
                    <span className={pipelineBadgeClass(project.pipeline_type)}>
                      {pipelineLabel(project.pipeline_type)}
                    </span>
                  </div>
                  <p className="m-0 text-xs text-muted-text">
                    File: <span className="font-mono text-slate-300">{project.file_name || '—'}</span> · Updated{' '}
                    {formatDateTime(project.updated_at)}
                    {project.has_results ? ' · Results available' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {canRetryProject(project.status) && (
                    <button
                      type="button"
                      className={`${btnBase} ${btnCompact}`}
                      disabled={retryingId === project.id}
                      onClick={() => void handleRetry(project.id)}
                    >
                      <RotateCcw className="size-3.5" />
                      {retryingId === project.id ? 'Opening…' : 'Retry'}
                    </button>
                  )}
                  <Link to={`/projects/${project.id}`} className={`${btnBase} ${btnCompact}`}>
                    View Details
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
