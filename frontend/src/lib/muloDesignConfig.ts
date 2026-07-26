export interface MuloRunConfig {
  case_study_file: string
  seed: number
  llm_model: string
  web_search_model: string | null
  max_attempts: number
  buffer_size: number
  max_wall_clock: number
  max_cost_budget: number
  prompt_variant: 'elaborate' | 'concise'
  control_objective: string
}

export interface MuloLoopMetrics {
  mse: number
  settling_time: number
  overshoot: number
  control_effort: number
}

export interface MuloPidLoop {
  loop_number: number
  loop_name: string
  controllers: Array<Record<string, unknown>>
  metrics?: MuloLoopMetrics
}

export interface MuloCaseStudyBundle {
  controller: MuloPidLoop[] | { pid_loops: MuloPidLoop[] }
  trimming: Record<string, unknown>
  system: Record<string, unknown>
  equation: string
}

export interface MuloDesignerState {
  job_id: string
  controller_index: number
  controller_designed: boolean
  total_loops: number
  loop_name: string
  is_complete: boolean
  equation: string
  controller_structure: MuloPidLoop[]
  case_study: Record<string, unknown>
  run_config: MuloRunConfig
  final_state: Record<string, unknown>
  modified_code: string
  modified_controller_structure: MuloPidLoop[]
  pid_gains: { Kp: number; Ki: number; Kd: number }
  pid_gain_bounds: { Kp: number; Ki: number; Kd: number }
}

export interface MuloPlotData {
  cumulative_nfe: number[]
  best_baseline_so_far: number[]
  mse: number[]
  settling_time: number[]
  overshoot: number[]
  control_effort: number[]
  Kp: number[]
  Ki: number[]
  Kd: number[]
  attempt: number[]
  success_score: number[]
  attempt_boundaries_nfe: number[]
  attempt_ranges: Record<number, Record<string, [number, number]>>
  attempt_weights: Record<number, Record<string, number>>
  attempt_pop_gen: Record<number, { pop: number; gen: number }>
  attempt_summaries: Array<Record<string, unknown>>
}

export interface MuloSimulateResponse {
  signal_type: string
  time: number[]
  actual: number[]
  reference: number[]
  y_label: string
  unit: string
  code: string
}

export type MuloStage = 'setup' | 'edit_case_study' | 'running' | 'complete'

export const DEFAULT_MULO_RUN_CONFIG: MuloRunConfig = {
  case_study_file: '',
  seed: 42,
  llm_model: 'gpt-4o-mini',
  web_search_model: null,
  max_attempts: 5,
  buffer_size: 3,
  max_wall_clock: 120,
  max_cost_budget: 1,
  prompt_variant: 'elaborate',
  control_objective: '',
}

export function normalizeControllerStructure(
  controller: MuloCaseStudyBundle['controller'],
): MuloPidLoop[] {
  if (Array.isArray(controller)) {
    return controller
  }
  if (controller && typeof controller === 'object' && 'pid_loops' in controller) {
    return (controller as { pid_loops: MuloPidLoop[] }).pid_loops
  }
  return []
}

export function buildMuloRunConfig(
  overrides: Partial<MuloRunConfig> & { control_objective: string },
): MuloRunConfig {
  return { ...DEFAULT_MULO_RUN_CONFIG, ...overrides }
}
