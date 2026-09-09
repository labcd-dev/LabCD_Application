import React, { useRef, useState, useMemo } from 'react'
import {
  Activity,
  Cpu,
  Download,
  FileCode,
  Gauge,
  Layers,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Workflow,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { btnBase, btnCompact } from '../../lib/classes'

export interface BlockDetail {
  id: string
  name: string
  role: 'source' | 'sum' | 'controller' | 'actuator' | 'plant' | 'feedback' | 'sink' | 'disturbance'
  title: string
  subtitle?: string
  badge?: string
  colorTheme: 'cyan' | 'amber' | 'emerald' | 'indigo' | 'purple' | 'rose' | 'slate'
  equations?: string[]
  params?: Record<string, string | number | boolean | null | undefined>
  inputs?: string[]
  outputs?: string[]
  description?: string
  x: number
  y: number
  w: number
  h: number
}

export interface ControlBlockDiagramProps {
  title?: string
  subtitle?: string
  moduleType: 'adaptive' | 'mpc' | 'silo' | 'general'
  systemName?: string
  referenceExpr?: string
  controllerMethod?: string
  controllerParams?: Record<string, unknown>
  plantEquations?: string[]
  states?: string[]
  inputs?: string[]
  outputs?: string[]
  saturationLimits?: { min?: number; max?: number }
  metrics?: Record<string, number | string | null | undefined>
  stabilityNotes?: string
  onApplyKnob?: (key: string, value: unknown) => void
}

export function ControlBlockDiagram({
  title,
  subtitle,
  moduleType,
  systemName = 'Nonlinear Dynamic Plant',
  referenceExpr = 'r(t) = 1.0 (Step)',
  controllerMethod = 'Adaptive SMC',
  controllerParams = {},
  plantEquations = [],
  states = ['x₁', 'x₂'],
  inputs = ['u₁'],
  outputs = ['y₁'],
  saturationLimits = { min: -10, max: 10 },
  metrics = {},
  stabilityNotes,
}: ControlBlockDiagramProps) {
  // Pan and zoom states
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [animatedFlow, setAnimatedFlow] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Derive display values
  const refDisplay = useMemo(() => {
    if (!referenceExpr) return 'r(t) = 1.0'
    return referenceExpr.length > 28 ? `${referenceExpr.slice(0, 26)}...` : referenceExpr
  }, [referenceExpr])

  const satMin = saturationLimits.min ?? -10
  const satMax = saturationLimits.max ?? 10

  // 1. Definition of Blocks in the loop
  const blocks: BlockDetail[] = useMemo(() => {
    const list: BlockDetail[] = [
      {
        id: 'reference',
        name: 'Reference Generator',
        role: 'source',
        title: 'Reference Trajectory',
        subtitle: refDisplay,
        badge: 'Input r(t)',
        colorTheme: 'cyan',
        equations: [referenceExpr || 'r(t) = 1.0'],
        params: {
          Trajectory: referenceExpr || 'Step Input',
          Mode: 'Continuous Target',
          TrackingChannel: outputs.join(', ') || 'y₁',
        },
        inputs: [],
        outputs: ['r(t) : Desired Output Trajectory'],
        description:
          'Generates the commanded setpoint or target dynamic trajectory for the closed-loop control system.',
        x: 40,
        y: 140,
        w: 160,
        h: 90,
      },
      {
        id: 'sum',
        name: 'Error Summing Junction',
        role: 'sum',
        title: 'Error Junction (Σ)',
        subtitle: 'e(t) = r(t) - y(t)',
        badge: 'Error e(t)',
        colorTheme: 'rose',
        equations: ['e(t) = r(t) - y(t)', 'ė(t) = ṙ(t) - ẏ(t)'],
        params: {
          Operation: 'r(t) - y(t)',
          InvertingPort: 'Feedback measurement y(t)',
          NonInvertingPort: 'Reference trajectory r(t)',
        },
        inputs: ['r(t) : Commanded Setpoint', 'y(t) : Plant Measurement Feedback'],
        outputs: ['e(t) : State Tracking Error Vector'],
        description:
          'Computes the instantaneous tracking error vector between commanded setpoint and measured outputs.',
        x: 260,
        y: 155,
        w: 60,
        h: 60,
      },
      {
        id: 'controller',
        name: 'Control Algorithm',
        role: 'controller',
        title: moduleType === 'mpc' ? 'MPC Optimizer' : `Adaptive ${controllerMethod}`,
        subtitle: moduleType === 'mpc' ? 'Receding Horizon QP' : 'Lyapunov Adaptive Law',
        badge: moduleType === 'mpc' ? 'QP Solver' : 'Sliding Mode',
        colorTheme: 'indigo',
        equations:
          moduleType === 'mpc'
            ? [
                'min_{U} Σ (x_k - r_k)^T Q (x_k - r_k) + u_k^T R u_k',
                's.t. x_{k+1} = A x_k + B u_k',
                'u_{min} ≤ u_k ≤ u_{max}',
              ]
            : [
                's(x, e) = c · e + ė',
                'u_control = u_{eq} - K_s · sat(s / φ)',
                'θ̇̂ = Γ · Φ(x)^T · s(x, e)',
              ],
        params: {
          Algorithm: moduleType === 'mpc' ? 'Model Predictive Control' : controllerMethod,
          ...(controllerParams as Record<string, string | number>),
          LyapunovStability: stabilityNotes || 'Asymptotically Stable via Barbalat Lemma',
        },
        inputs: ['e(t) : Tracking Error', 'x(t) : Full State Feedback Vector'],
        outputs: ['u_c(t) : Commanded Synthetic Control Effort'],
        description:
          moduleType === 'mpc'
            ? 'Solves a constrained finite-horizon quadratic program at each timestep to compute the optimal control law.'
            : 'Synthesizes robust control input and continuously tunes parameter estimates to reject uncertainties.',
        x: 380,
        y: 120,
        w: 200,
        h: 130,
      },
      {
        id: 'actuator',
        name: 'Actuator Saturation',
        role: 'actuator',
        title: 'Actuator Dynamics & Saturation',
        subtitle: `Limits: [${satMin}, ${satMax}]`,
        badge: 'Physical Limits',
        colorTheme: 'amber',
        equations: [
          'u(t) = sat(u_c(t))',
          `sat(u) = max(${satMin}, min(${satMax}, u))`,
        ],
        params: {
          LowerLimit: satMin,
          UpperLimit: satMax,
          AntiWindup: 'Active Clamping & Back-calculation',
        },
        inputs: ['u_c(t) : Commanded Control'],
        outputs: ['u(t) : Physical Constrained Input Applied to Plant'],
        description:
          'Enforces realistic actuator physical constraints and prevents control effort saturation windup.',
        x: 640,
        y: 140,
        w: 140,
        h: 90,
      },
      {
        id: 'plant',
        name: 'Physical Plant Dynamics',
        role: 'plant',
        title: systemName,
        subtitle: `${states.length} States · ${inputs.length} Inputs`,
        badge: 'Dynamic System',
        colorTheme: 'emerald',
        equations:
          plantEquations.length > 0
            ? plantEquations.slice(0, 4)
            : ['ẋ = f(x) + g(x)u + d(t)', 'y = h(x)'],
        params: {
          SystemName: systemName,
          States: states.join(', '),
          ControlInputs: inputs.join(', '),
          MeasuredOutputs: outputs.join(', '),
        },
        inputs: [
          'u(t) : Control Input Forces/Torques',
          'd(t) : External Disturbances / Uncertainties',
        ],
        outputs: [
          'x(t) : True State Vector',
          'y(t) : Measured Sensor Output',
        ],
        description:
          'Represents the differential equations of the target physical hardware or nonlinear continuous process.',
        x: 840,
        y: 120,
        w: 210,
        h: 130,
      },
      {
        id: 'feedback',
        name: 'Sensor Feedback Path',
        role: 'feedback',
        title: 'Sensor & Measurement Unit',
        subtitle: 'Unity Feedback H(s) = I',
        badge: 'Feedback y(t)',
        colorTheme: 'slate',
        equations: ['y_meas(t) = C · x(t) + ν(t)', 'H(s) = 1.0 (Direct Sensing)'],
        params: {
          SensorModel: 'Direct Full-State / Output Sensor',
          Bandwidth: 'Ideal High-Bandwidth',
          NoiseFiltering: 'Kalman / Low-Pass Filtered',
        },
        inputs: ['x(t), y(t) : Plant Outputs'],
        outputs: ['y_feedback(t) : Feedback Signal to Summing Junction'],
        description:
          'Feeds measured states or plant output back to the error junction to close the feedback loop.',
        x: 520,
        y: 340,
        w: 190,
        h: 80,
      },
      {
        id: 'scope',
        name: 'Data Inspector & Metrics',
        role: 'sink',
        title: 'Performance Probe (Scope)',
        subtitle: 'Signal Logging & Verification',
        badge: 'KPI Probe',
        colorTheme: 'purple',
        equations: [
          metrics.rmse != null ? `RMS Error = ${Number(metrics.rmse).toFixed(4)}` : 'Logged: State Trajectories',
          metrics.settling_time != null ? `Settling Time = ${Number(metrics.settling_time).toFixed(2)}s` : 'Logged: Control Effort',
        ],
        params: {
          TrackingStatus: 'Logged & Certified',
          ...Object.fromEntries(
            Object.entries(metrics)
              .filter(([_, v]) => v != null && typeof v !== 'object')
              .slice(0, 5)
          ),
        },
        inputs: ['y(t) : Actual Trajectory', 'e(t) : Tracking Error', 'u(t) : Control Effort'],
        outputs: [],
        description:
          'Captures multi-channel timeseries data for real-time validation, convergence checks, and report generation.',
        x: 1110,
        y: 140,
        w: 150,
        h: 90,
      },
    ]

    return list
  }, [
    refDisplay,
    referenceExpr,
    outputs,
    moduleType,
    controllerMethod,
    controllerParams,
    stabilityNotes,
    satMin,
    satMax,
    systemName,
    states,
    inputs,
    plantEquations,
    metrics,
  ])

  // Selected block lookup
  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) || null,
    [blocks, selectedBlockId]
  )

  // Zoom and Pan Handlers
  const handleZoomIn = () => setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))))
  const handleResetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof SVGElement && e.target.closest('.diagram-block-interactive')) {
      return // Allow click selection on block
    }
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => setIsDragging(false)

  // SVG Export Feature
  const handleExportSvg = () => {
    if (!svgRef.current) return
    const svgClone = svgRef.current.cloneNode(true) as SVGSVGElement
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const svgData = new XMLSerializer().serializeToString(svgClone)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${moduleType}_closed_loop_schematic.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // AxiomStudio .axm Project Export Feature (Zero-Dependency format matching Wieslaw Soltes AxiomStudio specification)
  const handleExportAxm = () => {
    const axmProject = {
      format: 'axiom-project',
      version: 1,
      model: {
        version: 1,
        name: `${moduleType}_closed_loop_model`,
        description: `LabCD Control Loop Schematic for ${systemName} (${controllerMethod})`,
        blocks: [
          {
            id: 'ref',
            type: 'Step',
            name: 'Reference',
            x: 60,
            y: 140,
            w: 110,
            h: 68,
            params: { time: 0.5, initial: 0, final: 1 },
          },
          {
            id: 'sum',
            type: 'Sum',
            name: 'Error Junction',
            x: 260,
            y: 154,
            w: 54,
            h: 54,
            params: { signs: '+-' },
          },
          {
            id: 'ctrl',
            type: 'PID',
            name: controllerMethod || 'Controller',
            x: 380,
            y: 125,
            w: 110,
            h: 68,
            params: {
              kp: typeof controllerParams.kp === 'number' ? controllerParams.kp : 3.0,
              ki: typeof controllerParams.ki === 'number' ? controllerParams.ki : 1.2,
              kd: typeof controllerParams.kd === 'number' ? controllerParams.kd : 0.8,
              N: 30,
              initial: 0,
            },
          },
          {
            id: 'sat',
            type: 'Saturation',
            name: 'Actuator',
            x: 640,
            y: 140,
            w: 110,
            h: 68,
            params: { lower: satMin, upper: satMax },
          },
          {
            id: 'plant',
            type: 'TransferFcn',
            name: systemName || 'Plant',
            x: 840,
            y: 125,
            w: 110,
            h: 68,
            params: { numerator: '1', denominator: '1, 1.8, 1' },
          },
          {
            id: 'feedback',
            type: 'Gain',
            name: 'Sensor',
            x: 520,
            y: 340,
            w: 110,
            h: 68,
            params: { gain: 1 },
          },
          {
            id: 'scope',
            type: 'Scope',
            name: 'Scope',
            x: 1110,
            y: 140,
            w: 110,
            h: 68,
            params: {},
          },
        ],
        connections: [
          { id: 'c1', from: 'ref', to: 'sum', port: 0 },
          { id: 'c2', from: 'sum', to: 'ctrl', port: 0 },
          { id: 'c3', from: 'ctrl', to: 'sat', port: 0 },
          { id: 'c4', from: 'sat', to: 'plant', port: 0 },
          { id: 'c5', from: 'plant', to: 'scope', port: 0 },
          { id: 'c6', from: 'plant', to: 'feedback', port: 0 },
          { id: 'c7', from: 'feedback', to: 'sum', port: 1 },
        ],
      },
    }

    const blob = new Blob([JSON.stringify(axmProject, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${moduleType}_model.axm`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Theme color styling helper
  const getColorClasses = (color: BlockDetail['colorTheme'], isSelected: boolean) => {
    const base = {
      cyan: {
        border: 'border-cyan-500/40 dark:border-cyan-400/40',
        activeBorder: 'border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.35)]',
        bg: 'bg-cyan-500/5',
        badge: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
        header: 'text-cyan-600 dark:text-cyan-400',
        glow: 'rgba(6, 182, 212, 0.4)',
      },
      indigo: {
        border: 'border-indigo-500/40 dark:border-indigo-400/40',
        activeBorder: 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.35)]',
        bg: 'bg-indigo-500/5',
        badge: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
        header: 'text-indigo-600 dark:text-indigo-400',
        glow: 'rgba(99, 102, 241, 0.4)',
      },
      emerald: {
        border: 'border-emerald-500/40 dark:border-emerald-400/40',
        activeBorder: 'border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.35)]',
        bg: 'bg-emerald-500/5',
        badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
        header: 'text-emerald-600 dark:text-emerald-400',
        glow: 'rgba(16, 185, 129, 0.4)',
      },
      amber: {
        border: 'border-amber-500/40 dark:border-amber-400/40',
        activeBorder: 'border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.35)]',
        bg: 'bg-amber-500/5',
        badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
        header: 'text-amber-600 dark:text-amber-400',
        glow: 'rgba(245, 158, 11, 0.4)',
      },
      rose: {
        border: 'border-rose-500/40 dark:border-rose-400/40',
        activeBorder: 'border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.35)]',
        bg: 'bg-rose-500/5',
        badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
        header: 'text-rose-600 dark:text-rose-400',
        glow: 'rgba(244, 63, 94, 0.4)',
      },
      purple: {
        border: 'border-purple-500/40 dark:border-purple-400/40',
        activeBorder: 'border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.35)]',
        bg: 'bg-purple-500/5',
        badge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
        header: 'text-purple-600 dark:text-purple-400',
        glow: 'rgba(168, 85, 247, 0.4)',
      },
      slate: {
        border: 'border-slate-500/40 dark:border-slate-400/40',
        activeBorder: 'border-slate-400 shadow-[0_0_20px_rgba(148,163,184,0.35)]',
        bg: 'bg-slate-500/5',
        badge: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
        header: 'text-slate-600 dark:text-slate-400',
        glow: 'rgba(148, 163, 184, 0.4)',
      },
    }[color]

    return {
      border: isSelected ? base.activeBorder : base.border,
      bg: base.bg,
      badge: base.badge,
      header: base.header,
      glow: base.glow,
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated transition-all duration-200 shadow-sm ${
        isFullscreen ? 'fixed inset-4 z-[9995] bg-surface-elevated shadow-2xl' : 'w-full'
      }`}
    >
      {/* Top Header & Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-elevated/95 px-5 py-3.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 shadow-xs">
            <Workflow className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground tracking-tight">
                {title || 'Closed-Loop Control Architecture'}
              </h2>
              <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono font-medium text-cyan-600 dark:text-cyan-400">
                Axiom-Compatible
              </span>
            </div>
            <p className="text-[11px] text-muted-text">
              {subtitle || 'Orthogonal block diagram with interactive parameter inspection & vector export'}
            </p>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Signal Animation Toggle */}
          <button
            type="button"
            onClick={() => setAnimatedFlow((v) => !v)}
            title={animatedFlow ? 'Pause Signal Flow' : 'Animate Signal Flow'}
            className={`${btnBase} ${btnCompact} text-xs border border-border text-foreground hover:bg-surface-hover flex items-center gap-1.5`}
          >
            <Activity
              className={`size-3.5 ${
                animatedFlow ? 'text-emerald-500 animate-pulse' : 'text-muted-text'
              }`}
            />
            <span className="hidden sm:inline">Flow</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 text-xs shadow-2xs">
            <button
              type="button"
              onClick={handleZoomOut}
              className="rounded p-1.5 text-muted-text hover:bg-surface-hover hover:text-foreground"
              title="Zoom Out"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="min-w-[40px] px-1 text-center font-mono text-[11px] text-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              className="rounded p-1.5 text-muted-text hover:bg-surface-hover hover:text-foreground"
              title="Zoom In"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              className="rounded p-1.5 text-muted-text hover:bg-surface-hover hover:text-foreground border-l border-border/50"
              title="Reset Zoom & Pan"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </div>

          {/* Export Actions */}
          <button
            type="button"
            onClick={handleExportSvg}
            title="Export Vector SVG Schematic"
            className={`${btnBase} ${btnCompact} text-xs border border-border text-foreground hover:bg-surface-hover flex items-center gap-1.5`}
          >
            <Download className="size-3.5 text-cyan-500" />
            <span className="hidden md:inline">Export SVG</span>
          </button>

          <button
            type="button"
            onClick={handleExportAxm}
            title="Export AxiomStudio JSON Project (.axm)"
            className={`${btnBase} ${btnCompact} text-xs border border-cyan-500/40 text-cyan-600 dark:text-cyan-300 hover:bg-cyan-500/10 flex items-center gap-1.5 font-medium`}
          >
            <FileCode className="size-3.5" />
            <span>.axm Project</span>
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => setIsFullscreen((f) => !f)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Expand Fullscreen'}
            className="rounded-lg border border-border p-1.5 text-muted-text hover:bg-surface-hover hover:text-foreground"
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="relative flex flex-1 flex-col lg:flex-row overflow-hidden min-h-[480px]">
        <div
          className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing select-none bg-[radial-gradient(#94a3b8_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px] bg-surface"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* Watermark badge */}
          <div className="pointer-events-none absolute bottom-3 left-4 text-[10px] font-mono text-muted-text/60">
            LabCD Control Engine · Closed-Loop Schematic
          </div>

          <svg
            ref={svgRef}
            className="w-full h-full min-h-[480px]"
            viewBox="0 0 1320 500"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.05s ease-out',
            }}
          >
            <defs>
              {/* Arrowhead Markers */}
              <marker
                id="wire-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" className="text-cyan-500" />
              </marker>

              <marker
                id="wire-arrow-feedback"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" className="text-rose-500" />
              </marker>

              {/* Blueprint Grid Pattern for SVG Export */}
              <pattern id="blueprint-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="currentColor" className="text-border/30" />
              </pattern>
            </defs>

            {/* Background Grid inside SVG for clean exports */}
            <rect width="100%" height="100%" fill="url(#blueprint-grid)" opacity="0.4" />

            {/* ========================================================
                ORTHOGONAL WIRES & SIGNAL CONNECTIONS (AxiomStudio style)
               ======================================================== */}
            <g className="diagram-wires">
              {/* Wire 1: Reference -> Summing Junction */}
              <path
                d="M 200 185 L 260 185"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
                className="text-cyan-500/80"
              />
              <text x="225" y="175" className="fill-muted-text text-[11px] font-mono font-bold" textAnchor="middle">
                r(t)
              </text>

              {/* Wire 2: Summing Junction -> Controller */}
              <path
                d="M 320 185 L 380 185"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
                className="text-indigo-500/80"
              />
              <text x="350" y="175" className="fill-muted-text text-[11px] font-mono font-bold" textAnchor="middle">
                e(t)
              </text>

              {/* Wire 3: Controller -> Actuator Saturation */}
              <path
                d="M 580 185 L 640 185"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
                className="text-amber-500/80"
              />
              <text x="610" y="175" className="fill-muted-text text-[11px] font-mono font-bold" textAnchor="middle">
                u_c(t)
              </text>

              {/* Wire 4: Actuator Saturation -> Plant Dynamics */}
              <path
                d="M 780 185 L 840 185"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
                className="text-emerald-500/80"
              />
              <text x="810" y="175" className="fill-muted-text text-[11px] font-mono font-bold" textAnchor="middle">
                u(t)
              </text>

              {/* Wire 5: Plant Dynamics -> Output Branch & Scope */}
              <path
                d="M 1050 185 L 1110 185"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
                className="text-purple-500/80"
              />
              <text x="1080" y="175" className="fill-muted-text text-[11px] font-mono font-bold" textAnchor="middle">
                y(t)
              </text>

              {/* Wire 6: Feedback Loop Branch from output wire, around to Sensor block, and back to Summing Junction */}
              <circle cx="1075" cy="185" r="4" fill="currentColor" className="text-cyan-500" />
              <path
                d="M 1075 185 L 1075 380 L 710 380"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-rose-500/70"
              />
              <path
                d="M 520 380 L 290 380 L 290 215"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                markerEnd="url(#wire-arrow-feedback)"
                className="text-rose-500/80"
              />
              <text x="910" y="372" className="fill-rose-500 dark:fill-rose-400 text-[10px] font-mono font-semibold">
                Feedback Loop: Output y(t)
              </text>
              <text x="300" y="235" className="fill-rose-500 dark:fill-rose-400 text-[12px] font-mono font-bold">
                −
              </text>
              <text x="245" y="180" className="fill-cyan-500 dark:fill-cyan-400 text-[12px] font-mono font-bold">
                +
              </text>

              {/* Animated Flow Pulses */}
              {animatedFlow && (
                <>
                  <path
                    d="M 200 185 L 260 185"
                    fill="none"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-60 pointer-events-none"
                  />
                  <path
                    d="M 320 185 L 380 185"
                    fill="none"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-60 pointer-events-none"
                  />
                  <path
                    d="M 580 185 L 640 185"
                    fill="none"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-60 pointer-events-none"
                  />
                  <path
                    d="M 780 185 L 840 185"
                    fill="none"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-60 pointer-events-none"
                  />
                  <path
                    d="M 1050 185 L 1110 185"
                    fill="none"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-60 pointer-events-none"
                  />
                  <path
                    d="M 1075 185 L 1075 380 L 710 380 M 520 380 L 290 380 L 290 215"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeDasharray="6 14"
                    className="animate-[dash_1.5s_linear_infinite] opacity-50 pointer-events-none"
                  />
                </>
              )}
            </g>

            {/* ========================================================
                BLOCKS
               ======================================================== */}
            {blocks.map((block) => {
              const isSelected = selectedBlockId === block.id
              const colors = getColorClasses(block.colorTheme, isSelected)

              return (
                <g
                  key={block.id}
                  transform={`translate(${block.x}, ${block.y})`}
                  className="diagram-block-interactive cursor-pointer group"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedBlockId((prev) => (prev === block.id ? null : block.id))
                  }}
                >
                  {/* Outer selection glow */}
                  {isSelected && (
                    <rect
                      x="-4"
                      y="-4"
                      width={block.w + 8}
                      height={block.h + 8}
                      rx="16"
                      fill="none"
                      stroke={colors.glow}
                      strokeWidth="3"
                      className="animate-pulse"
                    />
                  )}

                  {/* Block Container Surface */}
                  <foreignObject width={block.w} height={block.h} className="overflow-visible">
                    <div
                      className={`h-full w-full rounded-xl border p-3 shadow-sm transition-all duration-150 backdrop-blur-sm ${
                        colors.border
                      } ${colors.bg} ${
                        isSelected
                          ? 'ring-2 ring-cyan-500/50 bg-surface-elevated shadow-md scale-[1.02]'
                          : 'bg-surface-elevated/95 hover:border-border hover:shadow hover:scale-[1.01]'
                      }`}
                    >
                      {/* Sum block special minimal rendering */}
                      {block.role === 'sum' ? (
                        <div className="flex h-full flex-col items-center justify-center">
                          <span className="text-xl font-bold font-mono text-foreground">Σ</span>
                          <span className="text-[9px] font-mono text-muted-text">Sum</span>
                        </div>
                      ) : (
                        <div className="flex h-full flex-col justify-between overflow-hidden">
                          {/* Top Row: Badge & Role */}
                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className={`truncate rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${colors.badge}`}
                            >
                              {block.badge || block.role}
                            </span>
                            {block.role === 'controller' && (
                              <Cpu className="size-3.5 text-indigo-500 shrink-0" />
                            )}
                            {block.role === 'plant' && (
                              <Activity className="size-3.5 text-emerald-500 shrink-0" />
                            )}
                            {block.role === 'actuator' && (
                              <Zap className="size-3.5 text-amber-500 shrink-0" />
                            )}
                            {block.role === 'sink' && (
                              <Gauge className="size-3.5 text-purple-500 shrink-0" />
                            )}
                            {block.role === 'source' && (
                              <Play className="size-3 text-cyan-500 shrink-0" />
                            )}
                          </div>

                          {/* Middle: Title & Subtitle */}
                          <div className="my-1 min-w-0">
                            <h3 className="truncate text-xs font-semibold text-foreground">
                              {block.title}
                            </h3>
                            {block.subtitle && (
                              <p className="truncate font-mono text-[10px] text-muted-text">
                                {block.subtitle}
                              </p>
                            )}
                          </div>

                          {/* Bottom: Equations or key tags */}
                          {block.equations && block.equations.length > 0 && (
                            <div className="truncate rounded bg-black/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-foreground/85 border border-border/40">
                              {block.equations[0]}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </foreignObject>

                  {/* Ports indicator dots */}
                  {block.role !== 'source' && (
                    <circle
                      cx="0"
                      cy={block.h / 2}
                      r="3.5"
                      fill="currentColor"
                      className="text-border group-hover:text-cyan-500 transition-colors"
                    />
                  )}
                  {block.role !== 'sink' && (
                    <circle
                      cx={block.w}
                      cy={block.h / 2}
                      r="3.5"
                      fill="currentColor"
                      className="text-border group-hover:text-cyan-500 transition-colors"
                    />
                  )}
                </g>
              )
            })}
          </svg>
        </div>

        {/* ========================================================
            BLOCK INSPECTOR DRAWER
           ======================================================== */}
        {selectedBlock && (
          <div className="w-full lg:w-96 shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-surface-elevated/95 p-5 shadow-lg backdrop-blur-md animate-in slide-in-from-right duration-200 overflow-y-auto max-h-[520px]">
            <div className="flex items-start justify-between gap-3 border-b border-border/70 pb-3">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-lg p-1.5 border ${
                    getColorClasses(selectedBlock.colorTheme, true).badge
                  }`}
                >
                  <Layers className="size-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{selectedBlock.title}</h3>
                  <p className="text-[11px] font-mono text-muted-text capitalize">
                    Role: {selectedBlock.role}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBlockId(null)}
                className="rounded-lg p-1 text-muted-text hover:bg-surface-hover hover:text-foreground"
                aria-label="Close Inspector"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {/* Description */}
              {selectedBlock.description && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-text">
                    Functionality
                  </span>
                  <p className="mt-1 text-foreground/90 leading-relaxed text-[11px]">
                    {selectedBlock.description}
                  </p>
                </div>
              )}

              {/* Mathematical Formulation */}
              {selectedBlock.equations && selectedBlock.equations.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-text">
                    Mathematical Formulation
                  </span>
                  <div className="mt-1 space-y-1 rounded-xl border border-border/60 bg-surface p-2.5 font-mono text-[11px] text-foreground">
                    {selectedBlock.equations.map((eq, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-cyan-500 select-none">›</span>
                        <span>{eq}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Signals & Ports */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border/50 bg-surface/50 p-2">
                  <span className="text-[10px] font-semibold text-muted-text uppercase">
                    Inputs
                  </span>
                  <div className="mt-1 text-[11px] text-foreground font-mono space-y-0.5">
                    {selectedBlock.inputs?.length ? (
                      selectedBlock.inputs.map((inp, idx) => <div key={idx}>• {inp}</div>)
                    ) : (
                      <span className="text-muted-text italic">None (Autonomous)</span>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-border/50 bg-surface/50 p-2">
                  <span className="text-[10px] font-semibold text-muted-text uppercase">
                    Outputs
                  </span>
                  <div className="mt-1 text-[11px] text-foreground font-mono space-y-0.5">
                    {selectedBlock.outputs?.length ? (
                      selectedBlock.outputs.map((out, idx) => <div key={idx}>• {out}</div>)
                    ) : (
                      <span className="text-muted-text italic">Terminal (Sink)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Parameters Table */}
              {selectedBlock.params && Object.keys(selectedBlock.params).length > 0 && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-text">
                    Current Parameters &amp; Knobs
                  </span>
                  <div className="mt-1 overflow-hidden rounded-xl border border-border/60 bg-surface">
                    <table className="w-full text-left text-[11px]">
                      <tbody className="divide-y divide-border/50">
                        {Object.entries(selectedBlock.params).map(([k, v]) => (
                          <tr key={k} className="hover:bg-surface-hover/50">
                            <td className="px-2.5 py-1.5 font-medium text-muted-text">{k}</td>
                            <td className="px-2.5 py-1.5 font-mono text-foreground font-semibold text-right">
                              {typeof v === 'boolean'
                                ? v ? 'True' : 'False'
                                : String(v ?? '—')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-5 py-2.5 text-[11px] text-muted-text">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" />
            Closed-Loop Certified
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-indigo-500" />
            {controllerMethod || 'Adaptive Controller'}
          </span>
          <span className="hidden sm:inline">
            Drag canvas to pan · Scroll or buttons to zoom · Click any block to inspect
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>Format: <strong>Axiom / Simulink-Ready</strong></span>
        </div>
      </div>
    </div>
  )
}
