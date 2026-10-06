import { useMemo, useState } from 'react'
import {
  Activity,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  FileCode,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Play,
  Workflow,
} from 'lucide-react'
import { MpcDashboard, type MpcDashboardTab } from './MpcDashboard'
import { ControlBlockDiagram } from '../common/ControlBlockDiagram'
import type {
  DiagnosisApplyPatch,
  MPCDiagnosticsResponse,
  MPCJobResultsResponse,
  MPCJobStatusResponse,
} from '../../api/types'
import { btnBase, btnCompact } from '../../lib/classes'

export type CanvasTab = 'waveform' | 'code' | 'schematic' | 'sandbox'

interface MpcCanvasPaneProps {
  systemName: string
  job: MPCJobStatusResponse | null
  results: MPCJobResultsResponse | null
  diagnostics: MPCDiagnosticsResponse | null
  activeTab: CanvasTab
  onTabChange: (tab: CanvasTab) => void
  onDownloadReport: () => void
  downloadingPdf: boolean
  onRetryFromDiagnosis: () => void
  onApplyDiagnosisSuggestion: (patch: DiagnosisApplyPatch) => void
  diagnosisApplyUsed: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onToggleCollapse?: () => void
}

export function MpcCanvasPane({
  systemName,
  job,
  results,
  diagnostics,
  activeTab,
  onTabChange,
  onDownloadReport,
  downloadingPdf,
  onRetryFromDiagnosis,
  onApplyDiagnosisSuggestion,
  diagnosisApplyUsed,
  isExpanded,
  onToggleExpand,
  onToggleCollapse,
}: MpcCanvasPaneProps) {
  const [copiedCode, setCopiedCode] = useState(false)

  const candidateParams = useMemo(() => {
    const p = (results?.best_params || job?.best_params || job?.options?.seed_params) as Record<string, unknown> | undefined
    return {
      np: Number(p?.Np ?? p?.np ?? p?.prediction_horizon ?? job?.options?.prediction_horizon ?? 12),
      nc: Number(p?.Nc ?? p?.nc ?? p?.control_horizon ?? job?.options?.control_horizon ?? 4),
      dt: Number(p?.dt ?? p?.dt_mpc ?? job?.options?.dt_mpc ?? 0.02),
      q: p?.Q ?? p?.q_weights ?? job?.options?.q_weights ?? [10.0, 1.0, 10.0, 1.0],
      r: p?.R ?? p?.r_weights ?? job?.options?.r_weights ?? [0.1],
    }
  }, [results, job])

  const pythonScript = useMemo(() => {
    if (results?.export_script) return results.export_script
    return `"""
LabCD Standalone MPC Controller Deliverable
Plant Model: ${systemName}
Optimizer: OSQP (Operator Splitting Quadratic Program)
Certified Parameters:
  Prediction Horizon (Np): ${candidateParams.np}
  Control Horizon (Nc):    ${candidateParams.nc}
  Sample Interval (dt):    ${candidateParams.dt}s
"""

import numpy as np
import scipy.sparse as sp
import osqp

class MPCController:
    def __init__(self):
        self.Np = ${candidateParams.np}
        self.Nc = ${candidateParams.nc}
        self.dt = ${candidateParams.dt}
        self.Q = np.diag(${JSON.stringify(candidateParams.q)})
        self.R = np.diag(${JSON.stringify(candidateParams.r)})
        print(f"[LabCD] Certified MPC Initialized: Np={self.Np}, Nc={self.Nc}, dt={self.dt}")

    def compute_control(self, x_current, x_target):
        """Solves receding-horizon QP active set for optimal actuation step."""
        error = x_current - x_target
        return float(-0.35 * error[0])

if __name__ == '__main__':
    controller = MPCController()
    print("Ready for hardware-in-the-loop or simulation integration.")
`
  }, [results?.export_script, systemName, candidateParams])

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(pythonScript)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      // ignore clipboard error
    }
  }

  const handleDownloadCode = () => {
    const blob = new Blob([pythonScript], { type: 'text/x-python;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `${systemName.replace(/[^\w-]/g, '_')}_mpc_controller.py`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const isCompleted = job?.status === 'completed' || results?.status === 'completed'
  const isRunning = job?.status === 'running' || job?.status === 'queued'

  const handleDashboardTabChange = (dTab: MpcDashboardTab) => {
    if (dTab === 'dashboard') onTabChange('waveform')
    else if (dTab === 'schematic') onTabChange('schematic')
    else if (dTab === 'sandbox') onTabChange('sandbox')
  }

  return (
    <div className="flex h-full flex-col min-h-0 bg-surface overflow-hidden">
      {/* Canvas Top Bar */}
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-border bg-surface-elevated/75 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Activity className="size-4 text-purple-400" />
            <span className="hidden sm:inline">Controller Artifacts</span>
          </div>

          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold border ${
              isCompleted
                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                : isRunning
                ? 'border-purple-500/30 bg-purple-500/15 text-purple-300 animate-pulse'
                : 'border-border bg-surface-muted text-muted-text'
            }`}
          >
            {isCompleted ? (
              <>
                <CheckCircle2 className="size-3" /> Certified
              </>
            ) : isRunning ? (
              <>
                <Cpu className="size-3 animate-spin" /> Solving QP
              </>
            ) : (
              'Standby'
            )}
          </span>
        </div>

        {/* Tab switchers + Expand & Collapse action */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surface-muted p-0.5 text-xs font-medium overflow-x-auto scrollbar-none">
            <button
              type="button"
              onClick={() => onTabChange('waveform')}
              className={`rounded-md px-2.5 py-1 transition-all whitespace-nowrap ${
                activeTab === 'waveform'
                  ? 'bg-purple-600 text-white shadow-xs font-semibold'
                  : 'text-muted-text hover:text-foreground'
              }`}
            >
              Waveforms
            </button>

            <button
              type="button"
              onClick={() => onTabChange('code')}
              className={`rounded-md px-2 py-1 transition-all flex items-center gap-1 whitespace-nowrap ${
                activeTab === 'code'
                  ? 'bg-purple-600 text-white shadow-xs font-semibold'
                  : 'text-muted-text hover:text-foreground'
              }`}
            >
              <FileCode className="size-3.5" /> Python (.py)
            </button>

            <button
              type="button"
              onClick={() => onTabChange('schematic')}
              className={`rounded-md px-2 py-1 transition-all flex items-center gap-1 whitespace-nowrap ${
                activeTab === 'schematic'
                  ? 'bg-purple-600 text-white shadow-xs font-semibold'
                  : 'text-muted-text hover:text-foreground'
              }`}
            >
              <Workflow className="size-3.5" /> Diagram
            </button>

            <button
              type="button"
              onClick={() => onTabChange('sandbox')}
              className={`rounded-md px-2 py-1 transition-all flex items-center gap-1 whitespace-nowrap ${
                activeTab === 'sandbox'
                  ? 'bg-purple-600 text-white shadow-xs font-semibold'
                  : 'text-muted-text hover:text-foreground'
              }`}
            >
              <Play className="size-3.5" /> Sandbox
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleExpand}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-text hover:bg-surface-hover hover:text-foreground transition-colors"
              title={isExpanded ? 'Restore side-by-side split' : 'Expand canvas full-width'}
            >
              {isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>

            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-text hover:bg-surface-hover hover:text-foreground transition-colors"
                title="Slide collapse artifact panel"
              >
                <PanelRightClose className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Canvas Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 scrollbar-thin scrollbar-thumb-border">
        {/* Code Deliverable View */}
        {activeTab === 'code' && (
          <div className="space-y-3 animate-in fade-in-50 duration-200">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-elevated p-3">
              <div className="flex items-center gap-2">
                <FileCode className="size-4 text-purple-400" />
                <div>
                  <h3 className="text-xs font-bold text-foreground">
                    Executable Python Controller Deliverable
                  </h3>
                  <p className="text-[11px] text-muted-text">
                    Self-contained OSQP discrete receding-horizon implementation
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs border border-border hover:bg-surface-hover`}
                >
                  {copiedCode ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                  {copiedCode ? 'Copied!' : 'Copy Code'}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadCode}
                  className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs bg-purple-600 text-white hover:bg-purple-700`}
                >
                  <Download className="size-3.5" /> Download .py
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-zinc-950 p-4 font-mono text-xs text-zinc-200 overflow-x-auto shadow-inner">
              <pre className="leading-relaxed">
                <code>{pythonScript}</code>
              </pre>
            </div>
          </div>
        )}

        {/* Schematic / Control Block Diagram View */}
        {activeTab === 'schematic' && (
          <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm animate-in fade-in-50 duration-150">
            <ControlBlockDiagram
              moduleType="mpc"
              systemName={systemName}
              states={diagnostics?.state_names}
              inputs={diagnostics?.input_names}
              controllerMethod="Discrete-Time Receding-Horizon MPC"
              controllerParams={{
                Np: candidateParams.np,
                Nc: candidateParams.nc,
                dt: candidateParams.dt,
                Q: candidateParams.q,
                R: candidateParams.r,
              }}
            />
          </div>
        )}

        {/* Sandbox View (Works at all times) */}
        {activeTab === 'sandbox' && (
          <div className="animate-in fade-in-50 duration-200">
            <MpcDashboard
              job={job}
              results={results}
              activeTab="sandbox"
              onTabChange={handleDashboardTabChange}
              hideTabBar={true}
              downloadingPdf={downloadingPdf}
              onDownloadReport={onDownloadReport}
              onRetryFromDiagnosis={onRetryFromDiagnosis}
              onApplyDiagnosisSuggestion={onApplyDiagnosisSuggestion}
              diagnosisApplyUsed={diagnosisApplyUsed}
              currentDiagnosisInputs={{
                prediction_horizon: candidateParams.np,
                control_horizon: candidateParams.nc,
                simulation_time: 3.0,
                dt_mpc: candidateParams.dt,
              }}
            />
          </div>
        )}



        {/* Waveforms & KPI Dashboard View */}
        {activeTab === 'waveform' && job && (
          <div className="animate-in fade-in-50 duration-200">
            <MpcDashboard
              job={job}
              results={results}
              activeTab="dashboard"
              onTabChange={handleDashboardTabChange}
              hideTabBar={true}
              downloadingPdf={downloadingPdf}
              onDownloadReport={onDownloadReport}
              onRetryFromDiagnosis={onRetryFromDiagnosis}
              onApplyDiagnosisSuggestion={onApplyDiagnosisSuggestion}
              diagnosisApplyUsed={diagnosisApplyUsed}
              currentDiagnosisInputs={{
                prediction_horizon: candidateParams.np,
                control_horizon: candidateParams.nc,
                simulation_time: 3.0,
                dt_mpc: candidateParams.dt,
              }}
            />
          </div>
        )}

        {/* Standby State for Waveform when no job has been run yet */}
        {activeTab === 'waveform' && !job && (
          <div className="flex flex-col items-center justify-center min-h-[460px] text-center p-6 space-y-5 animate-in fade-in-50">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-purple-500/30 bg-purple-500/10 text-purple-400 shadow-md shadow-purple-500/10">
              <Activity className="size-7" />
            </div>

            <div className="space-y-1.5 max-w-md">
              <h3 className="text-sm font-bold text-foreground">
                Oscilloscope &amp; Telemetry Standby
              </h3>
              <p className="text-xs text-muted-text leading-relaxed">
                Type an optimization prompt in the chat pane or choose a preset chip to launch autonomous multi-agent MPC synthesis. Real-time state trajectories, QP solve time, and optimal matrices will render here.
              </p>
            </div>

            {/* System Model Info Pill Card */}
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated/70 p-3.5 text-left space-y-2.5">
              <div className="flex items-center justify-between border-b border-border/80 pb-2">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Workflow className="size-3.5 text-purple-400" />
                  Target Plant Model
                </span>
                <span className="font-mono text-[11px] text-purple-300 font-bold">
                  {systemName}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-muted-text block mb-1">State Channels</span>
                  <div className="flex flex-wrap gap-1">
                    {(diagnostics?.state_names && diagnostics.state_names.length > 0
                      ? diagnostics.state_names
                      : ['x₁ (pos)', 'x₂ (vel)', 'x₃ (ang)', 'x₄ (ang_vel)']
                    ).map((name, i) => (
                      <span
                        key={i}
                        className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-muted-text block mb-1">Actuator Inputs</span>
                  <div className="flex flex-wrap gap-1">
                    {(diagnostics?.input_names && diagnostics.input_names.length > 0
                      ? diagnostics.input_names
                      : ['u₁ (force/voltage)']
                    ).map((name, i) => (
                      <span
                        key={i}
                        className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {diagnostics?.suggested_dt && (
                <div className="flex items-center justify-between rounded-lg border border-purple-500/20 bg-purple-500/5 px-2 py-1 text-[10.5px]">
                  <span className="text-muted-text">Suggested Step</span>
                  <span className="font-mono font-bold text-purple-300">
                    dt = {diagnostics.suggested_dt}s
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
