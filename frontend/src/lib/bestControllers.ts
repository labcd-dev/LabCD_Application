/** Parse SILO `scenario_best_results` from monitor current_state / history. */

export interface BestControllerEntry {
  scenarioLevel: number
  controllerType: string
  gains: Record<string, number>
  bestMetrics: Record<string, number>
  score: number
  stable: boolean
  mse: number | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function extractGains(bestParams: unknown): Record<string, number> {
  const params = asRecord(bestParams)
  if (!params) return {}
  const gains: Record<string, number> = {}
  for (const [key, value] of Object.entries(params)) {
    if (key === 'reasoning') continue
    if (typeof value === 'number' && Number.isFinite(value)) {
      gains[key] = value
    }
  }
  return gains
}

function extractNumericMetrics(raw: unknown): Record<string, number> {
  const metrics = asRecord(raw)
  if (!metrics) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(metrics)) {
    if (key === 'reasoning') continue
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value
    }
  }
  return out
}

function parseBestEntry(scenarioLevel: number, raw: unknown): BestControllerEntry | null {
  if (raw === null || raw === undefined) return null
  const best = asRecord(raw)
  if (!best) return null

  const scenMetrics = asRecord(best.scenario_metrics) ?? {}
  const bestMetrics = extractNumericMetrics(best.best_metrics)
  const mse = asNumber(bestMetrics.mse) ?? null

  return {
    scenarioLevel,
    controllerType:
      typeof best.controller_type === 'string' && best.controller_type
        ? best.controller_type
        : 'N/A',
    gains: extractGains(best.best_params),
    bestMetrics,
    score: asNumber(scenMetrics.score) ?? 0,
    stable: Boolean(scenMetrics.stable),
    mse,
  }
}

/** Prefer live current_state, then the latest state_history snapshot. */
export function extractScenarioBestResults(
  currentState: Record<string, unknown> | null | undefined,
  stateHistory: Array<Record<string, unknown>> | unknown,
): Record<string, unknown> {
  const fromCurrent = asRecord(currentState?.scenario_best_results)
  if (fromCurrent && Object.keys(fromCurrent).length > 0) {
    return fromCurrent
  }

  if (!Array.isArray(stateHistory) || stateHistory.length === 0) return {}
  const last = asRecord(stateHistory[stateHistory.length - 1])
  const lastState = asRecord(last?.state)
  const fromHistory = asRecord(lastState?.scenario_best_results)
  return fromHistory ?? {}
}

export function parseBestControllerEntries(
  bestResults: Record<string, unknown>,
): Array<BestControllerEntry | { scenarioLevel: number; missing: true }> {
  const levels = Object.keys(bestResults).sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return String(a).localeCompare(String(b))
  })

  return levels.map((key) => {
    const level = Number(key)
    const scenarioLevel = Number.isFinite(level) ? level : 0
    const parsed = parseBestEntry(scenarioLevel, bestResults[key])
    if (!parsed) return { scenarioLevel, missing: true as const }
    return parsed
  })
}

export function hasBestControllerData(bestResults: Record<string, unknown>): boolean {
  return Object.keys(bestResults).length > 0
}
