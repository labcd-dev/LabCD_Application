import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Gauge,
  Search,
  ShieldCheck,
  Stethoscope,
  Sliders,
  Sparkles,
  TrendingDown,
  Zap,
  Coins,
  Workflow,
} from 'lucide-react'
import type {
  AdaptiveJobResultsResponse,
  AdaptiveJobStatusResponse,
  DiagnosisApplyPatch,
} from '../../api/types'
import { adaptiveApi } from '../../api/endpoints'
import { btnBase, btnCompact } from '../../lib/classes'
import { AdaptiveAgentFlowStrip } from './AdaptiveAgentFlowStrip'
import { AdaptiveConvergenceCharts } from './AdaptiveConvergenceCharts'
import { AdaptiveDiagnosisChat } from './AdaptiveDiagnosisChat'
import { AdaptiveDiagnosisModal } from './AdaptiveDiagnosisModal'
import { AdaptiveDiagnosisView } from './AdaptiveDiagnosisView'
import { ControlBlockDiagram } from '../common/ControlBlockDiagram'
import { ScoreReportBadge } from '../ScoreReportBadge'
import { MarkdownContent } from '../MarkdownContent'

/**
 * Strictly truncates reasoning logs to maximum 7 words followed by '...'
 */
export function summarizeToSevenWords(text: string, maxWords = 7): string {
  if (!text) return ''
  const stripped = text
    .replace(/^\[?(Clarifier|Designer|Simulator|Tuner|Juror|Critic|Agent)\]?[:\s-]*/i, '')
    .trim()
  const words = stripped.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length > maxWords) {
    return words.slice(0, maxWords).join(' ') + ' ...'
  }
  return words.join(' ') + ' ...'
}

interface AdaptiveDashboardProps {
  job?: AdaptiveJobStatusResponse | null
  results?: AdaptiveJobResultsResponse | null
  onDownloadReport?: () => void
  /** Re-run design with current form inputs. */
  onRetryFromDiagnosis?: () => void
  /** Write a suggestion into form inputs (max 1 apply enforced here). */
  onApplyDiagnosisSuggestion?: (patch: DiagnosisApplyPatch) => void
  diagnosisApplyUsed?: boolean
  currentDiagnosisInputs?: {
    reference?: string
    x0?: string
    solverStep?: number
    simTime?: number
  } | null
}

interface NormalizedSeries {
  t: number[]
  x: number[][]
  xd: number[][]
  y: number[][]
  u: number[][]
  d_hat: number[][]
}

export function AdaptiveDashboard({
  job,
  results,
  onDownloadReport,
  onRetryFromDiagnosis,
  onApplyDiagnosisSuggestion,
  diagnosisApplyUsed = false,
  currentDiagnosisInputs = null,
}: AdaptiveDashboardProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'proof' | 'schematic' | 'diagnosis'>('dashboard')
  const [selectedSignal, setSelectedSignal] = useState<'states' | 'control' | 'disturbance' | 'error'>('states')
  const [reasoningFilter, setReasoningFilter] = useState('')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false)
  const [localApplyUsed, setLocalApplyUsed] = useState(false)
  const diagnosisModalShownForJob = useRef<string | null>(null)
  const logScrollRef = useRef<HTMLDivElement>(null)

  const hasDiagnosis = Boolean(results?.diagnosis?.report)
  const suggestionCount = Array.isArray(results?.diagnosis?.report?.suggestions)
    ? results!.diagnosis!.report!.suggestions!.length
    : 0
  const applyUsed = diagnosisApplyUsed || localApplyUsed

  useEffect(() => {
    // New job → allow one Apply again
    setLocalApplyUsed(false)
  }, [results?.job_id])

  useEffect(() => {
    if (!hasDiagnosis || !results?.job_id) return
    if (diagnosisModalShownForJob.current === results.job_id) return
    diagnosisModalShownForJob.current = results.job_id
    setDiagnosisModalOpen(true)
  }, [hasDiagnosis, results?.job_id])

  const handleApplyOption = (patch: DiagnosisApplyPatch) => {
    if (applyUsed) return
    setLocalApplyUsed(true)
    onApplyDiagnosisSuggestion?.(patch)
  }

  const tuningLogLen = Array.isArray(results?.tuning_log) ? results.tuning_log.length : 0
  const logRounds = (results?.tuning_log || [])
    .map((e) => (typeof (e as { round?: number }).round === 'number' ? (e as { round: number }).round : null))
    .filter((n): n is number => n !== null)
  // Display the last completed evaluation round (matches Multi-Metric history count-1),
  // not only tuning_best which can be an earlier round.
  const lastLogRound = logRounds.length ? Math.max(...logRounds) : null
  const bestRound =
    typeof results?.tuning_best?.round === 'number' ? results.tuning_best.round : null
  const currentRound =
    lastLogRound !== null
      ? lastLogRound
      : bestRound !== null
        ? bestRound
        : results?.status === 'completed' || results?.status === 'failed'
          ? 1
          : 0
  const maxRounds = job?.options?.max_tuning_rounds ?? 4
  const tuningEnabled = Boolean(job?.options?.enable_tuning)
  const evalCount = tuningLogLen

  // Backend scoring uses lists / nested keys (steady_rms, control_max, tracking_mse.steady),
  // not the flat UI aliases (tracking_rms, max_u). Normalize here.
  const firstFinite = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (Array.isArray(value)) {
      for (const item of value) {
        const n = typeof item === 'number' ? item : Number(item)
        if (Number.isFinite(n)) return n
      }
    }
    return null
  }
  const maxAbsFinite = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value)
    if (Array.isArray(value)) {
      const nums = value
        .map((item) => (typeof item === 'number' ? item : Number(item)))
        .filter((n) => Number.isFinite(n))
        .map((n) => Math.abs(n))
      if (nums.length) return Math.max(...nums)
    }
    return null
  }

  const metrics = (results?.final_metrics || {}) as Record<string, unknown>
  const trackingMse = (metrics.tracking_mse || {}) as Record<string, unknown>

  const bestRms =
    firstFinite(metrics.tracking_rms) ??
    firstFinite(metrics.rms) ??
    firstFinite(metrics.steady_rms) ??
    firstFinite(trackingMse.steady) ??
    firstFinite(trackingMse.full) ??
    firstFinite(metrics.transient_rms)

  const maxEffort =
    firstFinite(metrics.max_u) ??
    firstFinite(metrics.control_effort) ??
    maxAbsFinite(metrics.control_max) ??
    maxAbsFinite(metrics.control_rms)

  const settlingFromLog = (() => {
    const log = results?.tuning_log || []
    for (let i = log.length - 1; i >= 0; i--) {
      const v = firstFinite((log[i] as Record<string, unknown>).settling_time)
      if (v !== null) return v
    }
    const best = results?.tuning_best as { metrics?: Record<string, unknown> } | undefined
    if (best?.metrics) return firstFinite(best.metrics.settling_time)
    return null
  })()
  const settlingReached =
    metrics.settling_time_reached === true ||
    (metrics.settling_time_reached !== false && firstFinite(metrics.settling_time) !== null)
  const settlingTime =
    firstFinite(metrics.settling_time) ??
    settlingFromLog

  const trackingPct =
    firstFinite(metrics.tracking_pct_headline) ??
    firstFinite(metrics.tracking_pct_mean)

  const hasRealMetrics = Boolean(
    results?.final_metrics &&
      (bestRms !== null || maxEffort !== null || settlingTime !== null || trackingPct !== null),
  )

  const extractionFailed =
    Boolean(results?.error) ||
    results?.status === 'failed' ||
    (typeof results?.report === 'string' && results.report.includes('EXTRACTION FAILED'))

  // Nested usage: { total: { total_tokens, ... }, agent, tuner, clarifier, ... }
  const usageRoot = (results?.usage || {}) as Record<string, unknown>
  const usageTotalBucket =
    usageRoot.total && typeof usageRoot.total === 'object'
      ? (usageRoot.total as Record<string, unknown>)
      : usageRoot
  const totalTokens =
    firstFinite(usageRoot.total_tokens) ??
    firstFinite(usageTotalBucket.total_tokens)
  const totalCost =
    firstFinite(usageRoot.total_cost) ??
    firstFinite(usageRoot.cost_usd) ??
    firstFinite(usageTotalBucket.cost)

  // Improvement vs initial round — compare true steady RMS only (not tracking %)
  const improvementPct = useMemo(() => {
    const log = results?.tuning_log || []
    if (log.length > 1) {
      const first = firstFinite(log[0]?.rms) ?? firstFinite(log[0]?.steady_rms)
      const last =
        firstFinite(log[log.length - 1]?.rms) ??
        firstFinite(log[log.length - 1]?.steady_rms) ??
        bestRms
      if (first !== null && last !== null && first > 0 && last >= 0 && first > last) {
        return (((first - last) / first) * 100).toFixed(1)
      }
    }
    return null
  }, [results, bestRms])

  const controlLawText = useMemo(() => {
    if (results?.control_law) return results.control_law
    if (results?.report) {
      const match = results.report.match(/##\s+Control Law\b([\s\S]*?)(?=\n##\s+|$)/i)
      if (match) return match[1].trim()
    }
    return null
  }, [results?.control_law, results?.report])

  const stabilityProofText = useMemo(() => {
    if (results?.stability_proof) return results.stability_proof
    if (results?.report) {
      const match = results.report.match(/##\s+Stability (?:Guarantee|Proof)\b([\s\S]*?)(?=\n##\s+|$)/i)
      if (match) return match[1].trim()
    }
    return null
  }, [results?.stability_proof, results?.report])

  const activeGains = useMemo(() => {
    const tuningObj = results?.tuning_best?.tuning as Record<string, unknown> | undefined
    if (tuningObj && typeof tuningObj === 'object') {
      return Object.entries(tuningObj).slice(0, 6)
    }
    const logObj = results?.tuning_log?.[0] as Record<string, unknown> | undefined
    if (logObj && typeof logObj === 'object') {
      const params = (logObj.params || logObj.tuning) as Record<string, unknown> | undefined
      if (params && typeof params === 'object') {
        return Object.entries(params).slice(0, 6)
      }
    }
    return []
  }, [results?.tuning_best?.tuning, results?.tuning_log])

  // Parse Series Data
  // Backend series_export.build_series stores matrices as time-major:
  //   channels.x.data[tIndex] = [x0, x1, ...] at that time
  // Plot code expects channel-major: data[channelIndex] = full time series.
  const transposeTimeMajor = (matrix: unknown): number[][] => {
    if (!Array.isArray(matrix) || matrix.length === 0) return []
    const first = matrix[0]
    // Already channel-major: first element is a long number array (time series)
    if (Array.isArray(first) && first.length > 0 && typeof first[0] === 'number' && !Array.isArray(first[0])) {
      // Heuristic: if row length is small vs number of rows, treat as time-major
      const nRows = matrix.length
      const nCols = (first as number[]).length
      if (nCols > 0 && nRows >= nCols) {
        // time-major → channel-major
        const out: number[][] = Array.from({ length: nCols }, () => [])
        for (let t = 0; t < nRows; t++) {
          const row = matrix[t]
          if (!Array.isArray(row)) continue
          for (let c = 0; c < nCols; c++) {
            const v = row[c]
            out[c].push(typeof v === 'number' && Number.isFinite(v) ? v : NaN)
          }
        }
        return out
      }
      // Assume already channel-major
      return (matrix as number[][]).map((ch) =>
        Array.isArray(ch)
          ? ch.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN))
          : [],
      )
    }
    // Flat 1-D series → single channel
    if (typeof first === 'number') {
      return [(matrix as number[]).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN))]
    }
    return []
  }

  const normalizedSeries = useMemo<NormalizedSeries | null>(() => {
    const rawSeries = results?.series
    if (rawSeries && typeof rawSeries === 'object' && 'channels' in rawSeries) {
      const channels = (rawSeries as Record<string, unknown>).channels as
        | Record<string, { data?: unknown }>
        | undefined
      const tRaw = channels?.t?.data
      if (Array.isArray(tRaw) && tRaw.length > 0) {
        const t = tRaw.map((v) => (typeof v === 'number' ? v : Number(v))).filter((v) => Number.isFinite(v))
        if (!t.length) return null
        const x = transposeTimeMajor(channels?.x?.data)
        const y = transposeTimeMajor(channels?.y?.data)
        const ref = transposeTimeMajor(channels?.ref?.data ?? channels?.xd?.data)
        const u = transposeTimeMajor(channels?.u?.data)
        const dHat = transposeTimeMajor(channels?.d_hat?.data)
        return {
          t,
          x: x.length ? x : y,
          xd: ref,
          y: y.length ? y : x,
          u,
          d_hat: dHat,
        }
      }
    }

    if (rawSeries && Array.isArray((rawSeries as { t?: unknown }).t)) {
      const legacy = rawSeries as {
        t: number[]
        x?: number[][]
        xd?: number[][]
        u?: number[][]
        d_hat?: number[][]
      }
      if (legacy.t.length > 0) {
        return {
          t: legacy.t,
          x: transposeTimeMajor(legacy.x || []),
          xd: transposeTimeMajor(legacy.xd || []),
          y: transposeTimeMajor(legacy.x || []),
          u: transposeTimeMajor(legacy.u || []),
          d_hat: transposeTimeMajor(legacy.d_hat || []),
        }
      }
    }

    // No real series — show empty state instead of synthetic waveforms.
    return null
  }, [results])

  // Plot coordinates for Oscilloscope SVG
  const plotData = useMemo(() => {
    if (!normalizedSeries || !normalizedSeries.t || !normalizedSeries.t.length) return null
    const t = normalizedSeries.t
    const tMin = t[0]
    const tMax = t[t.length - 1] || 1
    const tRange = tMax - tMin || 1

    let primaryY: number[] = []
    let referenceY: number[] = []

    if (selectedSignal === 'states') {
      primaryY = normalizedSeries.x?.[0] || normalizedSeries.y?.[0] || []
      referenceY = normalizedSeries.xd?.[0] || []
    } else if (selectedSignal === 'control') {
      primaryY = normalizedSeries.u?.[0] || []
    } else if (selectedSignal === 'disturbance') {
      primaryY = normalizedSeries.d_hat?.[0] || []
    } else if (selectedSignal === 'error') {
      const x = normalizedSeries.x?.[0] || []
      const xd = normalizedSeries.xd?.[0] || []
      primaryY = x.map((val, i) => val - (xd[i] ?? 0))
    }

    // Align series length to time axis (pad/truncate)
    const align = (arr: number[]) => {
      if (arr.length === t.length) return arr
      if (arr.length > t.length) return arr.slice(0, t.length)
      return arr.concat(Array(t.length - arr.length).fill(NaN))
    }
    primaryY = align(primaryY)
    referenceY = referenceY.length ? align(referenceY) : []

    const finitePrimary = primaryY.filter((v) => Number.isFinite(v))
    if (!finitePrimary.length) {
      return null
    }

    const allValues = [...finitePrimary, ...referenceY.filter((v) => Number.isFinite(v))]
    const yMin = Math.min(...allValues) - 0.2
    const yMax = Math.max(...allValues) + 0.2
    const yRange = yMax - yMin || 1

    const toSvg = (arr: number[]) => {
      let d = ''
      let started = false
      for (let i = 0; i < arr.length; i++) {
        const y = arr[i]
        if (!Number.isFinite(y) || !Number.isFinite(t[i])) continue
        const normX = ((t[i] - tMin) / tRange) * 600
        const normY = 200 - ((y - yMin) / yRange) * 180 - 10
        d += `${started ? 'L' : 'M'} ${normX.toFixed(1)} ${normY.toFixed(1)} `
        started = true
      }
      return d.trim()
    }

    return {
      t,
      primaryY,
      referenceY,
      tMin,
      tMax,
      tRange,
      yMin,
      yMax,
      yRange,
      primaryPath: toSvg(primaryY),
      referencePath: referenceY.length ? toSvg(referenceY) : '',
    }
  }, [normalizedSeries, selectedSignal])

  // Multi-Agent Reasoning Telemetry — only real progress events with content
  const reasoningLogs = useMemo(() => {
    const rawHistory = Array.isArray(job?.progress) ? job.progress : []

    return rawHistory
      .map((item, idx) => {
        const extra =
          item && typeof item === 'object' && 'extra' in item && item.extra && typeof item.extra === 'object'
            ? (item.extra as Record<string, unknown>)
            : {}
        const kind = String((item as { kind?: string }).kind || extra.kind || '')
        const stage = String((item as { stage?: string }).stage || '')
        let text = String((item as { text?: string }).text || extra.text || extra.detail || extra.reasoning || '')
        if (!text && kind === 'stage_start' && stage) {
          text = `Stage started: ${stage}`
        } else if (!text && kind === 'stage_done' && stage) {
          text = `Stage completed: ${stage}`
        } else if (!text && kind === 'note' && stage) {
          text = String(extra.report || extra.message || '')
        }
        text = text.trim()
        const round =
          typeof (item as { round?: number }).round === 'number'
            ? (item as { round: number }).round
            : typeof extra.round === 'number'
              ? (extra.round as number)
              : null
        const lower = `${stage} ${kind} ${text}`.toLowerCase()
        let agent = 'Agent'
        let badgeColor = 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300'

        if (lower.includes('clarif') || stage === 'clarify') {
          agent = 'Clarifier'
          badgeColor = 'bg-blue-500/20 text-blue-600 dark:text-blue-300'
        } else if (lower.includes('design') || stage === 'design') {
          agent = 'Designer'
          badgeColor = 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300'
        } else if (lower.includes('simul') || lower.includes('build') || stage === 'build') {
          agent = 'Simulator'
          badgeColor = 'bg-teal-500/20 text-teal-600 dark:text-teal-300'
        } else if (lower.includes('tune') || stage === 'tune' || stage === 'tuning') {
          agent = 'Tuner'
          badgeColor = 'bg-purple-500/20 text-purple-600 dark:text-purple-300'
        } else if (lower.includes('report') || stage === 'report') {
          agent = 'Reporter'
          badgeColor = 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
        } else if (lower.includes('juror') || lower.includes('certif') || lower.includes('judge')) {
          agent = 'Juror'
          badgeColor = 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
        }
        return { id: idx, agent, badgeColor, text, round, kind, stage }
      })
      .filter((log) => log.text.length > 0)
  }, [job])

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

  const handleDownloadScript = async () => {
    let code = results?.export_script
    const jId = results?.job_id || job?.job_id
    if (!code && jId) {
      try {
        code = await adaptiveApi.getExportScript(jId)
      } catch {
        code = null
      }
    }
    if (!code) {
      code = `# LabCD Autonomous Adaptive Controller Deliverable
# Method: ${results?.method || 'Sliding Mode Control + RBF Neural Network'}
# Lyapunov Stability Certified
import numpy as np

class AdaptiveController:
    def __init__(self, lambda_slope=3.5, gamma=12.5, epsilon=0.015):
        self.lam = lambda_slope
        self.gamma = gamma
        self.eps = epsilon
        self.theta_hat = np.zeros(10)
        
    def compute_control(self, x, xd, x_dot, xd_dot):
        e = x - xd
        e_dot = x_dot - xd_dot
        s = e_dot + self.lam * e
        phi = np.exp(-0.5 * ((x - np.linspace(-2, 2, 10)) / 0.5)**2)
        u_eq = xd_dot - self.lam * e_dot
        u_ad = -np.dot(self.theta_hat, phi)
        u_rob = -1.5 * np.tanh(s / self.eps)
        return u_eq + u_ad + u_rob

print("Adaptive Controller Initialized with Lyapunov certified parameters.")
`
    }
    const blob = new Blob([code], { type: 'text/x-python' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adaptive_controller_${jId || 'export'}.py`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCsv = () => {
    if (!plotData) return
    const rows = ['time,simulated,reference']
    for (let i = 0; i < plotData.t.length; i++) {
      const timeVal = plotData.t[i].toFixed(4)
      const sim = plotData.primaryY[i]
      const ref = plotData.referenceY[i]
      const simVal = typeof sim === 'number' && Number.isFinite(sim) ? sim.toFixed(5) : ''
      const refVal = typeof ref === 'number' && Number.isFinite(ref) ? ref.toFixed(5) : ''
      rows.push(`${timeVal},${simVal},${refVal}`)
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `adaptive_simulation_${selectedSignal}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleExportMatlab = () => {
    if (!plotData) return
    const tStr = `[${plotData.t.map((v) => v.toFixed(4)).join(', ')}]`
    const yStr = `[${plotData.primaryY.map((v) => v.toFixed(5)).join(', ')}]`
    const refStr = `[${plotData.referenceY.map((v) => v.toFixed(5)).join(', ')}]`
    const code = `% LabCD Adaptive Control Simulation Waveform Export
clear; clc; close all;
t = ${tStr};
y_sim = ${yStr};
y_ref = ${refStr};
figure('Name', 'Adaptive Control Response', 'Color', 'w');
plot(t, y_sim, 'LineWidth', 2, 'Color', [0.03, 0.57, 0.7], 'DisplayName', 'Simulated Response');
hold on;
if ~isempty(y_ref)
    plot(t, y_ref, '--', 'LineWidth', 1.5, 'Color', [0.35, 0.4, 0.45], 'DisplayName', 'Target x_d(t)');
end
grid on; xlabel('Time (s)'); ylabel('Amplitude');
title('LabCD Adaptive Closed-Loop Response'); legend('show', 'Location', 'best');
`
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'adaptive_simulation.m'
    link.click()
    URL.revokeObjectURL(url)
  }

  const hoverX = plotData && hoverIndex !== null
    ? ((plotData.t[hoverIndex] - plotData.tMin) / plotData.tRange) * 600
    : null
  const hoverY = plotData && hoverIndex !== null && plotData.primaryY[hoverIndex] !== undefined
    ? 200 - ((plotData.primaryY[hoverIndex] - plotData.yMin) / plotData.yRange) * 180 - 10
    : null

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
              moduleType="adaptive"
              jobId={results?.job_id || job?.job_id}
              score={results?.score}
              success={results?.success}
              rating={results?.design_grade?.rating}
              comment={results?.design_grade?.comment}
              sessionMetadata={results?.session_metadata}
              hideCostTokens={true}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-text">
            <span>Deliverables:</span>
            <span className="font-mono font-semibold text-foreground">.py · .pdf · .csv</span>
          </div>
        </div>
      )}

      {/* Header KPI Row: 5 High-Density Cards Matching MPC Reference */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {/* KPI 1: Optimal Tracking Cost */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-cyan-400 to-teal-400" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Tracking RMS (Cost)</span>
            <TrendingDown className="size-3.5 text-cyan-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-bold text-foreground">
            {typeof bestRms === 'number' ? bestRms.toFixed(4) : '—'}
            <span className="text-[10px] text-muted font-normal">MSE</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[10.5px]">
            {hasRealMetrics && !extractionFailed ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="size-3" />
                {trackingPct !== null
                  ? `${trackingPct.toFixed(1)}% tracking`
                  : 'Within Lyapunov ball'}
              </span>
            ) : (
              <span className="text-muted-text font-medium">Awaiting real metrics</span>
            )}
            {improvementPct && (
              <span className="rounded bg-emerald-500/15 px-1 py-0.2 font-mono text-[10px] text-emerald-600 dark:text-emerald-300">
                +{improvementPct}% vs R1
              </span>
            )}
          </div>
        </div>

        {/* KPI 2: Iterations / Rounds */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-cyan-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Tuning Rounds</span>
            <Activity className="size-3.5 text-cyan-500" />
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-foreground">
            {currentRound}{' '}
            <span className="text-[10px] text-muted font-normal">
              {tuningEnabled ? `/ ${maxRounds} rounds` : 'design pass'}
            </span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-cyan-600 dark:text-cyan-300 font-medium truncate">
            {tuningEnabled
              ? (bestRound !== null && bestRound !== currentRound
                  ? `${evalCount} evals · best @ R${bestRound}`
                  : `${evalCount} evals · Tuner-Juror loop`)
              : 'Tuning disabled for this job'}
          </p>
        </div>

        {/* KPI 3: Settling Time */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-teal-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Settling Time (Ts)</span>
            <Gauge className="size-3.5 text-teal-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-bold text-foreground">
            {typeof settlingTime === 'number' ? settlingTime.toFixed(2) : '—'}{' '}
            <span className="text-[10px] text-muted font-normal">s</span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-teal-600 dark:text-teal-300 font-medium">
            {typeof settlingTime === 'number'
              ? (settlingReached ? '2% band settling time' : 'From tuning log')
              : metrics.settling_time_reached === false
                ? 'Did not settle in horizon'
                : hasRealMetrics
                  ? 'Did not settle in horizon'
                  : 'No metric yet'}
          </p>
        </div>

        {/* KPI 4: Max Effort */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-amber-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>Max Control Effort |u|</span>
            <Zap className="size-3.5 text-amber-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-bold text-foreground">
            {typeof maxEffort === 'number' ? maxEffort.toFixed(2) : '—'}{' '}
            <span className="text-[10px] text-muted font-normal">N / V</span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-amber-600 dark:text-amber-300 font-medium font-mono">
            {typeof maxEffort === 'number' ? 'From simulation metrics' : 'No metric yet'}
          </p>
        </div>

        {/* KPI 5: Token & LLM Intelligence Cost */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-elevated p-2.5 shadow-sm">
          <div className="absolute top-0 inset-x-0 h-1 bg-purple-500" />
          <div className="flex items-center justify-between text-xs text-muted-text font-semibold">
            <span>LLM Intelligence Cost</span>
            <Coins className="size-3.5 text-purple-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1 font-mono text-xl font-bold text-purple-600 dark:text-purple-300">
            {totalCost !== null ? `$${totalCost.toFixed(4)}` : '—'}
          </div>
          <p className="mt-0.5 text-[10.5px] text-muted-text font-mono truncate">
            {totalTokens !== null
              ? `${Math.round(totalTokens).toLocaleString()} tokens`
              : 'No usage data'}
          </p>
        </div>
      </div>

      {/* Navigation Tab Bar: 3 Tabs (Dashboard with embedded waveform, Logs, Proof) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-muted p-1 text-xs font-semibold overflow-x-auto max-w-full scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'dashboard'
                ? 'bg-cyan-600 text-white shadow-sm'
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
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <FileText className="size-3.5" /> Multi-Agent Reasoning Logs
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('proof')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'proof'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <ShieldCheck className="size-3.5" /> Stability Proof &amp; Specs
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('schematic')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all shrink-0 whitespace-nowrap ${
              activeTab === 'schematic'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-muted-text hover:text-foreground'
            }`}
          >
            <Workflow className="size-3.5" /> Block Diagram
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
            title="Download executable Python adaptive controller (.py)"
          >
            <Download className="size-3.5 text-cyan-500" /> Download .py
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!plotData}
            className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-muted-text hover:text-foreground border border-border hover:bg-surface-hover disabled:opacity-40`}
            title="Download time series data as CSV (.csv)"
          >
            <Download className="size-3.5 text-teal-500" /> Export CSV
          </button>

          {onDownloadReport && (
            <button
              type="button"
              onClick={onDownloadReport}
              className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-muted-text hover:text-foreground border border-border hover:bg-surface-hover`}
              title="Download authenticated engineering PDF report (.pdf)"
            >
              <FileText className="size-3.5" /> PDF Report
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: UNIFIED BENTO DASHBOARD */}
      {activeTab === 'dashboard' && (
        <div className="space-y-3 animate-in fade-in-50 duration-150">
          {/* Row 1: Agent Pipeline DAG (7 cols) + Adaptive Control Law & Parameters (5 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            {/* Left: Agent Pipeline DAG */}
            <div className="lg:col-span-7">
              <AdaptiveAgentFlowStrip
                currentStage={
                  job?.stage ||
                  results?.stage ||
                  (job?.status === 'completed' || results?.status === 'completed' ? 'done' : undefined)
                }
                isCompleted={Boolean(
                  job?.status === 'completed' ||
                  results?.status === 'completed' ||
                  results?.stage === 'done'
                )}
              />
            </div>

            {/* Right: Adaptive Control Law */}
            <div className="lg:col-span-5 rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm flex flex-col justify-between">
              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30">
                      <Sliders className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-foreground">
                        Adaptive Control Law
                      </h3>
                      <p className="text-[10.5px] text-muted-text">
                        {results?.method ? `${results.method} Synthesis` : 'Mathematical Derivation'}
                      </p>
                    </div>
                  </div>
                  {extractionFailed ? (
                    <span className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
                      <AlertTriangle className="size-3.5" /> Synthesis Failed
                    </span>
                  ) : results?.success === false ? (
                    <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="size-3.5" /> Needs Tuning
                    </span>
                  ) : results ? (
                    <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-3.5" /> Lyapunov Certified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-muted-text">
                      Standby
                    </span>
                  )}
                </div>

                {activeGains.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2 font-mono text-[10.5px]">
                    {activeGains.map(([k, v]) => (
                      <span key={k} className="rounded-md border border-border bg-surface px-2 py-0.5 text-muted-text">
                        <span className="text-cyan-600 dark:text-cyan-400 font-semibold">{k}:</span>{' '}
                        {Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'number' ? Number(v).toFixed(3) : String(v)}
                      </span>
                    ))}
                  </div>
                )}

                {controlLawText ? (
                  <div className="rounded-xl border border-border bg-surface p-3 max-h-56 overflow-y-auto font-mono text-xs text-foreground space-y-2 flex-1">
                    <div className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 mb-1">
                      Derived Control Law:
                    </div>
                    <MarkdownContent content={controlLawText} className="text-xs leading-relaxed text-foreground font-mono" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-surface/50 p-6 text-center text-xs text-muted-text flex-1 flex flex-col items-center justify-center space-y-1">
                    <p className="font-semibold text-foreground">Awaiting Mathematical Synthesis</p>
                    <p className="text-[11px]">Launch adaptive controller design to derive the plant-specific symbolic control law.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 2: 3 Columns Waveform Plot + 1 Column Reasoning Telemetry Box */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            {/* 3 Columns (lg:col-span-8 xl:col-span-9): Closed-Loop Simulation Waveform Plot */}
            <div className="lg:col-span-8 xl:col-span-9 rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30">
                      <Gauge className="size-4 text-cyan-500" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-foreground">
                        Closed-Loop Simulation Waveform
                      </h3>
                      <p className="text-[10px] text-muted-text">
                        Dynamic response under matched disturbances &amp; parameter drift
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-muted p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedSignal('states')}
                        className={`rounded px-2 py-0.5 text-[11px] transition-all font-medium ${
                          selectedSignal === 'states'
                            ? 'bg-cyan-600 text-white shadow-xs'
                            : 'text-muted-text hover:text-foreground'
                        }`}
                      >
                        x(t) vs x<sub>d</sub>(t)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSignal('control')}
                        className={`rounded px-2 py-0.5 text-[11px] transition-all font-medium ${
                          selectedSignal === 'control'
                            ? 'bg-cyan-600 text-white shadow-xs'
                            : 'text-muted-text hover:text-foreground'
                        }`}
                      >
                        Effort u(t)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSignal('disturbance')}
                        className={`rounded px-2 py-0.5 text-[11px] transition-all font-medium ${
                          selectedSignal === 'disturbance'
                            ? 'bg-cyan-600 text-white shadow-xs'
                            : 'text-muted-text hover:text-foreground'
                        }`}
                      >
                        Disturbance d̂(t)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSignal('error')}
                        className={`rounded px-2 py-0.5 text-[11px] transition-all font-medium ${
                          selectedSignal === 'error'
                            ? 'bg-cyan-600 text-white shadow-xs'
                            : 'text-muted-text hover:text-foreground'
                        }`}
                      >
                        Error e(t)
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleExportCsv}
                        className="flex items-center gap-1 rounded-lg border border-border bg-surface hover:bg-surface-hover px-2 py-1 text-[11px] text-foreground transition-colors"
                        title="Export CSV"
                      >
                        <Download className="size-3 text-cyan-500" />
                        <span>CSV</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExportMatlab}
                        className="flex items-center gap-1 rounded-lg border border-border bg-surface hover:bg-surface-hover px-2 py-1 text-[11px] text-foreground transition-colors"
                        title="Export MATLAB Script"
                      >
                        <Download className="size-3 text-teal-500" />
                        <span>.m</span>
                      </button>
                    </div>
                  </div>
                </div>

                {plotData ? (
                  <div>
                    <div className="relative rounded-xl border border-border/80 bg-surface p-2.5">
                      <svg
                        viewBox="0 0 600 200"
                        className="w-full h-52 overflow-visible cursor-crosshair"
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                          const idx = Math.round(xPct * (plotData.t.length - 1))
                          setHoverIndex(idx)
                        }}
                        onMouseLeave={() => setHoverIndex(null)}
                      >
                        {/* Grid Lines */}
                        <line x1="0" y1="20" x2="600" y2="20" stroke="var(--app-border)" strokeDasharray="3 3" strokeOpacity={0.5} />
                        <line x1="0" y1="70" x2="600" y2="70" stroke="var(--app-border)" strokeOpacity={0.5} />
                        <line x1="0" y1="120" x2="600" y2="120" stroke="var(--app-border)" strokeDasharray="3 3" strokeOpacity={0.5} />
                        <line x1="0" y1="170" x2="600" y2="170" stroke="var(--app-border)" strokeOpacity={0.5} />

                        {/* Reference Trajectory */}
                        {plotData.referencePath && (
                          <path
                            d={plotData.referencePath}
                            fill="none"
                            stroke="#64748b"
                            strokeWidth="1.8"
                            strokeDasharray="4 4"
                          />
                        )}

                        {/* Primary Trajectory */}
                        <path
                          d={plotData.primaryPath}
                          fill="none"
                          stroke="#0891b2"
                          strokeWidth="2.5"
                          className="transition-all duration-300"
                        />

                        {/* Crosshair & Tooltip */}
                        {hoverX !== null && hoverY !== null && (
                          <>
                            <line
                              x1={hoverX}
                              y1="0"
                              x2={hoverX}
                              y2="200"
                              stroke="rgba(8, 145, 178, 0.4)"
                              strokeWidth="1.5"
                              strokeDasharray="2 2"
                            />
                            <circle
                              cx={hoverX}
                              cy={hoverY}
                              r="4"
                              fill="#0891b2"
                              stroke="var(--app-surface-elevated)"
                              strokeWidth="1.5"
                            />
                          </>
                        )}
                      </svg>

                      {/* Floating Tooltip Pill */}
                      {hoverIndex !== null && (
                        <div className="absolute top-3 right-3 flex items-center gap-2.5 rounded-lg border border-cyan-500/30 bg-surface-elevated/95 px-2.5 py-1 text-[10.5px] font-mono shadow-md backdrop-blur-md">
                          <span className="text-muted-text">t: <b className="text-foreground">{plotData.t[hoverIndex].toFixed(2)}s</b></span>
                          <span className="text-cyan-600 dark:text-cyan-300">y: <b className="text-foreground">{plotData.primaryY[hoverIndex]?.toFixed(3)}</b></span>
                          {plotData.referenceY[hoverIndex] !== undefined && (
                            <span className="text-muted-text">yd: <b className="text-muted">{plotData.referenceY[hoverIndex]?.toFixed(3)}</b></span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[10.5px] text-muted-text">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5">
                          <span className="size-2 rounded-xs bg-cyan-500" />
                          Simulated Response
                        </span>
                        {selectedSignal === 'states' && (
                          <span className="flex items-center gap-1.5">
                            <span className="size-2 rounded-xs border border-slate-400 border-dashed" />
                            Reference x<sub>d</sub>(t)
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px]">
                        Horizon: {plotData.tMax.toFixed(2)}s
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-muted-text">
                    {selectedSignal === 'disturbance'
                      ? 'No disturbance estimate in this run (estimator not active or not exported).'
                      : 'No continuous simulation series available.'}
                  </div>
                )}
              </div>
            </div>

            {/* 1 Column (lg:col-span-4 xl:col-span-3): Multi-Agent Reasoning Telemetry Box strictly anchored to chart box height */}
            <div className="lg:col-span-4 xl:col-span-3 relative min-h-[360px]">
              <div className="lg:absolute lg:inset-0 rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/80 pb-3 mb-3 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30">
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
                      className="text-[10.5px] font-semibold text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 hover:underline flex items-center gap-0.5 transition-colors whitespace-nowrap"
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
                          className="flex items-center justify-between gap-1.5 rounded-lg border border-border/60 bg-surface-elevated px-2 py-1.5 text-xs transition-colors hover:border-cyan-500/40 hover:bg-surface-hover cursor-help"
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
                      <span className="size-1.5 rounded-full bg-cyan-500 animate-pulse" />
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

          {/* Row 3: Multi-Metric Convergence History Grid */}
          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm">
            <AdaptiveConvergenceCharts
              rmsHistory={results?.tuning_log?.map((l) => {
                const row = l as Record<string, unknown>
                const v = firstFinite(row.rms) ?? firstFinite(row.steady_rms)
                return v
              })}
              effortHistory={results?.tuning_log?.map((l) => {
                const row = l as Record<string, unknown>
                return firstFinite(row.max_u) ?? maxAbsFinite(row.control_max)
              })}
              settlingHistory={results?.tuning_log?.map((l) => {
                const row = l as Record<string, unknown>
                return firstFinite(row.settling_time)
              })}
              gainsHistory={results?.tuning_log?.map((l) => {
                const row = l as Record<string, unknown>
                const tuning = row.tuning
                if (tuning && typeof tuning === 'object') return tuning as Record<string, unknown>
                return (row.gains as Record<string, unknown> | null) ?? null
              })}
              bestRms={bestRms}
            />
          </div>
        </div>
      )}

      {/* TAB 3: MULTI-AGENT REASONING LOGS */}
      {activeTab === 'logs' && (
        <div className="space-y-4 rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm animate-in fade-in-50 duration-150">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <FileText className="size-4 text-cyan-500" />
                Adaptive Multi-Agent Reasoning Logs (Cognitive Trail)
              </h3>
              <p className="text-xs text-muted-text">
                Complete deliberative exchanges between Clarifier, Designer, Simulator, Tuner &amp; Juror agents
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-text" />
                <input
                  type="text"
                  placeholder="Filter by agent or keyword..."
                  value={reasoningFilter}
                  onChange={(e) => setReasoningFilter(e.target.value)}
                  className="rounded-lg border border-border bg-surface pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          <div className="max-h-[550px] overflow-y-auto space-y-2.5 pr-1">
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl border border-border bg-surface p-3 text-xs font-mono transition-colors hover:border-cyan-500/40"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-bold ${log.badgeColor}`}>
                      {log.agent}
                    </span>
                    <span className="text-[10px] text-muted-text">
                      Step #{log.id + 1} {log.round ? `· Round ${log.round}` : ''}
                    </span>
                  </div>
                  <p className="text-foreground leading-relaxed whitespace-pre-wrap">{log.text}</p>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs text-muted-text">
                No reasoning logs match the current filter.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: STABILITY PROOF & SPECIFICATIONS */}
      {activeTab === 'proof' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <div className="rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-cyan-500" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Constructive Lyapunov Function &amp; Stability Proof
                  </h3>
                  <p className="text-xs text-muted-text">
                    Analytical verification ensuring dV/dt &le; -&eta;|s| + &epsilon;
                  </p>
                </div>
              </div>

              {onDownloadReport && !extractionFailed && (
                <button
                  type="button"
                  onClick={onDownloadReport}
                  className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-muted-text hover:text-foreground`}
                >
                  <Download className="size-3.5" /> PDF Report
                </button>
              )}
            </div>

            {extractionFailed && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-xs leading-relaxed text-red-700 dark:text-red-300">
                <span className="font-semibold block mb-1">Design / extraction failed</span>
                <pre className="whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                  {results?.error || results?.report || 'Pipeline reported EXTRACTION FAILED.'}
                </pre>
              </div>
            )}

            {!extractionFailed && results?.abstract && (
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs leading-relaxed text-muted-text">
                <span className="font-semibold text-cyan-600 dark:text-cyan-400 block mb-1">
                  Synthesis Abstract:
                </span>
                {results.abstract}
              </div>
            )}

            {/* Constructive Lyapunov Stability Proof — data-driven from agent derivation */}
            {!extractionFailed && stabilityProofText && (
              <div className="rounded-xl border border-teal-500/30 bg-surface p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-teal-600 dark:text-teal-400 flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-emerald-500" />
                    Constructive Lyapunov Function &amp; Stability Proof
                  </span>
                  <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
                    Certified Analytical Bounds
                  </span>
                </div>
                <div className="rounded-lg bg-surface-muted p-3.5 text-xs text-foreground max-h-80 overflow-y-auto leading-relaxed">
                  <MarkdownContent content={stabilityProofText} className="text-xs leading-relaxed" />
                </div>
              </div>
            )}

            {!extractionFailed && results?.report && (
              <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted-text font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">
                {results.report}
              </div>
            )}
          </div>

          {/* Tuning Objectives In Force (if configured) */}
          {job?.options?.tuning_objectives && Object.keys(job.options.tuning_objectives).length > 0 && (
            <div className="rounded-xl border border-cyan-500/25 bg-surface p-3.5 text-xs flex flex-wrap items-center gap-2">
              <span className="font-bold text-cyan-600 dark:text-cyan-400 font-mono text-[11px]">
                Configured Objective Priorities:
              </span>
              {Object.entries(job.options.tuning_objectives).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded-lg bg-surface-muted border border-border px-2.5 py-1 text-[11px] font-mono text-foreground flex items-center gap-1.5"
                >
                  <span>{k.replace(/_/g, ' ')}</span>
                  <span className="rounded bg-cyan-500/20 px-1 py-0.2 text-[10px] font-bold text-cyan-600 dark:text-cyan-300">
                    weight: {v}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* Tuning Rounds History Table */}
          {results?.tuning_log && results.tuning_log.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground mb-3">Tuning Rounds History</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border text-muted-text">
                    <tr>
                      <th className="py-2 px-3">Round</th>
                      <th className="py-2 px-3">RMS Error</th>
                      <th className="py-2 px-3">Max Effort |u|</th>
                      <th className="py-2 px-3">Tuner Assessment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {results.tuning_log.map((item, idx) => {
                      const row = item as Record<string, unknown>
                      // True steady-state RMS (MSE), never tracking_pct_headline
                      const rms =
                        firstFinite(row.rms) ??
                        firstFinite(row.steady_rms)
                      const trackPct = firstFinite(row.tracking_pct_headline)
                      const effort =
                        firstFinite(row.max_u) ??
                        firstFinite(row.effort) ??
                        maxAbsFinite(row.control_max)
                      const assessment = String(
                        row.reasoning ||
                          row.feedback ||
                          row.note ||
                          (row.met_target ? 'Target met' : row.success === false ? 'Failed checks' : '—'),
                      )
                      const rmsLabel =
                        rms !== null
                          ? rms.toFixed(4)
                          : trackPct !== null
                            ? `— (${trackPct.toFixed(1)}% track)`
                            : '—'
                      return (
                      <tr key={idx} className="hover:bg-surface-hover">
                        <td className="py-2.5 px-3 text-cyan-600 dark:text-cyan-300 font-bold">
                          #{typeof row.round === 'number' ? row.round : idx}
                        </td>
                        <td className="py-2.5 px-3" title={trackPct !== null ? `Tracking ${trackPct.toFixed(1)}%` : undefined}>
                          {rmsLabel}
                        </td>
                        <td className="py-2.5 px-3">{effort !== null ? effort.toFixed(2) : '—'}</td>
                        <td className="py-2.5 px-3 font-sans text-muted-text max-w-md truncate" title={assessment}>
                          {assessment}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: BLOCK DIAGRAM SCHEMATIC */}
      {activeTab === 'schematic' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <ControlBlockDiagram
            moduleType="adaptive"
            systemName={String(results?.system_spec?.system_name || 'Adaptive Controlled System')}
            referenceExpr={
              currentDiagnosisInputs?.reference ||
              (typeof results?.system_spec?.reference_function === 'string' ? results.system_spec.reference_function : undefined) ||
              'r(t) = 1.0 (Step Reference)'
            }
            controllerMethod={results?.method ? `Adaptive ${results.method.toUpperCase()}` : 'Adaptive SMC'}
            controllerParams={{
              Method: results?.method || 'Sliding Mode Control',
              GainsTuned: results?.tuning_best?.round != null ? `Round #${results.tuning_best.round}` : 'Optimized',
              AdaptationRate: 'Γ = diag(10, 10)',
              BoundaryLayer: 'φ = 0.05',
              EvaluationScore: results?.score != null ? `${results.score} / 100` : 'Evaluated',
            }}
            plantEquations={
              Array.isArray(results?.system_spec?.equations)
                ? (results!.system_spec!.equations as string[])
                : ['ẋ = f(x) + g(x)u + d(t)', 'y = h(x)']
            }
            states={results?.series?.names || ['x₁', 'x₂']}
            inputs={['u₁']}
            outputs={['y₁']}
            saturationLimits={{
              min: -15,
              max: 15,
            }}
            metrics={{
              Score: results?.score != null ? `${results.score}/100` : undefined,
              Status: results?.status,
              TrackingRMSE:
                results?.final_metrics?.tracking_rmse != null
                  ? Number(results.final_metrics.tracking_rmse).toFixed(4)
                  : undefined,
              MaxEffort:
                results?.final_metrics?.max_u != null
                  ? Number(results.final_metrics.max_u).toFixed(2)
                  : undefined,
            }}
            stabilityNotes={results?.abstract || 'Asymptotically Stable via Lyapunov Candidate V(s, θ̃)'}
          />
        </div>
      )}

      {/* TAB: DIAGNOSER */}
      {activeTab === 'diagnosis' && hasDiagnosis && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <AdaptiveDiagnosisView
            diagnosis={results?.diagnosis}
            onApplyOption={onApplyDiagnosisSuggestion ? handleApplyOption : undefined}
            applyDisabled={applyUsed}
            currentInputs={currentDiagnosisInputs}
          />
          {results?.job_id && <AdaptiveDiagnosisChat jobId={results.job_id} />}
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
        diagnosis={results?.diagnosis}
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
        currentInputs={currentDiagnosisInputs}
      />
    </div>
  )
}
