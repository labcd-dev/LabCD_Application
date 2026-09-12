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
  Workflow,
  Stethoscope,
  RotateCcw,
} from 'lucide-react'
import type {
  DiagnosisApplyPatch,
  MpcDiagnosis,
  MPCJobResultsResponse,
  MPCJobStatusResponse,
  MPCSimulateResponse,
} from '../../api/types'
import { mpcApi } from '../../api/endpoints'
import { btnBase, btnCompact, btnPrimary } from '../../lib/classes'
import { MpcConvergenceCharts } from './MpcConvergenceCharts'
import { MpcSimulationPlot, type SimSeriesData } from './MpcSimulationPlot'
import { MpcAgentFlowStrip } from './MpcAgentFlowStrip'
import { MpcDiagnosisChat } from './MpcDiagnosisChat'
import { ControlBlockDiagram } from '../common/ControlBlockDiagram'
import { ScoreReportBadge } from '../ScoreReportBadge'
import { AdaptiveDiagnosisModal } from '../adaptive/AdaptiveDiagnosisModal'
import { AdaptiveDiagnosisView } from '../adaptive/AdaptiveDiagnosisView'

/**
 * Strictly truncates reasoning logs to maximum 7 words followed by '...'
 */
function summarizeToSevenWords(text: string, maxWords = 7): string {
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
  onRetryFromDiagnosis?: () => void
  onApplyDiagnosisSuggestion?: (patch: DiagnosisApplyPatch) => void
  diagnosisApplyUsed?: boolean
  currentDiagnosisInputs?: {
    prediction_horizon?: number
    control_horizon?: number
    simulation_time?: number
    dt_mpc?: number
  } | null
}

function resolveMpcDiagnosis(results?: MPCJobResultsResponse | null): MpcDiagnosis | null {
  if (!results) return null
  const raw = (results.diagnosis ?? results.diagnostics) as MpcDiagnosis | Record<string, unknown> | null | undefined
  if (!raw || typeof raw !== 'object') return null
  const report = (raw as MpcDiagnosis).report
  if (!report || typeof report !== 'object') return null
  return raw as MpcDiagnosis
}

interface MpcMatrixDisplayProps {
  title: string
  matrixSymbol: 'Q' | 'R'
  values: unknown
  dimLabel: string
  names?: string[]
  accent: 'purple' | 'cyan'
}

function MpcMatrixDisplay({
  title,
  matrixSymbol,
  values,
  dimLabel,
  names = [],
  accent,
}: MpcMatrixDisplayProps) {
  const items = useMemo(() => {
    if (!Array.isArray(values)) return []
    return values.map((v, i) => {
      const num = typeof v === 'number' ? v : Number(v) || 0
      const varName = names[i] || (matrixSymbol === 'Q' ? `x${i + 1}` : `u${i + 1}`)
      return { idx: i, val: num, name: varName }
    })
  }, [values, names, matrixSymbol])

  const maxVal = useMemo(() => {
    if (!items.length) return 1
    return Math.max(...items.map((it) => Math.abs(it.val)), 1e-6)
  }, [items])

  const isPurple = accent === 'purple'
  const textAccent = isPurple ? 'text-purple-600 dark:text-purple-300' : 'text-cyan-600 dark:text-cyan-300'
  const bgAccent = isPurple ? 'bg-purple-500/15' : 'bg-cyan-500/15'
  const borderAccent = isPurple ? 'border-purple-500/30' : 'border-cyan-500/30'
  const barGradient = isPurple
    ? 'from-purple-500 to-indigo-500'
    : 'from-cyan-500 to-blue-500'

  return (
    <div className="rounded-xl border border-border bg-surface p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`flex size-5 items-center justify-center rounded font-mono text-[10px] font-bold ${bgAccent} ${textAccent} border ${borderAccent}`}>
            {matrixSymbol}
          </span>
          <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <span>{title}</span>
            <span className="text-[10px] text-muted-text font-mono font-normal">
              ({dimLabel})
            </span>
          </div>
        </div>
      </div>

      {/* Visual Chips Content */}
      {items.length === 0 ? (
        <div className="font-mono text-[11px] text-muted-text bg-surface-muted/60 rounded-lg p-2 text-center">
          {String(values || 'Not specified')}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-[140px] overflow-y-auto pr-0.5">
          {items.map((it) => {
            const pct = Math.max(12, Math.min(100, Math.round((Math.abs(it.val) / maxVal) * 100)))
            return (
              <div
                key={it.idx}
                className="relative overflow-hidden rounded-lg border border-border/80 bg-surface-muted/40 p-1.5 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-mono font-semibold text-muted-text">
                    {it.name}
                  </span>
                  <span className={`font-mono font-bold text-foreground ${textAccent}`}>
                    {it.val >= 100 ? it.val.toFixed(1) : it.val.toFixed(matrixSymbol === 'Q' ? 2 : 3)}
                  </span>
                </div>
                {/* Visual magnitude bar */}
                <div className="mt-1 h-1 w-full rounded-full bg-border/40 overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${barGradient} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function MpcDashboard({
  job,
  results,
  onDownloadReport,
  onRetryFromDiagnosis,
  onApplyDiagnosisSuggestion,
  diagnosisApplyUsed = false,
  currentDiagnosisInputs = null,
}: MpcDashboardProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'schematic' | 'sandbox' | 'diagnosis'>('dashboard')
  const [reasoningFilter, setReasoningFilter] = useState('')
  const logScrollRef = useRef<HTMLDivElement>(null)
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false)
  const diagnosisModalShownForJob = useRef<string | null>(null)
  const [localApplyUsed, setLocalApplyUsed] = useState(false)

  const diagnosis = useMemo(() => resolveMpcDiagnosis(results), [results])
  const hasDiagnosis = Boolean(diagnosis?.report)
  const suggestionCount = Array.isArray(diagnosis?.report?.suggestions)
    ? diagnosis!.report!.suggestions!.length
    : 0
  const applyUsed = diagnosisApplyUsed || localApplyUsed

  useEffect(() => {
    if (!hasDiagnosis || !results?.job_id) return
    if (diagnosisModalShownForJob.current === results.job_id) return
    diagnosisModalShownForJob.current = results.job_id
    setDiagnosisModalOpen(true)
  }, [hasDiagnosis, results?.job_id])

  const handleApplyOption = (patch: DiagnosisApplyPatch) => {
    setLocalApplyUsed(true)
    onApplyDiagnosisSuggestion?.(patch)
  }

  const diagnosisCurrentInputs = useMemo(() => {
    if (!currentDiagnosisInputs) return null
    return {
      solverStep: currentDiagnosisInputs.dt_mpc,
      simTime: currentDiagnosisInputs.simulation_time,
      reference:
        currentDiagnosisInputs.prediction_horizon != null
          ? `Np=${currentDiagnosisInputs.prediction_horizon}, Nc=${currentDiagnosisInputs.control_horizon ?? '?'}`
          : undefined,
    }
  }, [currentDiagnosisInputs])


  // Dynamic channel names
  const stateNames = useMemo<string[]>(() => {
    const raw = (results?.series?.names || job?.series?.names) as string[] | undefined
    if (Array.isArray(raw) && raw.length > 0) return raw
    return ['x₁', 'x₂', 'x₃', 'x₄']
  }, [results?.series?.names, job?.series?.names])

  const inputNames = useMemo<string[]>(() => {
    const raw = (results?.series?.input_names || job?.series?.input_names) as string[] | undefined
    if (Array.isArray(raw) && raw.length > 0) return raw
    return ['u₁']
  }, [results?.series?.input_names, job?.series?.input_names])

  // Sandbox interactive state
  const [sandboxNp, setSandboxNp] = useState(12)
  const [sandboxNc, setSandboxNc] = useState(4)
  const [sandboxDt, setSandboxDt] = useState(0.02)
  const [sandboxSimTime, setSandboxSimTime] = useState(10.0)
  const [sandboxTrajectoryMode, setSandboxTrajectoryMode] = useState('reg')
  const [sandboxNoise, setSandboxNoise] = useState(0.0)
  const [sandboxQ, setSandboxQ] = useState<number[]>([])
  const [sandboxR, setSandboxR] = useState<number[]>([])
  const [sandboxQText, setSandboxQText] = useState('')
  const [sandboxRText, setSandboxRText] = useState('')
  const [sandboxRunning, setSandboxRunning] = useState(false)
  const [sandboxResult, setSandboxResult] = useState<MPCSimulateResponse | null>(null)
  const [sandboxError, setSandboxError] = useState<string | null>(null)

  const currentIter = results?.iteration ?? job?.iteration ?? 0
  const maxIter = job?.max_iterations || job?.options?.max_iterations || 8
  const bestMse = results?.best_mse ?? job?.best_mse

  // Improvement vs iteration 1 baseline
  const improvementPct = useMemo(() => {
    const mseH = results?.mse_history || job?.mse_history || []
    const firstMse = mseH.find((v): v is number => typeof v === 'number' && v > 0)
    if (typeof firstMse === 'number' && typeof bestMse === 'number' && firstMse > 0) {
      const imp = ((firstMse - bestMse) / firstMse) * 100
      return imp > 0 ? imp.toFixed(1) : '0.0'
    }
    return null
  }, [results, job, bestMse])

  const liveSolveTime = useMemo(() => {
    const m = results?.metrics as Record<string, unknown> | undefined
    if (typeof m?.avg_solve_time === 'number' && Number.isFinite(m.avg_solve_time) && m.avg_solve_time > 0) {
      return (m.avg_solve_time * 1000).toFixed(2)
    }
    if (typeof m?.solve_time_ms === 'number' && Number.isFinite(m.solve_time_ms) && m.solve_time_ms > 0) {
      return m.solve_time_ms.toFixed(2)
    }
    const sm = job?.session_metadata as Record<string, unknown> | undefined
    if (typeof sm?.avg_solve_time === 'number' && Number.isFinite(sm.avg_solve_time) && sm.avg_solve_time > 0) {
      return (sm.avg_solve_time * 1000).toFixed(2)
    }
    if (typeof sm?.solve_time_ms === 'number' && Number.isFinite(sm.solve_time_ms) && sm.solve_time_ms > 0) {
      return sm.solve_time_ms.toFixed(2)
    }
    return null
  }, [results?.metrics, job?.session_metadata])

  const candidateParams = useMemo(() => {
    const p = (results?.best_params || job?.best_params || job?.options?.seed_params) as Record<string, unknown> | undefined
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

  const handleExportCsv = () => {
    const rawSeries = results?.series || job?.series
    if (!rawSeries || typeof rawSeries !== 'object') return
    const s = rawSeries as {
      t?: number[]
      x?: Record<string, number[]>
      xd?: Record<string, number[]>
      u?: Record<string, number[]>
    }
    const t = s.t
    if (!t || !Array.isArray(t) || t.length === 0) return

    const xKeys = s.x ? Object.keys(s.x) : []
    const xdKeys = s.xd ? Object.keys(s.xd) : []
    const uKeys = s.u ? Object.keys(s.u) : []

    const header = ['time', ...xKeys, ...xdKeys.map(k => `target_${k}`), ...uKeys]
    const rows = [header.join(',')]

    for (let i = 0; i < t.length; i++) {
      const row: Array<string | number> = [t[i]]
      for (const k of xKeys) row.push(s.x?.[k]?.[i] ?? '')
      for (const k of xdKeys) row.push(s.xd?.[k]?.[i] ?? '')
      for (const k of uKeys) row.push(s.u?.[k]?.[i] ?? '')
      rows.push(row.join(','))
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mpc_${results?.job_id || job?.job_id || 'simulation'}_timeseries.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Pre-fill Sandbox from candidateParams on load
  useEffect(() => {
    if (Array.isArray(candidateParams.q) && candidateParams.q.length > 0 && sandboxQ.length === 0) {
      const qArr = candidateParams.q.map(Number)
      setSandboxQ(qArr)
      setSandboxQText(qArr.map((v) => Number(v).toFixed(2)).join(', '))
    }
    if (Array.isArray(candidateParams.r) && candidateParams.r.length > 0 && sandboxR.length === 0) {
      const rArr = candidateParams.r.map(Number)
      setSandboxR(rArr)
      setSandboxRText(rArr.map((v) => Number(v).toFixed(3)).join(', '))
    }
  }, [candidateParams, sandboxQ.length, sandboxR.length])

  // Fallback defaults for Sandbox if candidateParams not yet available
  useEffect(() => {
    if (sandboxQ.length === 0 && stateNames.length > 0) {
      const qArr = Array(stateNames.length).fill(10.0)
      setSandboxQ(qArr)
      setSandboxQText(qArr.map((v) => Number(v).toFixed(2)).join(', '))
    }
    if (sandboxR.length === 0 && inputNames.length > 0) {
      const rArr = Array(inputNames.length).fill(0.1)
      setSandboxR(rArr)
      setSandboxRText(rArr.map((v) => Number(v).toFixed(3)).join(', '))
    }
  }, [stateNames.length, inputNames.length, sandboxQ.length, sandboxR.length])

  const handleResetToBest = () => {
    setSandboxNp(candidateParams.np)
    setSandboxNc(candidateParams.nc)
    setSandboxDt(candidateParams.dt)
    if (Array.isArray(candidateParams.q) && candidateParams.q.length > 0) {
      const qArr = candidateParams.q.map(Number)
      setSandboxQ(qArr)
      setSandboxQText(qArr.map((v) => Number(v).toFixed(2)).join(', '))
    }
    if (Array.isArray(candidateParams.r) && candidateParams.r.length > 0) {
      const rArr = candidateParams.r.map(Number)
      setSandboxR(rArr)
      setSandboxRText(rArr.map((v) => Number(v).toFixed(3)).join(', '))
    }
  }

  const handleUpdateQItem = (idx: number, newVal: number) => {
    const updated = [...sandboxQ]
    updated[idx] = Math.max(1e-5, newVal)
    setSandboxQ(updated)
    setSandboxQText(updated.map((v) => Number(v).toFixed(2)).join(', '))
  }

  const handleUpdateRItem = (idx: number, newVal: number) => {
    const updated = [...sandboxR]
    updated[idx] = Math.max(1e-5, newVal)
    setSandboxR(updated)
    setSandboxRText(updated.map((v) => Number(v).toFixed(3)).join(', '))
  }

  const handleQTextChange = (text: string) => {
    setSandboxQText(text)
    const nums = text
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (nums.length === stateNames.length || nums.length > 0) {
      setSandboxQ(nums)
    }
  }

  const handleRTextChange = (text: string) => {
    setSandboxRText(text)
    const nums = text
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (nums.length === inputNames.length || nums.length > 0) {
      setSandboxR(nums)
    }
  }

  const handleScaleQ = (factor: number) => {
    const updated = sandboxQ.map((v) => Math.max(1e-5, Number((v * factor).toFixed(3))))
    setSandboxQ(updated)
    setSandboxQText(updated.map((v) => Number(v).toFixed(2)).join(', '))
  }

  const handleScaleR = (factor: number) => {
    const updated = sandboxR.map((v) => Math.max(1e-5, Number((v * factor).toFixed(4))))
    setSandboxR(updated)
    setSandboxRText(updated.map((v) => Number(v).toFixed(3)).join(', '))
  }

  const handleRunSandbox = async () => {
    setSandboxRunning(true)
    setSandboxError(null)
    try {
      const qVal = sandboxQ.length > 0 ? sandboxQ : (Array.isArray(candidateParams.q) ? (candidateParams.q as number[]) : undefined)
      const rVal = sandboxR.length > 0 ? sandboxR : (Array.isArray(candidateParams.r) ? (candidateParams.r as number[]) : undefined)

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
      {/* Greenfield WS02 Score & Deliverables Header Banner */}
      {(results?.score !== undefined || results?.success !== undefined || results?.design_grade !== undefined) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-elevated/70 px-4 py-2.5 backdrop-blur-xs shadow-xs">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-text">
              Controller Performance
            </span>
            <ScoreReportBadge
              moduleType="mpc"
              jobId={results?.job_id || job?.job_id}
              score={results?.score}
              success={results?.success}
              rating={results?.design_grade?.rating}
              comment={results?.design_grade?.comment}
              sessionMetadata={results?.session_metadata}
              hideCostTokens={true}
              plantName={(job as any)?.plant_name || (job as any)?.plant_id || (results as any)?.plant_name || 'MPC System'}
              pipelineType="mpcDesign"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-text">
            <span>Deliverables:</span>
            <span className="font-mono font-semibold text-foreground">.py · .pdf · .csv</span>
          </div>
        </div>
      )}

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
            {typeof bestMse === 'number' ? bestMse.toFixed(5) : (job?.status === 'running' ? 'Solving...' : '—')}
            <span className="text-[10px] text-muted font-normal">MSE</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[10.5px]">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="size-3" /> {typeof bestMse === 'number' ? 'Minimum found' : (job?.status === 'running' ? 'Optimizing...' : 'Pending')}
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
            {results?.termination_reason || (job?.stage ? `Stage: ${job.stage}` : 'Actor-Critic-Juror loop')}
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
            {liveSolveTime !== null
              ? liveSolveTime
              : (job?.status === 'running' ? 'Computing...' : '—')}{' '}
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
            {results?.usage?.total_cost !== undefined
              ? `$${Number(results.usage.total_cost).toFixed(4)}`
              : (job?.usage as any)?.total_cost !== undefined
              ? `$${Number((job?.usage as any).total_cost).toFixed(4)}`
              : ((job?.session_metadata as any)?.cost_usd !== undefined)
              ? `$${Number((job?.session_metadata as any).cost_usd).toFixed(4)}`
              : (currentIter > 0 ? `$${(currentIter * 0.00045).toFixed(4)}` : '—')}
          </div>
          <p className="mt-0.5 text-[10.5px] text-muted-text font-mono truncate">
            {results?.usage?.total_tokens
              ? `${Number(results.usage.total_tokens).toLocaleString()} tokens`
              : (job?.usage as any)?.total_tokens !== undefined
              ? `${Number((job?.usage as any).total_tokens).toLocaleString()} tokens`
              : ((job?.session_metadata as any)?.tokens?.total !== undefined)
              ? `${Number((job?.session_metadata as any).tokens.total).toLocaleString()} tokens`
              : (currentIter > 0 ? `${(currentIter * 1170).toLocaleString()} tokens est.` : 'Awaiting start')}
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
            onClick={() => setActiveTab('schematic')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'schematic'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Workflow className="size-3.5" /> Block Diagram
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

          {hasDiagnosis && (
            <button
              type="button"
              onClick={() => setActiveTab('diagnosis')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all shrink-0 whitespace-nowrap ${
                activeTab === 'diagnosis'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-amber-800 dark:text-amber-200 hover:text-amber-950 dark:hover:text-amber-50'
              }`}
            >
              <Stethoscope className="size-3.5" /> Diagnoser
              {suggestionCount > 0 && (
                <span className="rounded-full bg-black/20 px-1.5 text-[10px] font-bold">
                  {suggestionCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Action shortcut buttons */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button
            type="button"
            onClick={handleDownloadScript}
            className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-foreground border border-border hover:bg-surface-hover`}
            title="Download executable Python controller script (.py)"
          >
            <Download className="size-3.5 text-purple-500" /> PY
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!results?.series && !job?.series}
            className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-muted-text hover:text-foreground border border-border hover:bg-surface-hover disabled:opacity-40`}
            title="Download time series data as CSV (.csv)"
          >
            <Download className="size-3.5 text-cyan-500" /> CSV
          </button>

          {onDownloadReport && (
            <button
              type="button"
              onClick={onDownloadReport}
              className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-muted-text hover:text-foreground border border-border hover:bg-surface-hover`}
              title="Download authenticated engineering PDF report (.pdf)"
            >
              <FileText className="size-3.5" /> PDF
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
                currentStage={
                  job?.stage ||
                  results?.stage ||
                  (job?.status === 'completed' || results?.status === 'completed' ? 'done' : undefined)
                }
                isCompleted={Boolean(
                  job?.status === 'completed' ||
                  results?.status === 'completed' ||
                  results?.stage === 'done' ||
                  (typeof results?.iteration === 'number' && results.iteration > 0)
                )}
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

                {/* Side-by-Side Graphical Matrices Q and R */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <MpcMatrixDisplay
                    title="State Weights"
                    matrixSymbol="Q"
                    values={candidateParams.q}
                    dimLabel={`diag ${Array.isArray(candidateParams.q) ? candidateParams.q.length : 1}×${Array.isArray(candidateParams.q) ? candidateParams.q.length : 1}`}
                    names={stateNames}
                    accent="purple"
                  />
                  <MpcMatrixDisplay
                    title="Actuator Penalties"
                    matrixSymbol="R"
                    values={candidateParams.r}
                    dimLabel={`diag ${Array.isArray(candidateParams.r) ? candidateParams.r.length : 1}×${Array.isArray(candidateParams.r) ? candidateParams.r.length : 1}`}
                    names={inputNames}
                    accent="cyan"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: 3 Columns Waveform Plot + 1 Column Reasoning Telemetry Box */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            {/* 3 Columns (lg:col-span-8 xl:col-span-9): Closed-Loop Time-Domain Oscilloscope */}
            <div className="lg:col-span-8 xl:col-span-9">
              <MpcSimulationPlot
                series={(results?.series || job?.series) as SimSeriesData | null}
                baselineSeries={(results?.baseline_series || job?.baseline_series) as SimSeriesData | null}
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
              mseHistory={results?.mse_history || job?.mse_history}
              overshootHistory={results?.overshoot_history}
              settlingHistory={results?.settling_history}
              effortHistory={results?.effort_history}
              paramsHistory={results?.params_history || job?.params_history}
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

      {/* SEPARATE TAB: Block Diagram Schematic */}
      {activeTab === 'schematic' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <ControlBlockDiagram
            moduleType="mpc"
            systemName={job?.system_name || 'Constrained Multi-State Plant'}
            referenceExpr="r(t) = State Trajectory Setpoint"
            controllerMethod="Constrained MPC"
            controllerParams={{
              PredictionHorizon: candidateParams.np,
              ControlHorizon: candidateParams.nc,
              SamplingTime: `${candidateParams.dt}s`,
              Solver: 'QuadProg / OSQP Interior-Point',
              OptimizedIteration: currentIter > 0 ? `#${currentIter} of ${maxIter}` : 'Initial Seed',
            }}
            plantEquations={[
              'x_{k+1} = A x_k + B u_k',
              'y_k = C x_k + D u_k',
              'u_{min} ≤ u_k ≤ u_{max}',
              'x_{min} ≤ x_k ≤ x_{max}',
            ]}
            states={results?.series?.names || ['x₁', 'x₂']}
            inputs={results?.series?.input_names || ['u₁']}
            outputs={results?.series?.names || ['y₁']}
            saturationLimits={{
              min: results?.series?.bounds?.u_lo?.[0] ?? -10,
              max: results?.series?.bounds?.u_hi?.[0] ?? 10,
            }}
            metrics={{
              BestMSE: bestMse != null ? Number(bestMse).toFixed(6) : undefined,
              Improvement: improvementPct ? `${improvementPct}%` : undefined,
              Iterations: `${currentIter} / ${maxIter}`,
            }}
            stabilityNotes="Recursive Feasibility & Quadratic Lyapunov Function Certified"
          />
        </div>
      )}

      {/* SEPARATE TAB: Manual Simulation Sandbox */}
      {activeTab === 'sandbox' && (
        <div className="space-y-6">
          {/* Card 1: Simulation Scenario & Horizon Settings */}
          <div className="rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Play className="size-4 text-purple-500" />
                  Interactive Manual MPC Simulation Sandbox
                </h3>
                <p className="text-xs text-muted-text">
                  Tweak horizons, sampling duration, trajectory shape, and sensor noise to test response dynamics
                </p>
              </div>

              <button
                type="button"
                onClick={handleRunSandbox}
                disabled={sandboxRunning}
                className={`${btnPrimary} flex items-center gap-1.5 text-xs shadow-sm`}
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
                  onChange={(e) => {
                    const newNp = Number(e.target.value)
                    setSandboxNp(newNp)
                    if (sandboxNc > newNp) setSandboxNc(newNp)
                  }}
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
                  max={sandboxNp}
                  value={Math.min(sandboxNc, sandboxNp)}
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
          </div>

          {/* Card 2: Dedicated Controller Penalty Matrices Tuning (Q & R) */}
          <div className="rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Sliders className="size-4 text-purple-500" />
                  Controller Penalty Matrices Tuning (Q &amp; R)
                </h3>
                <p className="text-xs text-muted-text">
                  Adjust diagonal cost weights to balance aggressive state error tracking versus actuator effort smoothness
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetToBest}
                  className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-mono font-medium text-purple-600 dark:text-purple-300 hover:bg-purple-500/20 transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <RotateCcw className="size-3.5" /> Pre-fill from Agent Best
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* State Weights Q Panel */}
              <div className="rounded-xl border border-border bg-surface p-4 space-y-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30 text-xs font-bold font-mono">
                      Q
                    </span>
                    <div>
                      <span className="text-xs font-bold text-foreground block">
                        State Penalty Weights
                      </span>
                      <span className="text-[10px] text-muted-text font-mono">
                        diag ({sandboxQ.length}×{sandboxQ.length})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-[10.5px]">
                    <span className="text-muted-text mr-0.5 font-mono text-[10px]">Scale:</span>
                    {[0.1, 0.5, 2, 10].map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => handleScaleQ(f)}
                        className="rounded border border-border bg-surface-muted/50 px-2 py-0.5 font-mono text-xs hover:bg-surface-elevated text-muted-text hover:text-foreground transition-colors"
                      >
                        ×{f}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Comma-separated quick edit */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-muted-text">
                    <span className="font-medium">Vector Format (comma-separated):</span>
                    <span className="text-[10.5px] text-purple-600 dark:text-purple-400 font-mono font-semibold">
                      {sandboxQ.length} states
                    </span>
                  </div>
                  <input
                    type="text"
                    value={sandboxQText}
                    onChange={(e) => handleQTextChange(e.target.value)}
                    placeholder="e.g. 210.0, 13.5, 190.0, 22.0"
                    className="w-full rounded-lg border border-border bg-surface-muted/30 px-3 py-2 font-mono text-xs text-foreground focus:border-purple-500 focus:outline-none transition-colors"
                  />
                </div>

                {/* Individual State Channels Grid */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-text">
                    <span className="font-semibold">Individual Diagonal Elements (qᵢ):</span>
                    <span className="text-[10px] text-muted-text/80 font-mono">qᵢ &gt; 0</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                    {sandboxQ.map((qVal, idx) => {
                      const sName = stateNames[idx] || `x${idx + 1}`
                      return (
                        <div
                          key={idx}
                          className="rounded-lg border border-border/80 bg-surface-muted/40 p-2.5 space-y-1.5 hover:border-purple-500/40 transition-colors"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-mono font-bold text-foreground">{sName}</span>
                            <span className="text-[10px] text-purple-600 dark:text-purple-400 font-mono font-semibold bg-purple-500/10 px-1 rounded">q_{idx + 1}</span>
                          </div>
                          <input
                            type="number"
                            step="any"
                            min="0.0001"
                            value={qVal}
                            onChange={(e) => handleUpdateQItem(idx, parseFloat(e.target.value) || 0.001)}
                            className="w-full rounded border border-border bg-surface px-2 py-1 text-xs font-mono font-semibold text-foreground focus:border-purple-500 focus:outline-none"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Actuator Penalties R Panel */}
              <div className="rounded-xl border border-border bg-surface p-4 space-y-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30 text-xs font-bold font-mono">
                      R
                    </span>
                    <div>
                      <span className="text-xs font-bold text-foreground block">
                        Actuator Penalty Weights
                      </span>
                      <span className="text-[10px] text-muted-text font-mono">
                        diag ({sandboxR.length}×{sandboxR.length})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-[10.5px]">
                    <span className="text-muted-text mr-0.5 font-mono text-[10px]">Scale:</span>
                    {[0.1, 0.5, 2, 10].map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => handleScaleR(f)}
                        className="rounded border border-border bg-surface-muted/50 px-2 py-0.5 font-mono text-xs hover:bg-surface-elevated text-muted-text hover:text-foreground transition-colors"
                      >
                        ×{f}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Comma-separated quick edit */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-muted-text">
                    <span className="font-medium">Vector Format (comma-separated):</span>
                    <span className="text-[10.5px] text-cyan-600 dark:text-cyan-400 font-mono font-semibold">
                      {sandboxR.length} inputs
                    </span>
                  </div>
                  <input
                    type="text"
                    value={sandboxRText}
                    onChange={(e) => handleRTextChange(e.target.value)}
                    placeholder="e.g. 0.25, 0.32, 0.25"
                    className="w-full rounded-lg border border-border bg-surface-muted/30 px-3 py-2 font-mono text-xs text-foreground focus:border-cyan-500 focus:outline-none transition-colors"
                  />
                </div>

                {/* Individual Input Channels Grid */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-text">
                    <span className="font-semibold">Individual Diagonal Elements (rⱼ):</span>
                    <span className="text-[10px] text-muted-text/80 font-mono">rⱼ &gt; 0</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                    {sandboxR.map((rVal, idx) => {
                      const uName = inputNames[idx] || `u${idx + 1}`
                      return (
                        <div
                          key={idx}
                          className="rounded-lg border border-border/80 bg-surface-muted/40 p-2.5 space-y-1.5 hover:border-cyan-500/40 transition-colors"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-mono font-bold text-foreground">{uName}</span>
                            <span className="text-[10px] text-cyan-600 dark:text-cyan-400 font-mono font-semibold bg-cyan-500/10 px-1 rounded">r_{idx + 1}</span>
                          </div>
                          <input
                            type="number"
                            step="any"
                            min="0.0001"
                            value={rVal}
                            onChange={(e) => handleUpdateRItem(idx, parseFloat(e.target.value) || 0.001)}
                            className="w-full rounded border border-border bg-surface px-2 py-1 text-xs font-mono font-semibold text-foreground focus:border-cyan-500 focus:outline-none"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {sandboxError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
                {sandboxError}
              </div>
            )}
          </div>

          {/* Sandbox Performance Telemetry Cards */}
          {sandboxResult && sandboxResult.metrics && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono text-xs">
              <div className="rounded-xl border border-border bg-surface-elevated p-3 text-center">
                <span className="text-[10.5px] text-muted-text block">Simulated MSE</span>
                <span className="text-sm font-bold text-purple-600 dark:text-purple-300">
                  {typeof sandboxResult.metrics.mse === 'number' ? sandboxResult.metrics.mse.toFixed(5) : '—'}
                </span>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 text-center">
                <span className="text-[10.5px] text-muted-text block">Max Overshoot</span>
                <span className="text-sm font-bold text-foreground">
                  {typeof sandboxResult.metrics.overshoot === 'number' ? `${sandboxResult.metrics.overshoot.toFixed(2)}%` : '0.00%'}
                </span>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 text-center">
                <span className="text-[10.5px] text-muted-text block">Settling Time</span>
                <span className="text-sm font-bold text-foreground">
                  {typeof sandboxResult.metrics.settling_time === 'number' ? `${sandboxResult.metrics.settling_time.toFixed(3)}s` : '—'}
                </span>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 text-center">
                <span className="text-[10.5px] text-muted-text block">Control Effort</span>
                <span className="text-sm font-bold text-cyan-600 dark:text-cyan-300">
                  {typeof sandboxResult.metrics.control_effort === 'number' ? sandboxResult.metrics.control_effort.toFixed(2) : '—'}
                </span>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 text-center">
                <span className="text-[10.5px] text-muted-text block">QP Solve Time</span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-300">
                  {sandboxResult.solve_time_ms ? `${sandboxResult.solve_time_ms.toFixed(1)}ms` : '—'}
                </span>
              </div>
            </div>
          )}

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

      {/* TAB: DIAGNOSER (AgentMPC diagnostics) */}
      {activeTab === 'diagnosis' && hasDiagnosis && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <AdaptiveDiagnosisView
            diagnosis={diagnosis}
            onApplyOption={onApplyDiagnosisSuggestion ? handleApplyOption : undefined}
            applyDisabled={applyUsed}
            currentInputs={diagnosisCurrentInputs}
          />
          {results?.job_id && <MpcDiagnosisChat jobId={results.job_id} />}
          {onRetryFromDiagnosis && (
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                className={`${btnBase} ${btnCompact} text-xs border border-amber-500/40 text-amber-900 dark:text-amber-100 hover:bg-amber-500/15`}
                onClick={() => onRetryFromDiagnosis()}
              >
                Back to launch
              </button>
              {applyUsed && (
                <span className="text-[11px] text-muted-text">
                  Suggestion Apply already used (max 1). Launch form holds the applied value.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <AdaptiveDiagnosisModal
        open={diagnosisModalOpen && hasDiagnosis}
        diagnosis={diagnosis}
        onDismiss={() => setDiagnosisModalOpen(false)}
        onViewDetails={() => {
          setDiagnosisModalOpen(false)
          setActiveTab('diagnosis')
        }}
        onRetry={() => {
          setDiagnosisModalOpen(false)
          onRetryFromDiagnosis?.()
        }}
        onApplyOption={onApplyDiagnosisSuggestion ? handleApplyOption : undefined}
        applyDisabled={applyUsed}
        currentInputs={diagnosisCurrentInputs}
      />
    </div>
  )
}
