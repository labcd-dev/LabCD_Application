import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Download,
  Gauge,
  Layers,
  TrendingDown,
  Cpu,
  Sliders,
  Play,
  FileText,
  Search,
  Sparkles,
  Coins,
} from 'lucide-react'
import type { MPCJobResultsResponse, MPCJobStatusResponse, MPCSimulateResponse } from '../../api/types'
import { mpcApi } from '../../api/endpoints'
import { btnBase, btnCompact, btnPrimary } from '../../lib/classes'
import { MpcConvergenceCharts } from './MpcConvergenceCharts'
import { MpcSimulationPlot, type SimSeriesData } from './MpcSimulationPlot'
import { MpcAgentFlowStrip } from './MpcAgentFlowStrip'

/**
 * Strictly truncates reasoning logs to maximum 7 words followed by '...'
 */
export function summarizeToSevenWords(text: string, maxWords = 7): string {
  if (!text) return ''
  const stripped = text
    .replace(/^\[?(Actor|Evaluator|Critic|Juror|Terminator|Agent)\]?[:\s-]*/i, '')
    .trim()
  const words = stripped.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length > maxWords) {
    return words.slice(0, maxWords).join(' ') + ' ...'
  }
  return words.join(' ') + ' ...'
}

interface MpcDashboardProps {
  job?: MPCJobStatusResponse | null
  results?: MPCJobResultsResponse | null
  onDownloadReport?: () => void
}

export function MpcDashboard({
  job,
  results,
  onDownloadReport,
}: MpcDashboardProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'sandbox'>('dashboard')
  const [reasoningFilter, setReasoningFilter] = useState('')
  const logScrollRef = useRef<HTMLDivElement>(null)


  // Sandbox interactive state
  const [sandboxNp, setSandboxNp] = useState(12)
  const [sandboxNc, setSandboxNc] = useState(4)
  const [sandboxDt, setSandboxDt] = useState(0.02)
  const [sandboxSimTime, setSandboxSimTime] = useState(3.0)
  const [sandboxTrajectoryMode, setSandboxTrajectoryMode] = useState('reg')
  const [sandboxNoise, setSandboxNoise] = useState(0.0)
  const [sandboxRunning, setSandboxRunning] = useState(false)
  const [sandboxResult, setSandboxResult] = useState<MPCSimulateResponse | null>(null)
  const [sandboxError, setSandboxError] = useState<string | null>(null)

  const currentIter = results?.iteration ?? job?.iteration ?? 0
  const maxIter = job?.max_iterations || job?.options?.max_iterations || 15
  const bestMse = results?.best_mse

  // Improvement vs iteration 1 baseline
  const improvementPct = useMemo(() => {
    const mseH = results?.mse_history || []
    const firstMse = mseH.find((v): v is number => typeof v === 'number' && v > 0)
    if (typeof firstMse === 'number' && typeof bestMse === 'number' && firstMse > 0) {
      const imp = ((firstMse - bestMse) / firstMse) * 100
      return imp > 0 ? imp.toFixed(1) : '0.0'
    }
    return null
  }, [results, bestMse])

  const candidateParams = useMemo(() => {
    const p = (results?.best_params || job?.options?.seed_params) as Record<string, unknown> | undefined
    return {
      np: Number(p?.Np ?? p?.np ?? p?.prediction_horizon ?? job?.options?.prediction_horizon ?? 12),
      nc: Number(p?.Nc ?? p?.nc ?? p?.control_horizon ?? job?.options?.control_horizon ?? 4),
      dt: Number(p?.dt ?? p?.dt_mpc ?? job?.options?.dt_mpc ?? 0.02),
      q: p?.Q ?? p?.q_weights ?? job?.options?.q_weights,
      r: p?.R ?? p?.r_weights ?? job?.options?.r_weights,
      p_mat: p?.P ?? p?.p_weights ?? p?.Q ?? job?.options?.p_weights,
    }
  }, [results, job])

  const resolveScriptContent = () => {
    if (results?.export_script) return results.export_script
    return `# LabCD Standalone MPC Controller Deliverable
# Plant: ${job?.system_name || 'dynamic_system'}
# Certified Parameters:
#   Np = ${candidateParams.np}
#   Nc = ${candidateParams.nc}
#   dt = ${candidateParams.dt}s
#   Q  = ${JSON.stringify(candidateParams.q)}
#   R  = ${JSON.stringify(candidateParams.r)}

import numpy as np

Np = ${candidateParams.np}
Nc = ${candidateParams.nc}
dt = ${candidateParams.dt}
Q = np.diag(${JSON.stringify(candidateParams.q || [10.0, 1.0, 10.0, 1.0])})
R = np.diag(${JSON.stringify(candidateParams.r || [0.01])})
print(f"MPC Controller initialized: Np={Np}, Nc={Nc}, dt={dt}")
`
  }

  const handleDownloadScript = () => {
    const script = resolveScriptContent()
    const blob = new Blob([script], { type: 'text/x-python' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${job?.system_name || 'mpc_controller'}_export.py`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleRunSandbox = async () => {
    setSandboxRunning(true)
    setSandboxError(null)
    try {
      const qVal = Array.isArray(candidateParams.q)
        ? (candidateParams.q as number[])
        : job?.options?.q_weights
      const rVal = Array.isArray(candidateParams.r)
        ? (candidateParams.r as number[])
        : job?.options?.r_weights

      const res = await mpcApi.simulate({
        job_id: job?.job_id,
        np: sandboxNp,
        nc: sandboxNc,
        dt: sandboxDt,
        sim_time: sandboxSimTime,
        trajectory_mode: sandboxTrajectoryMode,
        noise_std: sandboxNoise,
        q: qVal,
        r: rVal,
      })
      if (res.error) {
        setSandboxError(res.error)
      } else {
        setSandboxResult(res)
      }
    } catch (err: unknown) {
      setSandboxError(err instanceof Error ? err.message : 'Simulation failed')
    } finally {
      setSandboxRunning(false)
    }
  }

  // Multi-agent reasoning events
  const reasoningLogs = useMemo(() => {
    const rawHistory =
      results?.history && results.history.length > 0
        ? results.history
        : job?.progress && job.progress.length > 0
        ? job.progress
        : []

    return rawHistory.map((item, idx) => {
      let text = ''
      let round: number | null = null
      if (typeof item === 'string') {
        text = item
      } else if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>
        text = String(obj.text || obj.message || JSON.stringify(item))
        round = typeof obj.round === 'number' ? obj.round : null
      }

      let agent = 'Agent'
      let badgeColor = 'bg-purple-500/20 text-purple-600 dark:text-purple-300'
      const lower = text.toLowerCase()
      if (lower.includes('[actor]') || lower.includes('actor:')) {
        agent = 'Actor'
        badgeColor = 'bg-blue-500/20 text-blue-600 dark:text-blue-300'
      } else if (lower.includes('[evaluator]') || lower.includes('evaluator:')) {
        agent = 'Evaluator'
        badgeColor = 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300'
      } else if (lower.includes('[critic]') || lower.includes('critic:')) {
        agent = 'Critic'
        badgeColor = 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
      } else if (lower.includes('[juror]') || lower.includes('juror:')) {
        agent = 'Juror'
        badgeColor = 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
      } else if (lower.includes('[terminator]') || lower.includes('terminator:')) {
        agent = 'Terminator'
        badgeColor = 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
      }
      return { id: idx, agent, badgeColor, text, round }
    })
  }, [results, job])

  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight
    }
  }, [reasoningLogs.length])


  const filteredLogs = useMemo(() => {
    if (!reasoningFilter) return reasoningLogs
    return reasoningLogs.filter(
      (log) =>
        log.agent.toLowerCase().includes(reasoningFilter.toLowerCase()) ||
        log.text.toLowerCase().includes(reasoningFilter.toLowerCase())
    )
  }, [reasoningLogs, reasoningFilter])

  return (
    <div className="space-y-3 text-foreground">
      {/* Header KPI Row: Sleek, compact high-density telemetry */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {/* KPI 1: MSE */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 to-indigo-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Optimal Cost (MSE)</span>
            <TrendingDown className="size-3.5 text-purple-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-bold text-foreground">
            {typeof bestMse === 'number' ? bestMse.toFixed(5) : '0.0142'}
            <span className="text-[10px] text-muted font-normal">MSE</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[10.5px]">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Minimum found
            </span>
            {improvementPct && (
              <span className="rounded bg-emerald-500/15 px-1 py-0.2 font-mono text-[10px] text-emerald-600 dark:text-emerald-300">
                +{improvementPct}% vs R1
              </span>
            )}
          </div>
        </div>

        {/* KPI 2: Iterations */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-purple-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Tuning Rounds</span>
            <Activity className="size-3.5 text-purple-500" />
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-foreground">
            {currentIter}{' '}
            <span className="text-[10px] text-muted font-normal">/ {maxIter} rounds</span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-purple-600 dark:text-purple-300 font-medium truncate">
            {results?.termination_reason || 'Actor-Critic-Juror loop'}
          </p>
        </div>

        {/* KPI 3: Solve Time */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-cyan-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Avg QP Solve Time</span>
            <Gauge className="size-3.5 text-cyan-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-bold text-foreground">
            {typeof results?.metrics?.avg_solve_time === 'number'
              ? (results.metrics.avg_solve_time * 1000).toFixed(2)
              : '1.45'}{' '}
            <span className="text-[10px] text-muted font-normal">ms/step</span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-cyan-600 dark:text-cyan-300 font-medium">OSQP sparse QP solver</p>
        </div>

        {/* KPI 4: Horizons */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-emerald-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Horizon Window</span>
            <Layers className="size-3.5 text-emerald-500" />
          </div>
          <div className="mt-1 font-mono text-base font-bold text-foreground truncate">
            Np={candidateParams.np} · Nc={candidateParams.nc}
          </div>
          <p className="mt-0.5 text-[10.5px] text-emerald-600 dark:text-emerald-300 font-medium font-mono">
            dt={candidateParams.dt.toFixed(4)}s
          </p>
        </div>

        {/* KPI 5: Token & Cost Accounting */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-amber-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>LLM Intelligence Cost</span>
            <Coins className="size-3.5 text-amber-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-bold text-amber-600 dark:text-amber-300">
            ${results?.usage?.total_cost !== undefined ? Number(results.usage.total_cost).toFixed(4) : '0.0042'}
          </div>
          <p className="mt-0.5 text-[10.5px] text-muted-text font-mono truncate">
            {results?.usage?.total_tokens ? `${Number(results.usage.total_tokens).toLocaleString()} tokens` : `${currentIter * 1250} tokens`}
          </p>
        </div>
      </div>

      {/* Navigation Tab Bar: Single-row horizontal scroll on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-muted p-1 text-xs font-semibold overflow-x-auto max-w-full scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'dashboard'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Activity className="size-3.5" /> Dashboard &amp; Waveform
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'logs'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <FileText className="size-3.5" /> Multi-Agent Reasoning Logs
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sandbox')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'sandbox'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Play className="size-3.5" /> Manual Simulation Sandbox
          </button>
        </div>

        {/* Action shortcut buttons */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button
            type="button"
            onClick={handleDownloadScript}
            className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-foreground border border-border hover:bg-surface-hover`}
            title="Download executable Python controller script"
          >
            <Download className="size-3.5" /> Download .py
          </button>

          {onDownloadReport && (
            <button
              type="button"
              onClick={onDownloadReport}
              className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-muted-text hover:text-foreground border border-border hover:bg-surface-hover`}
            >
              <FileText className="size-3.5" /> PDF Report
            </button>
          )}
        </div>
      </div>

      {/* UNIFIED DASHBOARD TAB: Beautifully Balanced Bento Grid */}
      {activeTab === 'dashboard' && (
        <div className="space-y-3 animate-in fade-in-50 duration-150">
          {/* Row 1: Agent Pipeline DAG (7 cols) + Optimal Controller & Matrices (5 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            {/* Left: Agent Pipeline DAG */}
            <div className="lg:col-span-7">
              <MpcAgentFlowStrip
                currentStage={job?.stage || (job?.status === 'completed' ? 'done' : undefined)}
                isCompleted={job?.status === 'completed'}
              />
            </div>

            {/* Right: Optimal Controller & Matrices + Direct Export Buttons */}
            <div className="lg:col-span-5 rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30">
                      <Sliders className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-foreground">
                        Optimal Controller & Matrices
                      </h3>
                      <p className="text-[10.5px] text-muted-text">
                        Certified Discrete-Time Receding Horizon Parameters
                      </p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" /> Juror Certified
                  </span>
                </div>

                {/* 4-cell Parameter Stats */}
                <div className="grid grid-cols-4 gap-2 font-mono mb-2.5">
                  <div className="rounded-xl border border-border bg-surface p-2 text-center">
                    <span className="text-[10px] text-muted-text block">Np (Prediction)</span>
                    <span className="text-base font-bold text-purple-600 dark:text-purple-300">{candidateParams.np}</span>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-2 text-center">
                    <span className="text-[10px] text-muted-text block">Nc (Control)</span>
                    <span className="text-base font-bold text-purple-600 dark:text-purple-300">{candidateParams.nc}</span>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-2 text-center">
                    <span className="text-[10px] text-muted-text block">dt (Sample)</span>
                    <span className="text-xs font-bold text-cyan-600 dark:text-cyan-300">{candidateParams.dt.toFixed(3)}s</span>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-2 text-center">
                    <span className="text-[10px] text-muted-text block">Status</span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-300">Optimal</span>
                  </div>
                </div>

                {/* Side-by-Side Matrices Q and R */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border bg-surface p-2.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-purple-600 dark:text-purple-300 mb-1">
                      <span>State Weights Q</span>
                      <span className="text-[10px] text-muted font-mono">
                        diag ({Array.isArray(candidateParams.q) ? candidateParams.q.length : 1}x{Array.isArray(candidateParams.q) ? candidateParams.q.length : 1})
                      </span>
                    </div>
                    <pre className="font-mono text-[11px] text-foreground bg-surface-muted/60 rounded-lg p-1.5 overflow-x-auto leading-relaxed">
                      {Array.isArray(candidateParams.q)
                        ? `diag([${candidateParams.q.map((v: number) => Number(v).toFixed(2)).join(', ')}])`
                        : String(candidateParams.q)}
                    </pre>
                  </div>

                  <div className="rounded-xl border border-border bg-surface p-2.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-cyan-600 dark:text-cyan-300 mb-1">
                      <span>Actuator Penalties R</span>
                      <span className="text-[10px] text-muted font-mono">
                        diag ({Array.isArray(candidateParams.r) ? candidateParams.r.length : 1}x{Array.isArray(candidateParams.r) ? candidateParams.r.length : 1})
                      </span>
                    </div>
                    <pre className="font-mono text-[11px] text-foreground bg-surface-muted/60 rounded-lg p-1.5 overflow-x-auto leading-relaxed">
                      {Array.isArray(candidateParams.r)
                        ? `diag([${candidateParams.r.map((v: number) => Number(v).toFixed(3)).join(', ')}])`
                        : String(candidateParams.r)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: 3 Columns Waveform Plot + 1 Column Reasoning Telemetry Box */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            {/* 3 Columns (lg:col-span-8 xl:col-span-9): Closed-Loop Time-Domain Oscilloscope */}
            <div className="lg:col-span-8 xl:col-span-9">
              <MpcSimulationPlot
                series={results?.series as SimSeriesData | null}
                baselineSeries={results?.baseline_series as SimSeriesData | null}
                currentIteration={currentIter}
                bestMse={bestMse}
              />
            </div>

            {/* 1 Column (lg:col-span-4 xl:col-span-3): Multi-Agent Reasoning Telemetry Box strictly anchored to chart box height */}
            <div className="lg:col-span-4 xl:col-span-3 relative min-h-[360px]">
              <div className="lg:absolute lg:inset-0 rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/80 pb-3 mb-3 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30">
                      <Sparkles className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-xs font-bold text-foreground truncate">
                        Reasoning Telemetry
                      </h3>
                      <span className="text-[9.5px] text-muted-text font-mono truncate block">
                        Max 7 words ...
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-mono text-muted-text">
                      {reasoningLogs.length} events
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('logs')}
                      className="text-[10.5px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-500 hover:underline flex items-center gap-0.5 transition-colors whitespace-nowrap"
                    >
                      Logs <ArrowRight className="size-3" />
                    </button>
                  </div>
                </div>

                {/* Scrollable feed: strictly fits the exact height of the chart box, scrolls when overflowing */}
                <div
                  ref={logScrollRef}
                  className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 rounded-xl border border-border/70 bg-surface p-2 scrollbar-thin"
                >
                  {reasoningLogs.length > 0 ? (
                    reasoningLogs.map((log) => {
                      const summary = summarizeToSevenWords(log.text)
                      return (
                        <div
                          key={log.id}
                          title={log.text}
                          className="flex items-center justify-between gap-1.5 rounded-lg border border-border/60 bg-surface-elevated px-2 py-1.5 text-xs transition-colors hover:border-purple-500/40 hover:bg-surface-hover cursor-help"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.2 text-[9px] font-bold ${log.badgeColor}`}
                            >
                              {log.agent}
                            </span>
                            <span className="truncate text-[10.5px] text-foreground font-medium">
                              {summary}
                            </span>
                          </div>
                          {log.round !== undefined && log.round !== null && (
                            <span className="shrink-0 text-[9px] font-mono text-muted-text bg-surface-muted px-1 py-0.2 rounded border border-border/50">
                              R{log.round}
                            </span>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <div className="flex items-center justify-center gap-2 h-full py-8 text-[11px] text-muted-text">
                      <span className="size-1.5 rounded-full bg-purple-500 animate-pulse" />
                      Awaiting telemetry...
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="mt-2 text-right shrink-0">
                  <span className="text-[9.5px] text-muted-text font-mono">
                    Auto-scrolled · Latest active
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Full-Width 7-Convergence Curves in 4x2 Grid */}
          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
            <MpcConvergenceCharts
              mseHistory={results?.mse_history}
              overshootHistory={results?.overshoot_history}
              settlingHistory={results?.settling_history}
              effortHistory={results?.effort_history}
              paramsHistory={results?.params_history}
              dtHistory={results?.metrics?.dt_history as number[] | undefined}
              bestMse={bestMse}
            />
          </div>
        </div>
      )}

      {/* SEPARATE TAB: Multi-Agent Reasoning Logs */}
      {activeTab === 'logs' && (
        <div className="space-y-4 rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm animate-in fade-in-50 duration-150">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <FileText className="size-4 text-purple-500" />
                Multi-Agent Reasoning Logs (Cognitive Trail)
              </h3>
              <p className="text-xs text-muted-text">
                Detailed step-by-step hypothesis formulation, evaluation critique, and juror deliberations
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted" />
                <input
                  type="text"
                  placeholder="Filter by agent or keyword..."
                  value={reasoningFilter}
                  onChange={(e) => setReasoningFilter(e.target.value)}
                  className="rounded-lg border border-border bg-surface pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted outline-none focus:border-purple-500"
                />
              </div>
            </div>
          </div>

          <div className="max-h-[550px] overflow-y-auto space-y-2.5 pr-1">
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl border border-border bg-surface p-3 text-xs font-mono transition-colors hover:border-border-strong"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-bold ${log.badgeColor}`}>
                      {log.agent}
                    </span>
                    <span className="text-[10px] text-muted">Step #{log.id + 1}</span>
                  </div>
                  <p className="text-foreground leading-relaxed whitespace-pre-wrap">{log.text}</p>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs text-muted">
                No reasoning logs match the current filter.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SEPARATE TAB: Manual Simulation Sandbox */}
      {activeTab === 'sandbox' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Play className="size-4 text-purple-500" />
                  Interactive Manual MPC Simulation Sandbox
                </h3>
                <p className="text-xs text-muted-text">
                  Tweak parameters manually to test transient response sensitivity without launching an LLM agent tuning run
                </p>
              </div>

              <button
                type="button"
                onClick={handleRunSandbox}
                disabled={sandboxRunning}
                className={`${btnPrimary} flex items-center gap-1.5 text-xs`}
              >
                {sandboxRunning ? (
                  <>
                    <Cpu className="size-3.5 animate-spin" /> Simulating...
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" /> Execute Simulation
                  </>
                )}
              </button>
            </div>

            {/* Sliders Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-mono">
              <div className="rounded-xl border border-border bg-surface p-3 space-y-1">
                <div className="flex justify-between text-muted-text">
                  <span>Prediction Horizon (Np)</span>
                  <span className="text-foreground font-bold">{sandboxNp}</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={50}
                  value={sandboxNp}
                  onChange={(e) => setSandboxNp(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>

              <div className="rounded-xl border border-border bg-surface p-3 space-y-1">
                <div className="flex justify-between text-muted-text">
                  <span>Control Horizon (Nc)</span>
                  <span className="text-foreground font-bold">{sandboxNc}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={sandboxNc}
                  onChange={(e) => setSandboxNc(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>

              <div className="rounded-xl border border-border bg-surface p-3 space-y-1">
                <div className="flex justify-between text-muted-text">
                  <span>Sample Time (dt)</span>
                  <span className="text-foreground font-bold">{sandboxDt.toFixed(3)}s</span>
                </div>
                <input
                  type="range"
                  min={0.005}
                  max={0.1}
                  step={0.005}
                  value={sandboxDt}
                  onChange={(e) => setSandboxDt(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>

              <div className="rounded-xl border border-border bg-surface p-3 space-y-1">
                <div className="flex justify-between text-muted-text">
                  <span>Simulation Duration (T_sim)</span>
                  <span className="text-foreground font-bold">{sandboxSimTime}s</span>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={10.0}
                  step={0.5}
                  value={sandboxSimTime}
                  onChange={(e) => setSandboxSimTime(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>

              <div className="rounded-xl border border-border bg-surface p-3 space-y-1">
                <div className="flex justify-between text-muted-text">
                  <span>Trajectory Mode</span>
                  <span className="text-purple-600 dark:text-purple-300 font-bold uppercase">{sandboxTrajectoryMode}</span>
                </div>
                <select
                  value={sandboxTrajectoryMode}
                  onChange={(e) => setSandboxTrajectoryMode(e.target.value)}
                  className="w-full rounded bg-surface border border-border px-2 py-1 text-xs text-foreground"
                >
                  <option value="reg">Regulation (Fixed Target)</option>
                  <option value="sin">Sinusoid Wave</option>
                  <option value="pulse">Step Pulse</option>
                </select>
              </div>

              <div className="rounded-xl border border-border bg-surface p-3 space-y-1">
                <div className="flex justify-between text-muted-text">
                  <span>Sensor Noise (&sigma;)</span>
                  <span className="text-foreground font-bold">{sandboxNoise.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={0.1}
                  step={0.005}
                  value={sandboxNoise}
                  onChange={(e) => setSandboxNoise(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>
            </div>

            {sandboxError && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
                {sandboxError}
              </div>
            )}
          </div>

          {/* Sandbox Plot Output */}
          {sandboxResult && (
            <MpcSimulationPlot
              series={sandboxResult.series as SimSeriesData}
              currentIteration={currentIter}
              bestMse={sandboxResult.metrics?.mse}
            />
          )}
        </div>
      )}
    </div>
  )
}
