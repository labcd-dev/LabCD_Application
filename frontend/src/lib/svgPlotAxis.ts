/**
 * Shared SVG plot axis helpers (used by MPC and Adaptive oscilloscopes).
 */

export function generateNiceTicks(min: number, max: number, targetCount = 6): number[] {
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

export function formatTickValue(v: number): string {
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
