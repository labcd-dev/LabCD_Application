export interface SimulationMetrics {
  mse?: number
  rmse?: number
  settling_time?: number | null
  overshoot?: number
  stable?: boolean
  rise_time?: number | null
  zero_crossings?: number
  control_effort?: number
  control_zero_crossings?: number
  ss_error?: number
}

export interface SimulationStep {
  globalStep: number
  iteration: number
  timestamp: string
  controllerType: string
  scenarioLevel: number
  params: Record<string, number>
  metrics: SimulationMetrics
  trajectory: number[]
  controlSignals: number[]
  errors: number[]
  dt: number
  maxTime: number
  target: number
}

export interface TargetMetrics {
  mse?: number
  settling_time?: number
  overshoot?: number
}

export interface MonitorSummary {
  iteration: number
  maxIterations: number
  scenarioLevel: number
  maxScenarios: number
  controllerType: string
  controllersList: string[]
  currentControllerIndex: number
  systemDescription?: string
  target: number
  dt: number
  maxTime: number
  metrics?: SimulationMetrics
  params: Record<string, number>
}

export interface StateHistoryEntry {
  timestamp?: string
  state?: Record<string, unknown>
}

const PARAM_SKIP = new Set(['reasoning'])

export function parseNumPyArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is number => typeof item === 'number')
  }
  if (typeof value !== 'string') return []

  const inner = value.match(/array\(\[([\s\S]*?)\]\)/i)?.[1]
  if (!inner) return []

  return inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function getControllerType(state: Record<string, unknown>): string {
  const explicit = state.controller_type
  if (typeof explicit === 'string' && explicit) return explicit

  const controllers = state.controllers_list
  const index = typeof state.current_controller_index === 'number' ? state.current_controller_index : 0
  if (Array.isArray(controllers) && typeof controllers[index] === 'string') {
    return controllers[index]
  }
  return 'Unknown'
}

function stepKey(
  partial: Omit<SimulationStep, 'globalStep'>,
): string {
  return `${partial.iteration}:${JSON.stringify(partial.params)}:${JSON.stringify(partial.metrics)}`
}

function extractParams(state: Record<string, unknown>): Record<string, number> {
  const currentParams = asRecord(state.current_params)
  if (!currentParams) return {}

  const params: Record<string, number> = {}
  for (const [key, value] of Object.entries(currentParams)) {
    if (PARAM_SKIP.has(key)) continue
    if (typeof value === 'number' && Number.isFinite(value)) {
      params[key] = value
    }
  }
  return params
}

function extractMetrics(results: Record<string, unknown> | null): SimulationMetrics | null {
  if (!results?.metrics) return null
  const metrics = asRecord(results.metrics)
  if (!metrics) return null

  return {
    mse: asNumber(metrics.mse),
    rmse: asNumber(metrics.rmse),
    settling_time:
      metrics.settling_time === null ? null : asNumber(metrics.settling_time),
    overshoot: asNumber(metrics.overshoot),
    stable: typeof metrics.stable === 'boolean' ? metrics.stable : undefined,
    rise_time: metrics.rise_time === null ? null : asNumber(metrics.rise_time),
    zero_crossings: asNumber(metrics.zero_crossings),
    control_effort: asNumber(metrics.control_effort),
    control_zero_crossings: asNumber(metrics.control_zero_crossings),
    ss_error: asNumber(metrics.ss_error),
  }
}

function stepFromState(
  state: Record<string, unknown>,
  timestamp: string,
): Omit<SimulationStep, 'globalStep'> | null {
  const results = asRecord(state.results)
  const metrics = extractMetrics(results)
  if (!metrics) return null

  return {
    iteration: typeof state.iteration === 'number' ? state.iteration : 0,
    timestamp,
    controllerType: getControllerType(state),
    scenarioLevel: typeof state.scenario_level === 'number' ? state.scenario_level : 0,
    params: extractParams(state),
    metrics,
    trajectory: parseNumPyArray(results?.trajectory),
    controlSignals: parseNumPyArray(results?.control_signals),
    errors: parseNumPyArray(results?.errors),
    dt: asNumber(state.dt) ?? 0.01,
    maxTime: asNumber(state.max_time) ?? 5,
    target: asNumber(state.target) ?? 0,
  }
}

export function extractSimulationSteps(
  stateHistory: StateHistoryEntry[],
  currentState?: Record<string, unknown> | null,
): SimulationStep[] {
  const steps: SimulationStep[] = []
  let globalStep = 0
  let lastStepKey = ''

  for (const entry of stateHistory) {
    const state = entry.state
    if (!state) continue

    const partial = stepFromState(state, entry.timestamp ?? '')
    if (!partial) continue

    const key = stepKey(partial)
    if (key === lastStepKey) continue
    lastStepKey = key
    globalStep += 1

    steps.push({ globalStep, ...partial })
  }

  if (currentState) {
    const live = stepFromState(currentState, 'current')
    if (live) {
      const liveKey = stepKey(live)
      if (liveKey !== lastStepKey) {
        globalStep += 1
        steps.push({ globalStep, ...live })
      }
    }
  }

  return steps
}

export function extractTargetMetrics(
  currentState?: Record<string, unknown> | null,
  stateHistory?: StateHistoryEntry[],
): TargetMetrics | null {
  const sources: Array<Record<string, unknown> | null | undefined> = [currentState]
  if (stateHistory) {
    for (let i = stateHistory.length - 1; i >= 0; i -= 1) {
      sources.push(stateHistory[i]?.state)
    }
  }

  for (const source of sources) {
    const raw = asRecord(source?.target_metrics)
    if (!raw) continue
    const targets: TargetMetrics = {
      mse: asNumber(raw.mse),
      settling_time: asNumber(raw.settling_time),
      overshoot: asNumber(raw.overshoot),
    }
    if (
      targets.mse !== undefined ||
      targets.settling_time !== undefined ||
      targets.overshoot !== undefined
    ) {
      return targets
    }
  }

  return null
}

export function buildMonitorSummary(currentState: Record<string, unknown> | null): MonitorSummary | null {
  if (!currentState) return null

  const results = asRecord(currentState.results)
  const controllersList = Array.isArray(currentState.controllers_list)
    ? currentState.controllers_list.filter((item): item is string => typeof item === 'string')
    : []

  return {
    iteration: typeof currentState.iteration === 'number' ? currentState.iteration : 0,
    maxIterations:
      typeof currentState.max_iterations === 'number' ? currentState.max_iterations : 0,
    scenarioLevel:
      typeof currentState.scenario_level === 'number' ? currentState.scenario_level : 0,
    maxScenarios: typeof currentState.max_scenarios === 'number' ? currentState.max_scenarios : 0,
    controllerType: getControllerType(currentState),
    controllersList,
    currentControllerIndex:
      typeof currentState.current_controller_index === 'number'
        ? currentState.current_controller_index
        : 0,
    systemDescription:
      typeof currentState.system_description === 'string'
        ? currentState.system_description
        : undefined,
    target: asNumber(currentState.target) ?? 0,
    dt: asNumber(currentState.dt) ?? 0.01,
    maxTime: asNumber(currentState.max_time) ?? 5,
    metrics: extractMetrics(results) ?? undefined,
    params: extractParams(currentState),
  }
}

export function formatMetricValue(name: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (!Number.isFinite(value)) return '∞'

  if (name === 'settling_time' || name === 'rise_time') {
    return `${value.toFixed(2)} s`
  }
  if (name === 'overshoot') {
    return `${value.toFixed(1)}%`
  }
  if (name === 'stable') {
    return value ? 'Yes' : 'No'
  }
  if (name === 'mse' || name === 'rmse' || name === 'ss_error') {
    return value.toFixed(4)
  }
  return value.toFixed(2)
}

export function buildTimePoints(dt: number, maxTime: number, length: number): number[] {
  const expectedSteps = Math.floor(maxTime / dt) + 1
  return Array.from({ length: Math.min(length, expectedSteps) }, (_, index) => index * dt)
}

export function paramsSummary(params: Record<string, number>): string {
  const entries = Object.entries(params)
  if (entries.length === 0) return '—'
  return entries.map(([key, value]) => `${key}=${value.toFixed(2)}`).join(', ')
}
