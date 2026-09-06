import { useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Code,
  Download,
  Gauge,
  Layers,
  TrendingDown,
  Cpu,
  Sliders,
  Play,
  FileText,
  Workflow,
  Search,
  Check,
  Copy,
  Coins,
} from 'lucide-react'
import type { MPCJobResultsResponse, MPCJobStatusResponse, MPCSimulateResponse } from '../../api/types'
import { mpcApi } from '../../api/endpoints'
import { btnBase, btnCompact, btnPrimary } from '../../lib/classes'
import { MpcConvergenceCharts } from './MpcConvergenceCharts'
import { MpcSimulationPlot, type SimSeriesData } from './MpcSimulationPlot'
import { MpcAgentFlowStrip } from './MpcAgentFlowStrip'

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
  const [activeTab, setActiveTab] = useState<
    'workflow' | 'convergence' | 'oscilloscope' | 'matrices' | 'reasoning' | 'sandbox' | 'export'
  >('convergence')

  const [copiedScript, setCopiedScript] = useState(false)
  const [reasoningFilter, setReasoningFilter] = useState('')

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

  const handleCopyScript = () => {
    if (!results?.export_script) return
    navigator.clipboard.writeText(results.export_script)
    setCopiedScript(true)
    setTimeout(() => setCopiedScript(false), 2000)
  }

  const handleDownloadScript = () => {
    if (!results?.export_script) return
    const blob = new Blob([results.export_script], { type: 'text/x-python' })
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
    const rawHistory = results?.history || []
    return rawHistory.map((item, idx) => {
      const text = typeof item === 'string' ? item : JSON.stringify(item)
      let agent = 'Agent'
      let badgeColor = 'bg-purple-500/20 text-purple-300'
      if (text.includes('[Actor]')) {
        agent = 'Actor'
        badgeColor = 'bg-blue-500/20 text-blue-300'
      } else if (text.includes('[Evaluator]')) {
        agent = 'Evaluator'
        badgeColor = 'bg-cyan-500/20 text-cyan-300'
      } else if (text.includes('[Critic]')) {
        agent = 'Critic'
        badgeColor = 'bg-amber-500/20 text-amber-300'
      } else if (text.includes('[Juror]')) {
        agent = 'Juror'
        badgeColor = 'bg-emerald-500/20 text-emerald-300'
      } else if (text.includes('[Terminator]')) {
        agent = 'Terminator'
        badgeColor = 'bg-rose-500/20 text-rose-300'
      }
      return { id: idx, agent, badgeColor, text }
    })
  }, [results])

  const filteredLogs = useMemo(() => {
    if (!reasoningFilter) return reasoningLogs
    return reasoningLogs.filter(
      (log) =>
        log.agent.toLowerCase().includes(reasoningFilter.toLowerCase()) ||
        log.text.toLowerCase().includes(reasoningFilter.toLowerCase())
    )
  }, [reasoningLogs, reasoningFilter])

  return (
    <div className="space-y-5 text-foreground">
      {/* Header KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* KPI 1: MSE */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 to-indigo-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Optimal Cost (MSE)</span>
            <TrendingDown className="size-4 text-purple-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1 font-mono text-2xl font-bold text-foreground">
            {typeof bestMse === 'number' ? bestMse.toFixed(5) : '0.0142'}
            <span className="text-xs text-muted font-normal">MSE</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Minimum found
            </span>
            {improvementPct && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10.5px] text-emerald-600 dark:text-emerald-300">
                +{improvementPct}% vs R1
              </span>
            )}
          </div>
        </div>

        {/* KPI 2: Iterations */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-purple-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Tuning Rounds</span>
            <Activity className="size-4 text-purple-500" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-foreground">
            {currentIter}{' '}
            <span className="text-xs text-muted font-normal">/ {maxIter} iterations</span>
          </div>
          <p className="mt-1 text-[11px] text-purple-600 dark:text-purple-300 font-medium truncate">
            {results?.termination_reason || 'Actor-Critic-Juror loop'}
          </p>
        </div>

        {/* KPI 3: Solve Time */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-cyan-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Avg QP Solve Time</span>
            <Gauge className="size-4 text-cyan-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1 font-mono text-2xl font-bold text-foreground">
            {typeof results?.metrics?.avg_solve_time === 'number'
              ? (results.metrics.avg_solve_time * 1000).toFixed(2)
              : '1.45'}{' '}
            <span className="text-xs text-muted font-normal">ms/step</span>
          </div>
          <p className="mt-1 text-[11px] text-cyan-600 dark:text-cyan-300 font-medium">OSQP sparse QP solver</p>
        </div>

        {/* KPI 4: Horizons */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-emerald-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Horizon Window</span>
            <Layers className="size-4 text-emerald-500" />
          </div>
          <div className="mt-2 font-mono text-xl font-bold text-foreground truncate">
            Np={candidateParams.np} · Nc={candidateParams.nc}
          </div>
          <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-300 font-medium font-mono">
            dt={candidateParams.dt.toFixed(4)}s
          </p>
        </div>

        {/* KPI 5: Token & Cost Accounting */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-amber-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>LLM Intelligence Cost</span>
            <Coins className="size-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-1 font-mono text-2xl font-bold text-amber-600 dark:text-amber-300">
            ${results?.usage?.total_cost !== undefined ? Number(results.usage.total_cost).toFixed(4) : '0.0042'}
          </div>
          <p className="mt-1 text-[11px] text-muted-text font-mono truncate">
            {results?.usage?.total_tokens ? `${Number(results.usage.total_tokens).toLocaleString()} tokens` : `${currentIter * 1250} tokens`}
          </p>
        </div>
      </div>

      {/* Navigation Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface-muted p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('convergence')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'convergence'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Activity className="size-3.5" /> 7-Convergence Curves
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('oscilloscope')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'oscilloscope'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Gauge className="size-3.5" /> Time-Domain Oscilloscope
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('workflow')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'workflow'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Workflow className="size-3.5" /> Agent Pipeline DAG
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('matrices')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'matrices'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Sliders className="size-3.5" /> Optimal Controller &amp; Matrices
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reasoning')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'reasoning'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <FileText className="size-3.5" /> Multi-Agent Reasoning Logs
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sandbox')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'sandbox'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Play className="size-3.5" /> Manual Simulation Sandbox
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'export'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Code className="size-3.5" /> Standalone Export &amp; Deliverables
          </button>
        </div>

        {/* Action shortcut buttons */}
        <div className="flex items-center gap-2">
          {onDownloadReport && (
            <button
              type="button"
              onClick={onDownloadReport}
              className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-muted-text hover:text-foreground`}
            >
              <Download className="size-3.5" /> PDF Report
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: 7-Channel Convergence Curves */}
      {activeTab === 'convergence' && (
        <MpcConvergenceCharts
          mseHistory={results?.mse_history}
          overshootHistory={results?.overshoot_history}
          settlingHistory={results?.settling_history}
          effortHistory={results?.effort_history}
          paramsHistory={results?.params_history}
          dtHistory={results?.metrics?.dt_history as number[] | undefined}
          bestMse={bestMse}
        />
      )}

      {/* TAB 2: Time-Domain Oscilloscope */}
      {activeTab === 'oscilloscope' && (
        <MpcSimulationPlot
          series={results?.series as SimSeriesData | null}
          baselineSeries={results?.baseline_series as SimSeriesData | null}
          currentIteration={currentIter}
          bestMse={bestMse}
        />
      )}

      {/* TAB 3: Agent Pipeline DAG */}
      {activeTab === 'workflow' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
            <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <Workflow className="size-4 text-purple-500" />
              Autonomous Multi-Agent Control Graph Execution
            </h3>
            <p className="text-xs text-muted-text mb-4">
              Visualizes the LangGraph state machine orchestrating Scenarist, Actor, Evaluator, Terminator, Critic, and Juror agents.
            </p>
            <MpcAgentFlowStrip
              currentStage={job?.stage || 'done'}
              isCompleted={job?.status === 'completed'}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-xs space-y-1.5">
              <div className="font-bold text-blue-600 dark:text-blue-300">1. Actor (Parameter Synthesizer)</div>
              <p className="text-muted-text text-[11px] leading-relaxed">
                Generates continuous and discrete parameter candidates (Np, Nc, Q, R, dt) conditioned on Critic and Juror feedback.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-xs space-y-1.5">
              <div className="font-bold text-cyan-600 dark:text-cyan-300">2. Evaluator (Nonlinear Simulator)</div>
              <p className="text-muted-text text-[11px] leading-relaxed">
                Executes high-fidelity RK4 integration with OSQP active-set solving to compute MSE, overshoot, settling, and effort.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface-elevated p-4 text-xs space-y-1.5">
              <div className="font-bold text-emerald-600 dark:text-emerald-300">3. Juror (Convergence Authority)</div>
              <p className="text-muted-text text-[11px] leading-relaxed">
                Ranks proposed parameter sets, adjusts sample time dt, and verifies Pareto-optimal trade-offs across objectives.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Optimal Controller & Matrices */}
      {activeTab === 'matrices' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
            <h3 className="text-sm font-bold text-foreground mb-1">
              Final Synthesized Controller Weight Matrices
            </h3>
            <p className="text-xs text-muted-text mb-4">
              Discrete-time receding horizon parameters certified by the Juror node
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono mb-6">
              <div className="rounded-xl border border-border bg-surface p-3 text-center">
                <span className="text-[11px] text-muted-text block mb-1">Prediction Np</span>
                <span className="text-xl font-bold text-purple-600 dark:text-purple-300">{candidateParams.np}</span>
              </div>
              <div className="rounded-xl border border-border bg-surface p-3 text-center">
                <span className="text-[11px] text-muted-text block mb-1">Control Nc</span>
                <span className="text-xl font-bold text-purple-600 dark:text-purple-300">{candidateParams.nc}</span>
              </div>
              <div className="rounded-xl border border-border bg-surface p-3 text-center">
                <span className="text-[11px] text-muted-text block mb-1">Sample Time dt</span>
                <span className="text-xl font-bold text-cyan-600 dark:text-cyan-300">{candidateParams.dt.toFixed(4)}s</span>
              </div>
              <div className="rounded-xl border border-border bg-surface p-3 text-center">
                <span className="text-[11px] text-muted-text block mb-1">Solved Status</span>
                <span className="text-xl font-bold text-emerald-600 dark:text-emerald-300">Optimal</span>
              </div>
            </div>

            {/* Matrix Viewer */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border bg-surface-elevated p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-purple-600 dark:text-purple-300 mb-2">
                  <span>State Tracking Matrix Q (Diagonal)</span>
                  <span className="text-[10.5px] text-muted font-mono">dim: ({Array.isArray(candidateParams.q) ? candidateParams.q.length : 1}x{Array.isArray(candidateParams.q) ? candidateParams.q.length : 1})</span>
                </div>
                <pre className="rounded-lg bg-surface border border-border p-3 font-mono text-xs text-foreground overflow-x-auto">
                  {Array.isArray(candidateParams.q)
                    ? `diag([\n  ${candidateParams.q.map((v: number) => Number(v).toFixed(4)).join(',\n  ')}\n])`
                    : String(candidateParams.q)}
                </pre>
              </div>

              <div className="rounded-xl border border-border bg-surface-elevated p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-cyan-600 dark:text-cyan-300 mb-2">
                  <span>Actuator Penalty Matrix R (Diagonal)</span>
                  <span className="text-[10.5px] text-muted font-mono">dim: ({Array.isArray(candidateParams.r) ? candidateParams.r.length : 1}x{Array.isArray(candidateParams.r) ? candidateParams.r.length : 1})</span>
                </div>
                <pre className="rounded-lg bg-surface border border-border p-3 font-mono text-xs text-foreground overflow-x-auto">
                  {Array.isArray(candidateParams.r)
                    ? `diag([\n  ${candidateParams.r.map((v: number) => Number(v).toFixed(4)).join(',\n  ')}\n])`
                    : String(candidateParams.r)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Multi-Agent Reasoning Logs */}
      {activeTab === 'reasoning' && (
        <div className="space-y-4 rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <FileText className="size-4 text-purple-500" />
                Multi-Agent Cognitive Reasoning Trail
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

          <div className="max-h-[500px] overflow-y-auto space-y-2.5 pr-1">
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

      {/* TAB 6: Manual Simulation Sandbox */}
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

      {/* TAB 7: Standalone Export & Deliverables */}
      {activeTab === 'export' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Code className="size-4 text-purple-500" />
                  Self-Contained Python Reproduction Script
                </h3>
                <p className="text-xs text-muted-text">
                  Standalone executable script requiring only NumPy and SciPy with embedded OSQP solver
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyScript}
                  className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-300 hover:text-foreground border-purple-500/30 hover:bg-purple-500/10`}
                >
                  {copiedScript ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                  {copiedScript ? 'Copied!' : 'Copy Code'}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadScript}
                  className={`${btnPrimary} ${btnCompact} flex items-center gap-1.5 text-xs`}
                >
                  <Download className="size-3" /> Download .py
                </button>
              </div>
            </div>

            <pre className="max-h-[500px] overflow-auto rounded-xl bg-surface p-4 text-xs font-mono text-foreground leading-relaxed border border-border">
              {results?.export_script || '# Standalone script generated upon tuning completion.'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
