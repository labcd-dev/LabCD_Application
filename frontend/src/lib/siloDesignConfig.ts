export const AVAILABLE_CONTROLLERS = ['P', 'PI', 'PD', 'PID', 'FSF'] as const

export type ControllerType = (typeof AVAILABLE_CONTROLLERS)[number]

export interface CustomScenario {
  id: string
  initial_condition_range: [number, number]
  randomness_level: number
  disturbance_level: number
}

export interface SiloGaConfig {
  num_generations: number
  population_size: number
  num_parents_mating: number
  keep_parents: number
  crossover_probability: number
  mutation_probability: number
  num_evaluation_runs: number
  weights: {
    mse: number
    settling_time: number
    overshoot: number
    control_effort: number
  }
}

export interface SiloAdvancedConfig {
  controllers: ControllerType[]
  max_scenarios: number
  max_iter: number
  seed: number
  max_tries: number
  target_metrics: {
    mse: number
    settling_time: number
    overshoot: number
  }
  dt: number
  max_time: number
  target: number
  num_inputs: number
  input_channel: number
  output_channel: number
  min_ctrl: number
  max_ctrl: number
  num_states: number
  trim_values_str: string
  customizePidRanges: boolean
  pidKpRange: [number, number]
  pidKiRange: [number, number]
  pidKdRange: [number, number]
  customizeFsfRanges: boolean
  fsfRanges: Record<string, [number, number]>
  scenarios: CustomScenario[]
  enable_ga: boolean
  ga_config: SiloGaConfig
}

export function createDefaultScenario(index: number): CustomScenario {
  return {
    id: String.fromCharCode(64 + index),
    initial_condition_range: [-1, 1],
    randomness_level: 0,
    disturbance_level: 0,
  }
}

export function createDefaultFsfRanges(numStates: number): Record<string, [number, number]> {
  const ranges: Record<string, [number, number]> = {}
  for (let i = 0; i < numStates; i += 1) {
    ranges[`K${i + 1}`] = [-50, 50]
  }
  return ranges
}

export const DEFAULT_SILO_ADVANCED_CONFIG: SiloAdvancedConfig = {
  controllers: ['PID', 'FSF'],
  max_scenarios: 1,
  max_iter: 10,
  seed: 42,
  max_tries: 1,
  target_metrics: {
    mse: 0.25,
    settling_time: 5.0,
    overshoot: 20.0,
  },
  dt: 0.01,
  max_time: 20.0,
  target: 0.0,
  num_inputs: 1,
  input_channel: 0,
  output_channel: 0,
  min_ctrl: -10.0,
  max_ctrl: 10.0,
  num_states: 4,
  trim_values_str: '0.0',
  customizePidRanges: false,
  pidKpRange: [0, 200],
  pidKiRange: [0, 50],
  pidKdRange: [0, 100],
  customizeFsfRanges: false,
  fsfRanges: createDefaultFsfRanges(4),
  scenarios: [createDefaultScenario(1)],
  enable_ga: false,
  ga_config: {
    num_generations: 100,
    population_size: 50,
    num_parents_mating: 10,
    keep_parents: 2,
    crossover_probability: 0.8,
    mutation_probability: 0.1,
    num_evaluation_runs: 10,
    weights: {
      mse: 1.0,
      settling_time: 0.1,
      overshoot: 0.01,
      control_effort: 0.001,
    },
  },
}

function buildParamRanges(config: SiloAdvancedConfig): Record<string, Record<string, [number, number]>> | null {
  const customParamRanges: Record<string, Record<string, [number, number]>> = {}
  const pidSelected = config.controllers.some((c) => ['P', 'PI', 'PD', 'PID'].includes(c))

  if (config.customizePidRanges && pidSelected) {
    const unified: Record<string, [number, number]> = {
      Kp: config.pidKpRange,
    }
    if (config.controllers.some((c) => ['PI', 'PID'].includes(c))) {
      unified.Ki = config.pidKiRange
    }
    if (config.controllers.some((c) => ['PD', 'PID'].includes(c))) {
      unified.Kd = config.pidKdRange
    }

    for (const controller of config.controllers) {
      if (!['P', 'PI', 'PD', 'PID'].includes(controller)) continue
      const controllerRanges: Record<string, [number, number]> = {}
      if (unified.Kp) controllerRanges.Kp = unified.Kp
      if (controller === 'PI' && unified.Ki) controllerRanges.Ki = unified.Ki
      if (controller === 'PD' && unified.Kd) controllerRanges.Kd = unified.Kd
      if (controller === 'PID') {
        if (unified.Ki) controllerRanges.Ki = unified.Ki
        if (unified.Kd) controllerRanges.Kd = unified.Kd
      }
      if (Object.keys(controllerRanges).length > 0) {
        customParamRanges[controller] = controllerRanges
      }
    }
  }

  if (config.customizeFsfRanges && config.controllers.includes('FSF')) {
    customParamRanges.FSF = { ...config.fsfRanges }
  }

  return Object.keys(customParamRanges).length > 0 ? customParamRanges : null
}

export function buildSiloStartConfig(
  advanced: SiloAdvancedConfig,
  base: {
    llm_model: string
    file_content: string
    file_type: string
    file_name?: string
  },
): Record<string, unknown> {
  const trimValues = advanced.trim_values_str
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map(Number)

  const sortedControllers = [...advanced.controllers].sort(
    (a, b) => AVAILABLE_CONTROLLERS.indexOf(a) - AVAILABLE_CONTROLLERS.indexOf(b),
  )

  const gaConfig = advanced.enable_ga
    ? {
        ...advanced.ga_config,
        mutation_num_genes: 1,
        random_seed: advanced.seed,
      }
    : null

  const fileName = base.file_name?.trim() || undefined
  const matlabFuncName =
    fileName && fileName.toLowerCase().endsWith('.m')
      ? fileName.replace(/\.m$/i, '')
      : 'dynamics'

  return {
    llm_model: base.llm_model,
    file_content: base.file_content,
    file_type: base.file_type,
    file_name: fileName,
    controllers: sortedControllers.length > 0 ? sortedControllers : null,
    max_scenarios: advanced.max_scenarios,
    max_iter: advanced.max_iter,
    seed: advanced.seed,
    max_tries: advanced.max_tries,
    target_metrics: {
      ...advanced.target_metrics,
      max_iterations: advanced.max_iter,
    },
    dt: advanced.dt,
    max_time: advanced.max_time,
    target: advanced.target,
    num_inputs: advanced.num_inputs,
    input_channel: advanced.input_channel,
    output_channel: advanced.output_channel,
    min_ctrl: advanced.min_ctrl,
    max_ctrl: advanced.max_ctrl,
    matlab_func_name: matlabFuncName,
    num_states: advanced.num_states !== 4 ? advanced.num_states : null,
    trim_values:
      trimValues.length === advanced.num_inputs ? trimValues : null,
    param_ranges: buildParamRanges(advanced),
    custom_scenarios:
      advanced.scenarios.length > 0 ? advanced.scenarios.slice(0, advanced.max_scenarios) : null,
    enable_ga: advanced.enable_ga,
    ga_config: gaConfig,
  }
}

export function syncScenariosToMax(
  scenarios: CustomScenario[],
  maxScenarios: number,
): CustomScenario[] {
  const next = [...scenarios]
  while (next.length < maxScenarios) {
    next.push(createDefaultScenario(next.length + 1))
  }
  return next.slice(0, maxScenarios)
}

export function syncFsfRangesToNumStates(
  ranges: Record<string, [number, number]>,
  numStates: number,
): Record<string, [number, number]> {
  const next = { ...ranges }
  for (let i = 0; i < numStates; i += 1) {
    const key = `K${i + 1}`
    if (!next[key]) {
      next[key] = [-50, 50]
    }
  }
  return Object.fromEntries(
    Object.entries(next).filter(([key]) => {
      const index = Number(key.replace('K', ''))
      return index >= 1 && index <= numStates
    }),
  )
}
