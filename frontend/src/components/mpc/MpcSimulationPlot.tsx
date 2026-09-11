import { useMemo, useState } from 'react'
import {
  Download,
  CheckCircle2,
  ArrowRightLeft,
  Activity,
} from 'lucide-react'
import { btnBase, btnCompact } from '../../lib/classes'

export interface SimSeriesData {
  t: number[]
  x: Record<string, number[]>
  xd: Record<string, number[]>
  u: Record<string, number[]>
  names: string[]
  input_names: string[]
  bounds?: {
    x_lo?: Array<number | null> | null
    x_hi?: Array<number | null> | null
    u_lo?: Array<number | null> | null
    u_hi?: Array<number | null> | null
  }
  per_state_metrics?: Array<{
    name: string
    mse: number
    overshoot: number
    iae: number
    ise: number
  }>
  [key: string]: unknown
}

interface MpcSimulationPlotProps {
  series?: SimSeriesData | null
  baselineSeries?: SimSeriesData | null
  currentIteration: number
  bestMse?: number | null
}

const PALETTE = [
  '#38bdf8', // sky blue
  '#a855f7', // purple
  '#34d399', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#fb7185', // rose
]

function generateNiceTicks(min: number, max: number, targetCount = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return [min]
  }
  const span = max - min
  const stepRaw = span / Math.max(1, targetCount)
  const power = Math.floor(Math.log10(stepRaw))
  const frac = stepRaw / Math.pow(10, power)
  let niceFrac: number
  if (frac <= 1.5) niceFrac = 1
  else if (frac <= 3) niceFrac = 2
  else if (frac <= 7) niceFrac = 5
  else niceFrac = 10
  const step = niceFrac * Math.pow(10, power)
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.05; v += step) {
    const rounded = Number(v.toFixed(Math.max(0, -power + 2)))
    if (rounded >= min - step * 0.05 && rounded <= max + step * 0.05) {
      ticks.push(rounded)
    }
  }
  return ticks.length >= 2 ? ticks : [min, (min + max) / 2, max]
}

function formatTickValue(v: number): string {
  const abs = Math.abs(v)
  if (abs === 0) return '0'
  if (abs >= 10000 || abs < 0.001) {
    return v.toExponential(1)
  }
  if (abs >= 100) return v.toFixed(0)
  if (abs >= 10) return v.toFixed(1)
  if (abs >= 1) return v.toFixed(2)
  return v.toFixed(3)
}

export function MpcSimulationPlot({
  series,
  baselineSeries,
  currentIteration,
}: MpcSimulationPlotProps) {
  const [activeTab, setActiveTab] = useState<'all_states' | 'single_state' | 'controls' | 'errors'>('all_states')
  const [selectedStateIdx, setSelectedStateIdx] = useState<number>(0)
  const [showBaseline, setShowBaseline] = useState<boolean>(true)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const hasRealData = Boolean(
    series &&
    Array.isArray(series.t) &&
    series.t.length > 0 &&
    Array.isArray(series.names) &&
    series.names.length > 0 &&
    series.x &&
    Object.keys(series.x).length > 0
  )

  const sim = useMemo<SimSeriesData>(() => {
    if (hasRealData && series) {
      return series
    }
    return {
      t: [],
      x: {},
      xd: {},
      u: {},
      names: [],
      input_names: [],
    }
  }, [series, hasRealData])

  const t = sim.t
  const tMin = t[0] ?? 0
  const tMax = t[t.length - 1] ?? 3.0
  const tRange = tMax - tMin || 1.0

  // SVG Drawing dimensions with dedicated padding for axes
  const W = 960
  const H = 340
  const PAD_LEFT = 68
  const PAD_RIGHT = 32
  const PAD_TOP = 25
  const PAD_BOTTOM = 48
  const plotW = W - PAD_LEFT - PAD_RIGHT
  const plotH = H - PAD_TOP - PAD_BOTTOM

  // Compute scale depending on active tab
  const { lines, boundsLines, yMin, yMax } = useMemo(() => {
    if (!hasRealData) {
      return {
        lines: [],
        boundsLines: [],
        yMin: 0,
        yMax: 1,
      }
    }

    let curves: Array<{
      name: string
      color: string
      dash?: string
      values: number[]
      width?: number
    }> = []

    let bounds: Array<{ val: number; label: string; color: string }> = []
    let allVals: number[] = []

    if (activeTab === 'all_states') {
      sim.names.forEach((name, idx) => {
        const color = PALETTE[idx % PALETTE.length]
        const vals = sim.x[name] || []
        const refVals = sim.xd[name] || []
        curves.push({ name, color, values: vals, width: 2 })
        allVals.push(...vals)
        if (refVals.some((v) => v !== 0)) {
          curves.push({ name: `${name}_ref`, color, dash: '4 3', values: refVals, width: 1.5 })
          allVals.push(...refVals)
        }
      })
    } else if (activeTab === 'single_state') {
      const stateName = sim.names[selectedStateIdx] || sim.names[0]
      const color = PALETTE[selectedStateIdx % PALETTE.length]
      const vals = sim.x[stateName] || []
      const refVals = sim.xd[stateName] || []
      curves.push({ name: `${stateName} (Optimal)`, color, values: vals, width: 2.5 })
      allVals.push(...vals)
      if (refVals.length) {
        curves.push({ name: 'Reference Target', color: '#f87171', dash: '5 3', values: refVals, width: 1.8 })
        allVals.push(...refVals)
      }

      // Check baseline overlay
      if (showBaseline && baselineSeries && baselineSeries.x && baselineSeries.x[stateName]) {
        const bVals = baselineSeries.x[stateName]
        curves.push({ name: 'Initial Baseline (Round 1)', color: '#64748b', dash: '2 2', values: bVals, width: 1.5 })
        allVals.push(...bVals)
      }

      // State Bounds
      const lo = sim.bounds?.x_lo?.[selectedStateIdx]
      const hi = sim.bounds?.x_hi?.[selectedStateIdx]
      if (typeof lo === 'number' && Number.isFinite(lo)) {
        bounds.push({ val: lo, label: `Lower Bound (${lo})`, color: '#ef4444' })
        allVals.push(lo)
      }
      if (typeof hi === 'number' && Number.isFinite(hi)) {
        bounds.push({ val: hi, label: `Upper Bound (${hi})`, color: '#ef4444' })
        allVals.push(hi)
      }
    } else if (activeTab === 'controls') {
      sim.input_names.forEach((name, idx) => {
        const color = PALETTE[(idx + 2) % PALETTE.length]
        const vals = sim.u[name] || []
        curves.push({ name, color, values: vals, width: 2 })
        allVals.push(...vals)

        const uLo = sim.bounds?.u_lo?.[idx]
        const uHi = sim.bounds?.u_hi?.[idx]
        if (typeof uLo === 'number' && Number.isFinite(uLo)) {
          bounds.push({ val: uLo, label: `u_min (${uLo})`, color: '#f43f5e' })
          allVals.push(uLo)
        }
        if (typeof uHi === 'number' && Number.isFinite(uHi)) {
          bounds.push({ val: uHi, label: `u_max (${uHi})`, color: '#f43f5e' })
          allVals.push(uHi)
        }
      })
    } else if (activeTab === 'errors') {
      sim.names.forEach((name, idx) => {
        const color = PALETTE[idx % PALETTE.length]
        const xVals = sim.x[name] || []
        const refVals = sim.xd[name] || []
        const errs = xVals.map((v, i) => v - (refVals[i] ?? 0))
        curves.push({ name: `Error e_${name}`, color, values: errs, width: 1.8 })
        allVals.push(...errs)
      })
    }

    if (!allVals.length) allVals = [0, 1]
    let min = Math.min(...allVals)
    let max = Math.max(...allVals)
    if (min === max) {
      min -= 1
      max += 1
    }
    const pad = (max - min) * 0.12 || 0.5
    min -= pad
    max += pad
    const yR = max - min || 1.0

    const toSvgPath = (arr: number[]) => {
      return arr
        .map((y, i) => {
          const tVal = t[i] ?? tMin + (i / (arr.length - 1)) * tRange
          const nx = PAD_LEFT + ((tVal - tMin) / tRange) * plotW
          const ny = PAD_TOP + plotH - ((y - min) / yR) * plotH
          return `${i === 0 ? 'M' : 'L'} ${nx.toFixed(1)} ${ny.toFixed(1)}`
        })
        .join(' ')
    }

    const calculatedLines = curves.map((c) => ({
      ...c,
      path: toSvgPath(c.values),
    }))

    const calculatedBounds = bounds.map((b) => ({
      ...b,
      y: PAD_TOP + plotH - ((b.val - min) / yR) * plotH,
    }))

    return {
      lines: calculatedLines,
      boundsLines: calculatedBounds,
      yMin: min,
      yMax: max,
    }
  }, [hasRealData, sim, activeTab, selectedStateIdx, showBaseline, baselineSeries, t, tMin, tRange, plotW, plotH])

  const yAxisTitle = useMemo(() => {
    if (activeTab === 'all_states' || activeTab === 'single_state') {
      return 'State Response x(t) [units]'
    }
    if (activeTab === 'controls') {
      return 'Actuator Effort u(t) [effort]'
    }
    return 'Tracking Error e(t) [units]'
  }, [activeTab])

  const xTicks = useMemo(() => {
    return generateNiceTicks(tMin, tMax, 7)
  }, [tMin, tMax])

  const yTicks = useMemo(() => {
    return generateNiceTicks(yMin, yMax, 6)
  }, [yMin, yMax])

  if (!hasRealData) {
    return (
      <div className="space-y-4 rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`flex size-2 rounded-full ${currentIteration > 0 ? 'bg-cyan-500 shadow-[0_0_8px_#06b6d4] animate-pulse' : 'bg-muted shadow-none'}`} />
              <h3 className="text-sm font-bold text-foreground tracking-wide">
                Time-Domain Closed-Loop Oscilloscope
              </h3>
              <span className={`rounded-md border px-2 py-0.5 text-[10.5px] font-mono ${
                currentIteration > 0
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300'
                  : 'border-border bg-surface-muted text-muted-text'
              }`}>
                {currentIteration > 0 ? `Simulating Iteration ${currentIteration}...` : 'Live Telemetry Standby'}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-text">
              Real nonlinear state trajectories integrated via RK4 against optimal OSQP receding-horizon controls
            </p>
          </div>
        </div>

        <div className="relative flex flex-col items-center justify-center min-h-[300px] rounded-xl border border-dashed border-border/70 bg-surface/40 p-8 text-center overflow-hidden">
          {/* Ambient oscilloscope grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:36px_36px] pointer-events-none" />
          
          <div className="relative z-10 flex flex-col items-center max-w-md">
            <div className={`flex size-12 items-center justify-center rounded-2xl border shadow-lg mb-3.5 transition-all ${
              currentIteration > 0
                ? 'bg-purple-500/15 text-purple-400 border-purple-500/30 shadow-purple-500/10 animate-pulse'
                : 'bg-surface-muted text-muted-text border-border'
            }`}>
              <Activity className={`size-6 ${currentIteration > 0 ? 'animate-spin' : ''}`} />
            </div>

            <h4 className="text-sm font-bold text-foreground mb-1">
              {currentIteration > 0 ? 'Simulating Dynamic Response...' : 'Awaiting Live MPC Simulation'}
            </h4>
            <p className="text-xs text-muted-text leading-relaxed mb-3">
              {currentIteration > 0
                ? `The Evaluator agent is running the closed-loop simulation on the plant dynamics for iteration ${currentIteration}. Real state waveforms will stream here directly upon step resolution.`
                : 'Launch autonomous tuning or test dynamics to populate real-time time-domain trajectories.'}
            </p>

            {currentIteration > 0 && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-purple-500/30 bg-purple-500/10 text-[11px] font-mono text-purple-400">
                <span className="size-1.5 rounded-full bg-purple-400 animate-ping" />
                Live solver telemetry active
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Mouse Move over chart for crosshair
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const xPct = Math.max(0, Math.min(1, (svgX - PAD_LEFT) / plotW))
    const idx = Math.round(xPct * (t.length - 1))
    setHoverIndex(idx)
  }

  const handleExportCsv = () => {
    const header = ['time', ...sim.names.map((n) => `x_${n}`), ...sim.input_names.map((n) => `u_${n}`)].join(',')
    const rows = [header]

    for (let i = 0; i < t.length; i++) {
      const row = [
        t[i].toFixed(4),
        ...sim.names.map((n) => (sim.x[n]?.[i] !== undefined ? sim.x[n][i].toFixed(5) : '')),
        ...sim.input_names.map((n) => (sim.u[n]?.[i] !== undefined ? sim.u[n][i].toFixed(5) : '')),
      ]
      rows.push(row.join(','))
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `mpc_closed_loop_series_iter_${currentIteration}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const hoverTime = hoverIndex !== null ? t[hoverIndex] : null

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
      {/* Oscilloscope Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-cyan-500 shadow-[0_0_8px_#06b6d4]" />
            <h3 className="text-sm font-bold text-foreground tracking-wide">
              Time-Domain Closed-Loop Oscilloscope
            </h3>
            <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10.5px] font-mono text-cyan-600 dark:text-cyan-300">
              {t.length} samples · {tRange.toFixed(2)}s simulation
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-text">
            Real nonlinear state trajectories integrated via RK4 against optimal OSQP receding-horizon controls
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border bg-surface-muted p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('all_states')}
              className={`rounded-lg px-3 py-1.5 transition-all ${
                activeTab === 'all_states'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-muted-text hover:text-foreground'
              }`}
            >
              All States
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('single_state')}
              className={`rounded-lg px-3 py-1.5 transition-all ${
                activeTab === 'single_state'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-muted-text hover:text-foreground'
              }`}
            >
              Single State
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('controls')}
              className={`rounded-lg px-3 py-1.5 transition-all ${
                activeTab === 'controls'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-muted-text hover:text-foreground'
              }`}
            >
              Actuators (u)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('errors')}
              className={`rounded-lg px-3 py-1.5 transition-all ${
                activeTab === 'errors'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-muted-text hover:text-foreground'
              }`}
            >
              Tracking Error
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className={`${btnBase} ${btnCompact} flex items-center gap-1.5 text-xs text-muted-text hover:text-foreground`}
          >
            <Download className="size-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* Sub-bar for Channel selection & Baseline switch */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        {activeTab === 'single_state' && (
          <div className="flex items-center gap-2">
            <span className="text-muted-text text-[11px] font-medium">Channel:</span>
            <div className="flex gap-1.5">
              {sim.names.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelectedStateIdx(i)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono transition-all ${
                    selectedStateIdx === i
                      ? 'border-purple-500 bg-purple-500/20 text-purple-600 dark:text-purple-200 font-bold'
                      : 'border-border bg-surface text-muted-text hover:text-foreground'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'single_state' && baselineSeries && (
          <label className="flex items-center gap-2 text-[11.5px] text-muted-text cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showBaseline}
              onChange={(e) => setShowBaseline(e.target.checked)}
              className="size-3.5 rounded border-border bg-surface text-purple-600 focus:ring-0"
            />
            <span className="flex items-center gap-1">
              <ArrowRightLeft className="size-3 text-muted" />
              Compare vs Round 1 Baseline
            </span>
          </label>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
          {lines.map((l) => (
            <div key={l.name} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-3.5 rounded"
                style={{
                  backgroundColor: l.color,
                  borderTop: l.dash ? '1px dashed' : undefined,
                }}
              />
              <span className="text-foreground">{l.name}</span>
            </div>
          ))}
          {boundsLines.map((b) => (
            <div key={b.label} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3.5 border-t border-dashed border-red-500" />
              <span className="text-red-500">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main SVG Oscilloscope Screen */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-2.5">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="size-full overflow-visible select-none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Plot Canvas Box */}
          <rect
            x={PAD_LEFT}
            y={PAD_TOP}
            width={plotW}
            height={plotH}
            fill="rgba(15, 23, 42, 0.25)"
            stroke="var(--app-border)"
            strokeWidth="1"
            rx="4"
          />

          {/* Horizontal Y Grid lines & Tick Labels */}
          {yTicks.map((val) => {
            const yPos = PAD_TOP + plotH - ((val - yMin) / (yMax - yMin || 1)) * plotH
            return (
              <g key={`y-${val}`}>
                <line
                  x1={PAD_LEFT}
                  y1={yPos}
                  x2={PAD_LEFT + plotW}
                  y2={yPos}
                  stroke="var(--app-border)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.45"
                />
                <line
                  x1={PAD_LEFT - 4}
                  y1={yPos}
                  x2={PAD_LEFT}
                  y2={yPos}
                  stroke="var(--app-border)"
                  strokeWidth="1.2"
                />
                <text
                  x={PAD_LEFT - 8}
                  y={yPos + 3.5}
                  textAnchor="end"
                  fontSize="10"
                  fontFamily="monospace"
                  fill="currentColor"
                  className="text-muted-text"
                >
                  {formatTickValue(val)}
                </text>
              </g>
            )
          })}

          {/* Vertical X Grid lines & Tick Labels */}
          {xTicks.map((tVal) => {
            const xPos = PAD_LEFT + ((tVal - tMin) / tRange) * plotW
            return (
              <g key={`x-${tVal}`}>
                <line
                  x1={xPos}
                  y1={PAD_TOP}
                  x2={xPos}
                  y2={PAD_TOP + plotH}
                  stroke="var(--app-border)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.35"
                />
                <line
                  x1={xPos}
                  y1={PAD_TOP + plotH}
                  x2={xPos}
                  y2={PAD_TOP + plotH + 5}
                  stroke="var(--app-border)"
                  strokeWidth="1.2"
                />
                <text
                  x={xPos}
                  y={PAD_TOP + plotH + 18}
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="monospace"
                  fill="currentColor"
                  className="text-muted-text"
                >
                  {tVal.toFixed(2)}s
                </text>
              </g>
            )
          })}

          {/* Axis Labels & Titles */}
          <text
            x={PAD_LEFT + plotW / 2}
            y={H - 8}
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="currentColor"
            className="text-muted-text"
          >
            Time t (seconds)
          </text>

          <g transform={`translate(16, ${PAD_TOP + plotH / 2}) rotate(-90)`}>
            <text
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="currentColor"
              className="text-muted-text"
            >
              {yAxisTitle}
            </text>
          </g>

          {/* Zero Reference Line if in range */}
          {yMin < 0 && yMax > 0 && (
            <g>
              <line
                x1={PAD_LEFT}
                y1={PAD_TOP + plotH - ((0 - yMin) / (yMax - yMin)) * plotH}
                x2={PAD_LEFT + plotW}
                y2={PAD_TOP + plotH - ((0 - yMin) / (yMax - yMin)) * plotH}
                stroke="#06b6d4"
                strokeWidth="1.2"
                strokeDasharray="4 2"
                opacity="0.75"
              />
              <text
                x={PAD_LEFT + plotW - 6}
                y={PAD_TOP + plotH - ((0 - yMin) / (yMax - yMin)) * plotH - 4}
                textAnchor="end"
                fontSize="9"
                fontFamily="monospace"
                fill="#06b6d4"
                opacity="0.85"
              >
                0.0 (equilibrium)
              </text>
            </g>
          )}

          {/* Bounds reference lines */}
          {boundsLines.map((b, i) => (
            <g key={i}>
              <line
                x1={PAD_LEFT}
                y1={b.y}
                x2={PAD_LEFT + plotW}
                y2={b.y}
                stroke={b.color}
                strokeWidth="1.2"
                strokeDasharray="4 3"
                opacity="0.8"
              />
              <text x={PAD_LEFT + plotW - 80} y={b.y - 4} fill={b.color} fontSize="9" fontFamily="monospace">
                {b.label}
              </text>
            </g>
          ))}

          {/* Traces */}
          {lines.map((l) => (
            <path
              key={l.name}
              d={l.path}
              fill="none"
              stroke={l.color}
              strokeWidth={l.width || 2}
              strokeDasharray={l.dash}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Hover Crosshair & Indicators */}
          {hoverIndex !== null && hoverTime !== null && (
            <g>
              <line
                x1={PAD_LEFT + ((hoverTime - tMin) / tRange) * plotW}
                y1={PAD_TOP}
                x2={PAD_LEFT + ((hoverTime - tMin) / tRange) * plotW}
                y2={PAD_TOP + plotH}
                stroke="rgba(6, 182, 212, 0.75)"
                strokeWidth="1.2"
                strokeDasharray="3 3"
              />
              {lines.map((l) => {
                const val = l.values[hoverIndex]
                if (typeof val !== 'number') return null
                const cy = PAD_TOP + plotH - ((val - yMin) / (yMax - yMin || 1)) * plotH
                const cx = PAD_LEFT + ((hoverTime - tMin) / tRange) * plotW
                return (
                  <circle key={l.name} cx={cx} cy={cy} r="4.5" fill={l.color} stroke="#0f172a" strokeWidth="1.5" />
                )
              })}
            </g>
          )}
        </svg>

        {/* Floating HUD Tooltip */}
        {hoverIndex !== null && hoverTime !== null && (
          <div className="pointer-events-none absolute top-4 left-24 flex flex-col gap-1 rounded-xl border border-border bg-surface-elevated/95 p-2.5 text-[11px] font-mono text-foreground shadow-lg backdrop-blur-md z-20">
            <span className="font-bold text-cyan-500">t = {hoverTime.toFixed(3)}s</span>
            {lines.map((l) => {
              const val = l.values[hoverIndex]
              if (typeof val !== 'number') return null
              return (
                <div key={l.name} className="flex items-center justify-between gap-4">
                  <span className="text-muted-text">{l.name}:</span>
                  <span className="font-bold" style={{ color: l.color }}>
                    {val.toFixed(4)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Per-State Performance Metrics Table */}
      {sim.per_state_metrics && sim.per_state_metrics.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-elevated p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-bold text-foreground uppercase tracking-wider">
              Per-Channel Tracking Performance Index
            </span>
            <span className="text-[11px] text-muted-text">
              Integral Absolute Error (IAE) &amp; Integral Squared Error (ISE)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] text-muted-text">
                  <th className="pb-2 font-medium">State Variable</th>
                  <th className="pb-2 font-medium">Channel MSE</th>
                  <th className="pb-2 font-medium">Max Overshoot</th>
                  <th className="pb-2 font-medium">IAE (Integral |e|)</th>
                  <th className="pb-2 font-medium">ISE (Integral e²)</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sim.per_state_metrics.map((row) => (
                  <tr key={row.name} className="hover:bg-surface-hover">
                    <td className="py-2 text-purple-600 dark:text-purple-300 font-semibold">{row.name}</td>
                    <td className="py-2 text-foreground">{row.mse.toFixed(5)}</td>
                    <td className="py-2 text-amber-600 dark:text-amber-300">{row.overshoot.toFixed(2)}%</td>
                    <td className="py-2 text-cyan-600 dark:text-cyan-300">{row.iae.toFixed(4)}</td>
                    <td className="py-2 text-rose-600 dark:text-rose-300">{row.ise.toFixed(4)}</td>
                    <td className="py-2 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Stabilized
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
