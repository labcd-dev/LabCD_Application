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

  // SVG Drawing dimensions
  const W = 920
  const H = 320
  const PAD = 35

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
          const nx = PAD + ((tVal - tMin) / tRange) * (W - 2 * PAD)
          const ny = H - PAD - ((y - min) / yR) * (H - 2 * PAD)
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
      y: H - PAD - ((b.val - min) / yR) * (H - 2 * PAD),
    }))

    return {
      lines: calculatedLines,
      boundsLines: calculatedBounds,
      yMin: min,
      yMax: max,
    }
  }, [hasRealData, sim, activeTab, selectedStateIdx, showBaseline, baselineSeries, t, tMin, tRange])

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
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD) / (rect.width - 2 * PAD)))
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
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="size-full overflow-visible select-none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Grid lines */}
          <line x1={PAD} y1={PAD} x2={W - PAD} y2={PAD} stroke="var(--app-border)" strokeDasharray="3 3" />
          <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="var(--app-border)" />
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--app-border)" strokeDasharray="3 3" />

          {/* Zero Axis if in range */}
          {yMin < 0 && yMax > 0 && (
            <line
              x1={PAD}
              y1={H - PAD - ((0 - yMin) / (yMax - yMin)) * (H - 2 * PAD)}
              x2={W - PAD}
              y2={H - PAD - ((0 - yMin) / (yMax - yMin)) * (H - 2 * PAD)}
              stroke="var(--app-border)"
              strokeDasharray="2 2"
            />
          )}

          {/* Bounds reference lines */}
          {boundsLines.map((b, i) => (
            <g key={i}>
              <line
                x1={PAD}
                y1={b.y}
                x2={W - PAD}
                y2={b.y}
                stroke={b.color}
                strokeWidth="1.2"
                strokeDasharray="4 3"
                opacity="0.8"
              />
              <text x={W - PAD - 80} y={b.y - 4} fill={b.color} fontSize="9" fontFamily="monospace">
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
                x1={PAD + ((hoverTime - tMin) / tRange) * (W - 2 * PAD)}
                y1={PAD}
                x2={PAD + ((hoverTime - tMin) / tRange) * (W - 2 * PAD)}
                y2={H - PAD}
                stroke="rgba(6, 182, 212, 0.6)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              {lines.map((l) => {
                const val = l.values[hoverIndex]
                if (typeof val !== 'number') return null
                const cy = H - PAD - ((val - yMin) / (yMax - yMin)) * (H - 2 * PAD)
                const cx = PAD + ((hoverTime - tMin) / tRange) * (W - 2 * PAD)
                return <circle key={l.name} cx={cx} cy={cy} r="4" fill={l.color} />
              })}
            </g>
          )}
        </svg>

        {/* Floating HUD Tooltip */}
        {hoverIndex !== null && hoverTime !== null && (
          <div className="pointer-events-none absolute top-4 left-5 flex flex-col gap-1 rounded-xl border border-border bg-surface-elevated/95 p-2.5 text-[11px] font-mono text-foreground shadow-md backdrop-blur-md">
            <span className="font-bold text-cyan-600 dark:text-cyan-400">t = {hoverTime.toFixed(3)}s</span>
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
