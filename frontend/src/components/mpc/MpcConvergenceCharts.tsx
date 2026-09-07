import { useMemo, useState } from 'react'
import {
  TrendingDown,
  Activity,
  Gauge,
  Clock,
  Zap,
  Sliders,
  Maximize2,
} from 'lucide-react'

interface MpcConvergenceChartsProps {
  mseHistory?: Array<number | null>
  overshootHistory?: Array<number | null>
  settlingHistory?: Array<number | null>
  effortHistory?: Array<number | null>
  paramsHistory?: Array<Record<string, unknown>>
  dtHistory?: Array<number | null>
  bestMse?: number | null
}

interface Point {
  iter: number
  val: number
}

function MiniChart({
  title,
  subtitle,
  icon: Icon,
  data,
  color,
  unit,
  isStep = false,
  lowerIsBetter = true,
}: {
  title: string
  subtitle: string
  icon: React.ElementType
  data: Point[]
  color: string
  unit?: string
  isStep?: boolean
  lowerIsBetter?: boolean
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const { points, minVal, maxVal, pathD, areaD, validData } = useMemo(() => {
    const valid = data.filter((d) => typeof d.val === 'number' && Number.isFinite(d.val))
    if (!valid.length) {
      return { points: [], minVal: 0, maxVal: 1, pathD: '', areaD: '', validData: [] }
    }

    const vals = valid.map((d) => d.val)
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    if (min === max) {
      min = min * 0.9
      max = max * 1.1 || 1.0
    }
    const range = max - min || 1.0

    const W = 380
    const H = 90
    const PAD = 10

    const coords = valid.map((d, i) => {
      const x = valid.length === 1 ? W / 2 : PAD + (i / (valid.length - 1)) * (W - 2 * PAD)
      const y = H - PAD - ((d.val - min) / range) * (H - 2 * PAD)
      return { x, y, iter: d.iter, val: d.val }
    })

    let d = ''
    if (isStep) {
      coords.forEach((pt, i) => {
        if (i === 0) d += `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`
        else {
          const prev = coords[i - 1]
          d += ` L ${pt.x.toFixed(1)} ${prev.y.toFixed(1)} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`
        }
      })
    } else {
      coords.forEach((pt, i) => {
        d += `${i === 0 ? 'M' : ' L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`
      })
    }

    const area = coords.length
      ? `${d} L ${coords[coords.length - 1].x.toFixed(1)} ${H - PAD} L ${coords[0].x.toFixed(1)} ${H - PAD} Z`
      : ''

    return { points: coords, minVal: min, maxVal: max, pathD: d, areaD: area, validData: valid }
  }, [data, isStep])

  const initialVal = validData[0]?.val
  const latestVal = validData[validData.length - 1]?.val
  const deltaPct =
    initialVal !== undefined && latestVal !== undefined && initialVal !== 0
      ? ((latestVal - initialVal) / Math.abs(initialVal)) * 100
      : null

  const isImproved = lowerIsBetter
    ? deltaPct !== null && deltaPct <= 0
    : deltaPct !== null && deltaPct >= 0

  const gradId = useMemo(() => {
    return `grad-mpc-${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
  }, [title])

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface-elevated p-3.5 shadow-sm transition-all hover:border-border-strong">
      {/* Top Header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 truncate">
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border"
            style={{ backgroundColor: `${color}18`, color }}
          >
            <Icon className="size-3.5" />
          </div>
          <div className="truncate">
            <h4 className="text-xs font-bold text-foreground tracking-wide truncate">{title}</h4>
            <span className="text-[10.5px] text-muted-text truncate block">{subtitle}</span>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="font-mono text-sm font-bold text-foreground">
            {latestVal !== undefined ? (
              <>
                {latestVal >= 1000 ? latestVal.toFixed(1) : latestVal.toFixed(3)}
                {unit && <span className="ml-0.5 text-[10px] text-muted-text font-normal">{unit}</span>}
              </>
            ) : (
              '--'
            )}
          </div>
          {deltaPct !== null && validData.length > 1 && (
            <span
              className={`inline-block text-[10px] font-mono font-medium ${
                isImproved ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {deltaPct > 0 ? `+${deltaPct.toFixed(1)}%` : `${deltaPct.toFixed(1)}%`}
            </span>
          )}
        </div>
      </div>

      {/* SVG Chart Area */}
      <div className="relative mt-1.5 h-20 w-full">
        {points.length > 0 ? (
          <svg
            viewBox="0 0 380 90"
            className="size-full overflow-visible"
            onMouseLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0.0} />
              </linearGradient>
            </defs>

            {/* Grid horizontal dashed lines */}
            <line x1="10" y1="15" x2="370" y2="15" stroke="var(--app-border)" strokeDasharray="3 3" />
            <line x1="10" y1="45" x2="370" y2="45" stroke="var(--app-border)" strokeDasharray="3 3" />
            <line x1="10" y1="75" x2="370" y2="75" stroke="var(--app-border)" />

            {/* Area fill */}
            {areaD && <path d={areaD} fill={`url(#${gradId})`} />}

            {/* Curve stroke */}
            <path
              d={pathD}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Markers */}
            {points.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r={hoverIdx === i ? 4 : 2}
                fill="var(--app-surface-elevated)"
                stroke={color}
                strokeWidth={hoverIdx === i ? 2 : 1}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHoverIdx(i)}
              />
            ))}

            {/* Hover Crosshair */}
            {hoverIdx !== null && points[hoverIdx] && (
              <g>
                <line
                  x1={points[hoverIdx].x}
                  y1="5"
                  x2={points[hoverIdx].x}
                  y2="85"
                  stroke="var(--app-border)"
                  strokeDasharray="2 2"
                />
                <circle cx={points[hoverIdx].x} cy={points[hoverIdx].y} r="4" fill={color} />
              </g>
            )}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            Awaiting iteration data...
          </div>
        )}

        {/* Hover Pill */}
        {hoverIdx !== null && points[hoverIdx] && (
          <div
            className="pointer-events-none absolute -top-1 rounded border border-border bg-surface-elevated/95 px-2 py-0.5 text-[10px] font-mono text-foreground shadow-md backdrop-blur-md"
            style={{
              left: `${Math.min(Math.max((points[hoverIdx].x / 380) * 100, 10), 85)}%`,
              transform: 'translateX(-50%)',
            }}
          >
            Iter {points[hoverIdx].iter}: {points[hoverIdx].val.toFixed(4)} {unit || ''}
          </div>
        )}
      </div>

      {/* Axis Footer */}
      <div className="mt-1 flex items-center justify-between text-[9.5px] font-mono text-muted">
        <span>Min: {minVal.toFixed(3)}</span>
        <span>{points.length} rounds logged</span>
        <span>Max: {maxVal.toFixed(3)}</span>
      </div>
    </div>
  )
}

export function MpcConvergenceCharts({
  mseHistory = [],
  overshootHistory = [],
  settlingHistory = [],
  effortHistory = [],
  paramsHistory = [],
  dtHistory = [],
  bestMse,
}: MpcConvergenceChartsProps) {
  // Format point series
  const mseData: Point[] = useMemo(
    () =>
      mseHistory
        .map((v, i) => ({ iter: i + 1, val: v as number }))
        .filter((d) => typeof d.val === 'number' && Number.isFinite(d.val)),
    [mseHistory]
  )

  const overshootData: Point[] = useMemo(
    () =>
      overshootHistory
        .map((v, i) => ({ iter: i + 1, val: v as number }))
        .filter((d) => typeof d.val === 'number' && Number.isFinite(d.val)),
    [overshootHistory]
  )

  const settlingData: Point[] = useMemo(
    () =>
      settlingHistory
        .map((v, i) => ({ iter: i + 1, val: v as number }))
        .filter((d) => typeof d.val === 'number' && Number.isFinite(d.val) && d.val < 1e5),
    [settlingHistory]
  )

  const effortData: Point[] = useMemo(
    () =>
      effortHistory
        .map((v, i) => ({ iter: i + 1, val: v as number }))
        .filter((d) => typeof d.val === 'number' && Number.isFinite(d.val)),
    [effortHistory]
  )

  // Extract Np, Nc, Q max, R max, dt
  const npData: Point[] = useMemo(() => {
    return paramsHistory
      .map((p, i) => {
        const val = Number(p?.Np ?? p?.prediction_horizon ?? 12)
        return { iter: i + 1, val }
      })
      .filter((d) => Number.isFinite(d.val))
  }, [paramsHistory])

  const ncData: Point[] = useMemo(() => {
    return paramsHistory
      .map((p, i) => {
        const val = Number(p?.Nc ?? p?.control_horizon ?? 4)
        return { iter: i + 1, val }
      })
      .filter((d) => Number.isFinite(d.val))
  }, [paramsHistory])

  const qWeightData: Point[] = useMemo(() => {
    return paramsHistory
      .map((p, i) => {
        const qArr = p?.Q ?? p?.q_weights
        if (Array.isArray(qArr) && qArr.length) {
          const maxQ = Math.max(...qArr.map((v) => Number(v) || 0))
          return { iter: i + 1, val: maxQ }
        }
        return { iter: i + 1, val: 10.0 }
      })
      .filter((d) => Number.isFinite(d.val))
  }, [paramsHistory])

  const dtData: Point[] = useMemo(() => {
    if (dtHistory.length) {
      return dtHistory
        .map((v, i) => ({ iter: i + 1, val: Number(v) || 0.02 }))
        .filter((d) => Number.isFinite(d.val))
    }
    return paramsHistory
      .map((p, i) => {
        const val = Number(p?.dt ?? p?.dt_mpc ?? 0.02)
        return { iter: i + 1, val }
      })
      .filter((d) => Number.isFinite(d.val))
  }, [dtHistory, paramsHistory])

  return (
    <div id="section-convergence" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30">
            <Activity className="size-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-foreground">
              7-Channel Optimization Convergence Suite
            </h3>
            <p className="text-[10.5px] text-muted-text">
              Real-time trajectory of cost objectives, transient dynamics, control horizon, and sample time adaptations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {bestMse !== undefined && bestMse !== null && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
              Optimal MSE: {bestMse.toFixed(5)}
            </span>
          )}
          <span className="rounded-full border border-purple-500/30 bg-purple-500/15 px-3 py-1 text-xs font-mono font-medium text-purple-600 dark:text-purple-300">
            Active: L2 Quadratic Objective
          </span>
        </div>
      </div>

      {/* Grid of 7 Curves + dt in 4x2 Bento Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. MSE */}
        <MiniChart
          title="Tracking Error Cost"
          subtitle="Mean Squared Error (MSE)"
          icon={TrendingDown}
          data={mseData}
          color="#a855f7"
          lowerIsBetter={true}
        />

        {/* 2. Overshoot */}
        <MiniChart
          title="Maximum Overshoot"
          subtitle="Peak Transient Deviation"
          icon={Activity}
          data={overshootData}
          color="#f59e0b"
          unit="%"
          lowerIsBetter={true}
        />

        {/* 3. Settling Time */}
        <MiniChart
          title="Settling Time (ts)"
          subtitle="2% Tolerance Band"
          icon={Clock}
          data={settlingData}
          color="#06b6d4"
          unit="s"
          lowerIsBetter={true}
        />

        {/* 4. Control Effort */}
        <MiniChart
          title="Actuator Effort"
          subtitle="Integral Quadratic ||u||²"
          icon={Zap}
          data={effortData}
          color="#10b981"
          lowerIsBetter={true}
        />

        {/* 5. Prediction Horizon Np */}
        <MiniChart
          title="Prediction Horizon (Np)"
          subtitle="Look-ahead Step Count"
          icon={Maximize2}
          data={npData}
          color="#6366f1"
          unit="steps"
          isStep={true}
        />

        {/* 6. Control Horizon Nc */}
        <MiniChart
          title="Control Horizon (Nc)"
          subtitle="Control Input Moves"
          icon={Sliders}
          data={ncData}
          color="#8b5cf6"
          unit="steps"
          isStep={true}
        />

        {/* 7. State Penalty max(Q) */}
        <MiniChart
          title="State Weighting (Q)"
          subtitle="Max Diagonal Element"
          icon={Sliders}
          data={qWeightData}
          color="#ec4899"
          isStep={true}
        />

        {/* 8. MPC Sample Time dt */}
        <MiniChart
          title="Sample Interval (dt)"
          subtitle="Discrete Solver Step Size"
          icon={Gauge}
          data={dtData}
          color="#38bdf8"
          unit="s"
          isStep={true}
        />
      </div>
    </div>
  )
}
