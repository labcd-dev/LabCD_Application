import React, { useRef, useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  Download,
  FileCode,
  Layers,
  Maximize2,
  Minimize2,
  RotateCcw,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { btnBase, btnCompact } from '../../lib/classes'

export interface BlockDetail {
  id: string
  name: string
  role: 'source' | 'sum' | 'controller' | 'actuator' | 'plant' | 'feedback' | 'sink'
  title: string
  subtitle?: string
  badge: string
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
  // Theme state detection
  const [isDark, setIsDark] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark')
    }
    return true
  })

  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

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

  // Clean Reference expression display
  const refDisplay = useMemo(() => {
    if (!referenceExpr) return 'r(t) = 1.0'
    return referenceExpr
  }, [referenceExpr])

  const satMin = saturationLimits.min ?? -10
  const satMax = saturationLimits.max ?? 10

  // 1. Definition of Blocks with ample, generous spacing (No clipping, No truncation)
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
        x: 50,
        y: 138,
        w: 190,
        h: 104,
      },
      {
        id: 'sum',
        name: 'Error Summing Junction',
        role: 'sum',
        title: 'Error Junction (Σ)',
        subtitle: 'e(t) = r(t) - y(t)',
        badge: 'Sum',
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
        x: 310,
        y: 163,
        w: 54,
        h: 54,
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
        x: 434,
        y: 125,
        w: 240,
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
        x: 744,
        y: 138,
        w: 210,
        h: 104,
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
        x: 1024,
        y: 125,
        w: 260,
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
        x: 730,
        y: 350,
        w: 240,
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
        x: 1354,
        y: 138,
        w: 200,
        h: 104,
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
      return
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

  // Fullscreen Management with Viewport Portal + Root Native Fullscreen
  const toggleFullscreen = () => {
    if (!isFullscreen) {
      setIsFullscreen(true)
      // Attempt native fullscreen on document.documentElement (never on portaled child to prevent detachment cancellation!)
      if (typeof document !== 'undefined') {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {
            // Viewport portal fallback still ensures 100% full screen if native is blocked
          })
        }
      }
    } else {
      setIsFullscreen(false)
      if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {})
      }
    }
  }

  // Synchronize when user exits native browser fullscreen via Escape or F11
  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [isFullscreen])

  // Clean keyboard Escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
        if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {})
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen])

  // Prevent background body scrolling while in Fullscreen
  useEffect(() => {
    if (isFullscreen && typeof document !== 'undefined') {
      const prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prevOverflow
      }
    }
  }, [isFullscreen])

  // Pure Vector SVG Export (Self-Contained with Full CSS & Shapes embedded)
  const handleExportSvg = () => {
    if (!svgRef.current) return
    const svgNode = svgRef.current.cloneNode(true) as SVGSVGElement
    svgNode.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svgNode.setAttribute('width', '1580')
    svgNode.setAttribute('height', '520')
    svgNode.setAttribute('viewBox', '0 0 1580 520')

    // Clean transforms on export root
    svgNode.removeAttribute('style')

    // Add solid theme background in the exported file so it renders properly in any viewer
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('width', '100%')
    bgRect.setAttribute('height', '100%')
    bgRect.setAttribute('fill', isDark ? '#0b0f19' : '#f8fafc')
    svgNode.insertBefore(bgRect, svgNode.firstChild)

    const svgData = new XMLSerializer().serializeToString(svgNode)
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
            x: 50,
            y: 138,
            w: 190,
            h: 104,
            params: { time: 0.5, initial: 0, final: 1 },
          },
          {
            id: 'sum',
            type: 'Sum',
            name: 'Error Junction',
            x: 310,
            y: 163,
            w: 54,
            h: 54,
            params: { signs: '+-' },
          },
          {
            id: 'ctrl',
            type: 'PID',
            name: controllerMethod || 'Controller',
            x: 434,
            y: 125,
            w: 240,
            h: 130,
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
            x: 744,
            y: 138,
            w: 210,
            h: 104,
            params: { lower: satMin, upper: satMax },
          },
          {
            id: 'plant',
            type: 'TransferFcn',
            name: systemName || 'Plant',
            x: 1024,
            y: 125,
            w: 260,
            h: 130,
            params: { numerator: '1', denominator: '1, 1.8, 1' },
          },
          {
            id: 'feedback',
            type: 'Gain',
            name: 'Sensor',
            x: 730,
            y: 350,
            w: 240,
            h: 80,
            params: { gain: 1 },
          },
          {
            id: 'scope',
            type: 'Scope',
            name: 'Scope',
            x: 1354,
            y: 138,
            w: 200,
            h: 104,
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

  // Exact Hex Color Palette for Native SVG elements (Ensures 100% fidelity in browser AND in standalone SVG viewers)
  const getSvgPalette = (color: BlockDetail['colorTheme'], isSelected: boolean) => {
    const isD = isDark
    const palette = {
      cyan: {
        border: isSelected ? '#06b6d4' : isD ? '#0e7490' : '#0891b2',
        cardBg: isD ? '#0e1726' : '#ffffff',
        badgeBg: isD ? '#083344' : '#e0f2fe',
        badgeText: isD ? '#38bdf8' : '#0284c7',
        accent: '#06b6d4',
        glow: 'rgba(6, 182, 212, 0.6)',
      },
      indigo: {
        border: isSelected ? '#6366f1' : isD ? '#4338ca' : '#4f46e5',
        cardBg: isD ? '#111328' : '#ffffff',
        badgeBg: isD ? '#1e1b4b' : '#e0e7ff',
        badgeText: isD ? '#818cf8' : '#4338ca',
        accent: '#6366f1',
        glow: 'rgba(99, 102, 241, 0.6)',
      },
      emerald: {
        border: isSelected ? '#10b981' : isD ? '#047857' : '#059669',
        cardBg: isD ? '#0a1a17' : '#ffffff',
        badgeBg: isD ? '#022c22' : '#d1fae5',
        badgeText: isD ? '#34d399' : '#059669',
        accent: '#10b981',
        glow: 'rgba(16, 185, 129, 0.6)',
      },
      amber: {
        border: isSelected ? '#f59e0b' : isD ? '#b45309' : '#d97706',
        cardBg: isD ? '#1a160d' : '#ffffff',
        badgeBg: isD ? '#451a03' : '#fef3c7',
        badgeText: isD ? '#fbbf24' : '#d97706',
        accent: '#f59e0b',
        glow: 'rgba(245, 158, 11, 0.6)',
      },
      rose: {
        border: isSelected ? '#f43f5e' : isD ? '#be123c' : '#e11d48',
        cardBg: isD ? '#1a0e14' : '#ffffff',
        badgeBg: isD ? '#4c0519' : '#ffe4e6',
        badgeText: isD ? '#fb7185' : '#e11d48',
        accent: '#f43f5e',
        glow: 'rgba(244, 63, 94, 0.6)',
      },
      purple: {
        border: isSelected ? '#a855f7' : isD ? '#7e22ce' : '#9333ea',
        cardBg: isD ? '#170f24' : '#ffffff',
        badgeBg: isD ? '#3b0764' : '#f3e8ff',
        badgeText: isD ? '#c084fc' : '#7e22ce',
        accent: '#a855f7',
        glow: 'rgba(168, 85, 247, 0.6)',
      },
      slate: {
        border: isSelected ? '#94a3b8' : isD ? '#475569' : '#64748b',
        cardBg: isD ? '#0f172a' : '#ffffff',
        badgeBg: isD ? '#1e293b' : '#f1f5f9',
        badgeText: isD ? '#cbd5e1' : '#475569',
        accent: '#94a3b8',
        glow: 'rgba(148, 163, 184, 0.6)',
      },
    }[color]

    return palette
  }

  // Main UI Canvas Content
  const diagramContent = (
    <div
      ref={containerRef}
      style={
        isFullscreen
          ? {
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 999999,
              margin: 0,
              padding: 0,
            }
          : undefined
      }
      className={
        isFullscreen
          ? 'fixed inset-0 z-[999999] flex h-screen w-screen flex-col overflow-hidden bg-surface m-0 p-0 shadow-2xl'
          : 'relative flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated transition-all duration-200 shadow-sm'
      }
    >
      {/* Top Header & Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-elevated/95 px-5 py-3.5 backdrop-blur-md shrink-0">
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
            className={`${btnBase} ${btnCompact} text-xs border border-border text-foreground hover:bg-surface-hover flex items-center gap-1.5 font-medium`}
          >
            <Download className="size-3.5 text-cyan-500" />
            <span>Export SVG</span>
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
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Expand Fullscreen'}
            className="rounded-lg border border-border p-1.5 text-muted-text hover:bg-surface-hover hover:text-foreground"
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </div>
      </div>

      {/* Main Interactive Canvas Area */}
      <div className="relative flex flex-1 flex-col lg:flex-row overflow-hidden min-h-[490px]">
        <div
          className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing select-none bg-[radial-gradient(#94a3b8_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:24px_24px] bg-surface"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <svg
            ref={svgRef}
            className="w-full h-full min-h-[490px]"
            viewBox="0 0 1580 520"
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
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#06b6d4" />
              </marker>

              <marker
                id="wire-arrow-feedback"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />
              </marker>

              {/* Glowing filter for block selection */}
              <filter id="block-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#06b6d4" floodOpacity="0.5" />
              </filter>
            </defs>

            {/* Bottom Watermark */}
            <text
              x="50"
              y="490"
              fill={isDark ? '#64748b' : '#94a3b8'}
              fontSize="11"
              fontFamily="monospace"
              fontWeight="500"
            >
              LabCD Control Engine | Closed-Loop Architecture
            </text>

            {/* ========================================================
                ORTHOGONAL WIRES & SIGNAL CONNECTIONS (100% Vector)
               ======================================================== */}
            <g className="diagram-wires">
              {/* Wire 1: Reference -> Summing Junction */}
              <path
                d="M 240 190 L 310 190"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
              />
              {/* Wire 1 Badge r(t) */}
              <rect x="261" y="179" width="28" height="22" rx="4" fill={isDark ? '#0b0f19' : '#e0f2fe'} stroke="#06b6d4" strokeWidth="1.2" />
              <text x="275" y="194" fill="#06b6d4" fontSize="11" fontFamily="monospace" fontWeight="700" textAnchor="middle">
                r(t)
              </text>

              {/* Wire 2: Summing Junction -> Controller */}
              <path
                d="M 364 190 L 434 190"
                fill="none"
                stroke="#6366f1"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
              />
              {/* Wire 2 Badge e(t) */}
              <rect x="385" y="179" width="28" height="22" rx="4" fill={isDark ? '#0b0f19' : '#e0e7ff'} stroke="#6366f1" strokeWidth="1.2" />
              <text x="399" y="194" fill="#6366f1" fontSize="11" fontFamily="monospace" fontWeight="700" textAnchor="middle">
                e(t)
              </text>

              {/* Wire 3: Controller -> Actuator Saturation */}
              <path
                d="M 674 190 L 744 190"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
              />
              {/* Wire 3 Badge u_c(t) */}
              <rect x="689" y="179" width="40" height="22" rx="4" fill={isDark ? '#0b0f19' : '#fef3c7'} stroke="#f59e0b" strokeWidth="1.2" />
              <text x="709" y="194" fill="#f59e0b" fontSize="11" fontFamily="monospace" fontWeight="700" textAnchor="middle">
                u_c(t)
              </text>

              {/* Wire 4: Actuator Saturation -> Plant Dynamics */}
              <path
                d="M 954 190 L 1024 190"
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
              />
              {/* Wire 4 Badge u(t) */}
              <rect x="975" y="179" width="28" height="22" rx="4" fill={isDark ? '#0b0f19' : '#d1fae5'} stroke="#10b981" strokeWidth="1.2" />
              <text x="989" y="194" fill="#10b981" fontSize="11" fontFamily="monospace" fontWeight="700" textAnchor="middle">
                u(t)
              </text>

              {/* Wire 5: Plant Dynamics -> Output Branch & Scope */}
              <path
                d="M 1284 190 L 1354 190"
                fill="none"
                stroke="#a855f7"
                strokeWidth="2.5"
                markerEnd="url(#wire-arrow)"
              />
              {/* Output y(t) Badge */}
              <rect x="1305" y="179" width="28" height="22" rx="4" fill={isDark ? '#0b0f19' : '#f3e8ff'} stroke="#a855f7" strokeWidth="1.2" />
              <text x="1319" y="194" fill="#a855f7" fontSize="11" fontFamily="monospace" fontWeight="700" textAnchor="middle">
                y(t)
              </text>

              {/* Wire 6: Feedback Loop Branching from (1319, 190) -> (1319, 390) -> through Sensor (730, 350) -> to (337, 390) -> up to Sum (337, 217) */}
              <circle cx="1319" cy="190" r="4.5" fill="#a855f7" />
              <path
                d="M 1319 190 L 1319 390 L 970 390"
                fill="none"
                stroke="#f43f5e"
                strokeWidth="2"
              />
              <path
                d="M 730 390 L 337 390 L 337 217"
                fill="none"
                stroke="#f43f5e"
                strokeWidth="2"
                markerEnd="url(#wire-arrow-feedback)"
              />

              {/* Feedback Loop Label Badge */}
              <rect x="1050" y="379" width="160" height="22" rx="4" fill={isDark ? '#0b0f19' : '#ffe4e6'} stroke="#f43f5e" strokeWidth="1.2" />
              <text x="1130" y="394" fill="#f43f5e" fontSize="10.5" fontFamily="monospace" fontWeight="700" textAnchor="middle">
                Feedback Loop: y(t)
              </text>

              {/* Sum Junction Port Signs */}
              <text x="348" y="235" fill="#f43f5e" fontSize="15" fontFamily="monospace" fontWeight="bold">
                −
              </text>
              <text x="296" y="185" fill="#06b6d4" fontSize="15" fontFamily="monospace" fontWeight="bold">
                +
              </text>

              {/* Animated Live Pulses (when enabled) */}
              {animatedFlow && (
                <>
                  <path
                    d="M 240 190 L 310 190"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-75 pointer-events-none"
                  />
                  <path
                    d="M 364 190 L 434 190"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-75 pointer-events-none"
                  />
                  <path
                    d="M 674 190 L 744 190"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-75 pointer-events-none"
                  />
                  <path
                    d="M 954 190 L 1024 190"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-75 pointer-events-none"
                  />
                  <path
                    d="M 1284 190 L 1354 190"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeDasharray="6 14"
                    className="animate-[dash_1s_linear_infinite] opacity-75 pointer-events-none"
                  />
                  <path
                    d="M 1319 190 L 1319 390 L 970 390 M 730 390 L 337 390 L 337 217"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeDasharray="6 14"
                    className="animate-[dash_1.5s_linear_infinite] opacity-70 pointer-events-none"
                  />
                </>
              )}
            </g>

            {/* ========================================================
                BLOCKS (100% Native SVG - No ForeignObject Dependency)
               ======================================================== */}
            {blocks.map((block) => {
              const isSelected = selectedBlockId === block.id
              const p = getSvgPalette(block.colorTheme, isSelected)

              if (block.role === 'sum') {
                return (
                  <g
                    key={block.id}
                    className="diagram-block-interactive cursor-pointer group"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedBlockId((prev) => (prev === block.id ? null : block.id))
                    }}
                  >
                    <circle
                      cx={block.x + block.w / 2}
                      cy={block.y + block.h / 2}
                      r={block.w / 2}
                      fill={p.cardBg}
                      stroke={p.border}
                      strokeWidth={isSelected ? '3' : '2'}
                      filter={isSelected ? 'url(#block-glow)' : undefined}
                    />
                    <text
                      x={block.x + block.w / 2}
                      y={block.y + block.h / 2 + 7}
                      fill={isDark ? '#f43f5e' : '#e11d48'}
                      fontSize="24"
                      fontWeight="bold"
                      fontFamily="system-ui, sans-serif"
                      textAnchor="middle"
                    >
                      Σ
                    </text>
                  </g>
                )
              }

              return (
                <g
                  key={block.id}
                  className="diagram-block-interactive cursor-pointer group"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedBlockId((prev) => (prev === block.id ? null : block.id))
                  }}
                >
                  {/* Card Outer Body */}
                  <rect
                    x={block.x}
                    y={block.y}
                    width={block.w}
                    height={block.h}
                    rx="14"
                    fill={p.cardBg}
                    stroke={p.border}
                    strokeWidth={isSelected ? '2.5' : '1.5'}
                    filter={isSelected ? 'url(#block-glow)' : undefined}
                  />

                  {/* Header Badge Pill */}
                  <rect
                    x={block.x + 12}
                    y={block.y + 12}
                    width={block.badge.length * 7.5 + 14}
                    height="20"
                    rx="5"
                    fill={p.badgeBg}
                    stroke={p.accent}
                    strokeWidth="0.8"
                  />
                  <text
                    x={block.x + 19}
                    y={block.y + 26}
                    fill={p.badgeText}
                    fontSize="9.5"
                    fontWeight="700"
                    fontFamily="system-ui, sans-serif"
                    letterSpacing="0.4"
                  >
                    {block.badge.toUpperCase()}
                  </text>

                  {/* Vector Icon in Top-Right Corner */}
                  <g transform={`translate(${block.x + block.w - 28}, ${block.y + 14})`}>
                    {block.role === 'source' && (
                      <polygon points="0,0 12,6.5 0,13" fill="#06b6d4" />
                    )}
                    {block.role === 'controller' && (
                      <g>
                        <rect x="2" y="2" width="10" height="10" rx="2" fill="none" stroke="#6366f1" strokeWidth="1.5" />
                        <path d="M5 2V0 M9 2V0 M5 14v-2 M9 14v-2 M2 5H0 M2 9H0 M14 5h-2 M14 9h-2" stroke="#6366f1" strokeWidth="1.2" />
                      </g>
                    )}
                    {block.role === 'actuator' && (
                      <polygon points="6,0 1,7 5,7 4,13 10,5 5,5" fill="#f59e0b" />
                    )}
                    {block.role === 'plant' && (
                      <path d="M0 6.5h2.5l2-4 3.5 8 2-4h2.5" fill="none" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                    {block.role === 'sink' && (
                      <g>
                        <path d="M1 10a6 6 0 1 1 11 0" fill="none" stroke="#a855f7" strokeWidth="1.5" />
                        <path d="M6.5 7l2.5-2.5" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" />
                      </g>
                    )}
                    {block.role === 'feedback' && (
                      <path d="M1 4l5.5-2.5 5.5 2.5-5.5 2.5-5.5-2.5z M1 7.5l5.5 2.5 5.5-2.5 M1 11l5.5 2.5 5.5-2.5" fill="none" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </g>

                  {/* Title */}
                  <text
                    x={block.x + 14}
                    y={block.y + 53}
                    fill={isDark ? '#f8fafc' : '#0f172a'}
                    fontSize="13"
                    fontWeight="600"
                    fontFamily="system-ui, sans-serif"
                  >
                    {block.title.length > 28 ? `${block.title.slice(0, 26)}…` : block.title}
                  </text>

                  {/* Subtitle */}
                  {block.subtitle && (
                    <text
                      x={block.x + 14}
                      y={block.y + 70}
                      fill={isDark ? '#94a3b8' : '#64748b'}
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {block.subtitle.length > 32 ? `${block.subtitle.slice(0, 30)}…` : block.subtitle}
                    </text>
                  )}

                  {/* Equations Badge Container (Native SVG) */}
                  {block.equations && block.equations.length > 0 && block.h > 100 && (
                    <g transform={`translate(${block.x + 12}, ${block.y + block.h - 32})`}>
                      <rect
                        width={block.w - 24}
                        height="22"
                        rx="5"
                        fill={isDark ? '#020617' : '#f1f5f9'}
                        stroke={isDark ? '#1e293b' : '#e2e8f0'}
                        strokeWidth="1"
                      />
                      <text
                        x="8"
                        y="15"
                        fill={isDark ? '#cbd5e1' : '#334155'}
                        fontSize="9.5"
                        fontFamily="monospace"
                      >
                        {block.equations[0].length > 32
                          ? `${block.equations[0].slice(0, 30)}…`
                          : block.equations[0]}
                      </text>
                    </g>
                  )}

                  {/* Port Connection Dots */}
                  {block.role !== 'source' && (
                    <circle cx={block.x} cy={block.y + block.h / 2} r="4" fill={p.accent} />
                  )}
                  {block.role !== 'sink' && (
                    <circle cx={block.x + block.w} cy={block.y + block.h / 2} r="4" fill={p.accent} />
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
          <div
            className={`w-full lg:w-96 shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-surface-elevated/95 p-5 shadow-lg backdrop-blur-md animate-in slide-in-from-right duration-200 overflow-y-auto ${
              isFullscreen ? 'h-full max-h-none' : 'max-h-[520px]'
            }`}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border/70 pb-3">
              <div className="flex items-center gap-2">
                <span className="rounded-lg p-1.5 border border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
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

      {/* Footer Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-5 py-2.5 text-[11px] text-muted-text shrink-0">
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

  // When Fullscreen is requested, Portal to document.body to prevent any parent container clipping!
  if (isFullscreen && typeof document !== 'undefined') {
    return (
      <>
        <div className="w-full h-[520px] rounded-2xl border border-dashed border-border/60 bg-surface/30 flex flex-col items-center justify-center gap-2 text-xs text-muted-text">
          <Workflow className="size-6 text-cyan-500/50 animate-pulse" />
          <span>Diagram is currently expanded in Fullscreen mode</span>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="mt-1 text-cyan-500 underline text-xs hover:text-cyan-400 cursor-pointer"
          >
            Click here or press Esc to return
          </button>
        </div>
        {createPortal(diagramContent, document.body)}
      </>
    )
  }

  return diagramContent
}
