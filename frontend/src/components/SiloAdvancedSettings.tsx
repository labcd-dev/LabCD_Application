import type { ReactNode } from 'react'
import {
  AVAILABLE_CONTROLLERS,
  type ControllerType,
  type CustomScenario,
  type SiloAdvancedConfig,
  syncFsfRangesToNumStates,
  syncScenariosToMax,
} from '../lib/siloDesignConfig'
import { cardPanel, fieldCheckbox, fieldInput, fieldLabel } from '../lib/classes'

interface SiloAdvancedSettingsProps {
  value: SiloAdvancedConfig
  onChange: (value: SiloAdvancedConfig) => void
}

function SectionHeader({ children }: { children: string }) {
  return (
    <h3 className="m-0 mt-5 mb-3 text-sm font-semibold tracking-wide text-foreground first:mt-0">
      {children}
    </h3>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className={fieldLabel}>
      <span>{label}</span>
      <input
        type="number"
        className={fieldInput}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className={`${fieldLabel} [&>input[type=range]]:accent-primary`}>
      <span>
        {label}: {value}
      </span>
      <input
        type="range"
        className="w-full"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-x-4">{children}</div>
}

function updateConfig(
  value: SiloAdvancedConfig,
  onChange: (value: SiloAdvancedConfig) => void,
  patch: Partial<SiloAdvancedConfig>,
) {
  onChange({ ...value, ...patch })
}

function updateScenario(
  value: SiloAdvancedConfig,
  onChange: (value: SiloAdvancedConfig) => void,
  index: number,
  patch: Partial<CustomScenario>,
) {
  const scenarios = value.scenarios.map((scenario, i) =>
    i === index ? { ...scenario, ...patch } : scenario,
  )
  onChange({ ...value, scenarios })
}

export function SiloAdvancedSettings({ value, onChange }: SiloAdvancedSettingsProps) {
  const toggleController = (controller: ControllerType) => {
    const selected = value.controllers.includes(controller)
      ? value.controllers.filter((c) => c !== controller)
      : [...value.controllers, controller]
    onChange({ ...value, controllers: selected })
  }

  const pidSelected = value.controllers.some((c) => ['P', 'PI', 'PD', 'PID'].includes(c))
  const kiVisible = value.controllers.some((c) => ['PI', 'PID'].includes(c))
  const kdVisible = value.controllers.some((c) => ['PD', 'PID'].includes(c))

  return (
    <div className={cardPanel}>
      <SectionHeader>Controllers</SectionHeader>
      <div className="flex flex-wrap gap-3 mb-2">
        {AVAILABLE_CONTROLLERS.map((controller) => (
          <label key={controller} className={fieldCheckbox}>
            <input
              type="checkbox"
              checked={value.controllers.includes(controller)}
              onChange={() => toggleController(controller)}
            />
            {controller}
          </label>
        ))}
      </div>

      <SectionHeader>Design Parameters</SectionHeader>
      <FieldGrid>
        <RangeField
          label="Max Scenarios"
          value={value.max_scenarios}
          min={1}
          max={5}
          step={1}
          onChange={(max_scenarios) => {
            onChange({
              ...value,
              max_scenarios,
              scenarios: syncScenariosToMax(value.scenarios, max_scenarios),
            })
          }}
        />
        <RangeField
          label="Max Iterations"
          value={value.max_iter}
          min={5}
          max={30}
          step={1}
          onChange={(max_iter) => updateConfig(value, onChange, { max_iter })}
        />
        <NumberField
          label="Random Seed"
          value={value.seed}
          min={1}
          max={10000}
          onChange={(seed) => updateConfig(value, onChange, { seed })}
        />
        <RangeField
          label="Max Tries for Juror"
          value={value.max_tries}
          min={0}
          max={10}
          step={1}
          onChange={(max_tries) => updateConfig(value, onChange, { max_tries })}
        />
      </FieldGrid>

      <SectionHeader>Target Performance</SectionHeader>
      <FieldGrid>
        <NumberField
          label="Target MSE"
          value={value.target_metrics.mse}
          min={0.01}
          max={1}
          step={0.001}
          onChange={(mse) =>
            onChange({ ...value, target_metrics: { ...value.target_metrics, mse } })
          }
        />
        <NumberField
          label="Settling Time (s)"
          value={value.target_metrics.settling_time}
          min={0.5}
          max={10}
          step={0.1}
          onChange={(settling_time) =>
            onChange({ ...value, target_metrics: { ...value.target_metrics, settling_time } })
          }
        />
        <NumberField
          label="Overshoot (%)"
          value={value.target_metrics.overshoot}
          min={0}
          max={50}
          step={0.1}
          onChange={(overshoot) =>
            onChange({ ...value, target_metrics: { ...value.target_metrics, overshoot } })
          }
        />
      </FieldGrid>

      <SectionHeader>Simulation Parameters</SectionHeader>
      <FieldGrid>
        <NumberField
          label="Sample Time (dt)"
          value={value.dt}
          min={0.001}
          max={1}
          step={0.001}
          onChange={(dt) => updateConfig(value, onChange, { dt })}
        />
        <NumberField
          label="Max Simulation Time (s)"
          value={value.max_time}
          min={0.1}
          max={100}
          step={0.1}
          onChange={(max_time) => updateConfig(value, onChange, { max_time })}
        />
        <NumberField
          label="Target Setpoint"
          value={value.target}
          min={-100}
          max={100}
          step={0.01}
          onChange={(target) => updateConfig(value, onChange, { target })}
        />
        <NumberField
          label="Number of Inputs"
          value={value.num_inputs}
          min={1}
          max={10}
          onChange={(num_inputs) => updateConfig(value, onChange, { num_inputs })}
        />
        <NumberField
          label="Input Channel"
          value={value.input_channel}
          min={0}
          max={10}
          onChange={(input_channel) => updateConfig(value, onChange, { input_channel })}
        />
        <NumberField
          label="Output Channel"
          value={value.output_channel}
          min={0}
          max={10}
          onChange={(output_channel) => updateConfig(value, onChange, { output_channel })}
        />
      </FieldGrid>

      <SectionHeader>Control Limits</SectionHeader>
      <FieldGrid>
        <NumberField
          label="Min Control Input"
          value={value.min_ctrl}
          min={-100}
          max={0}
          step={0.01}
          onChange={(min_ctrl) => updateConfig(value, onChange, { min_ctrl })}
        />
        <NumberField
          label="Max Control Input"
          value={value.max_ctrl}
          min={0}
          max={100}
          step={0.01}
          onChange={(max_ctrl) => updateConfig(value, onChange, { max_ctrl })}
        />
      </FieldGrid>

      <SectionHeader>Custom System Parameters</SectionHeader>
      <FieldGrid>
        <NumberField
          label="Number of States"
          value={value.num_states}
          min={1}
          max={20}
          onChange={(num_states) =>
            onChange({
              ...value,
              num_states,
              fsfRanges: syncFsfRangesToNumStates(value.fsfRanges, num_states),
            })
          }
        />
        <label className={fieldLabel}>
          <span>Trim Values (comma-separated)</span>
          <input
            type="text"
            className={fieldInput}
            value={value.trim_values_str}
            placeholder="0.0,0.0"
            onChange={(e) => updateConfig(value, onChange, { trim_values_str: e.target.value })}
          />
        </label>
      </FieldGrid>

      <SectionHeader>Custom Parameter Ranges</SectionHeader>
      {pidSelected && (
        <>
          <label className={fieldCheckbox}>
            <input
              type="checkbox"
              checked={value.customizePidRanges}
              onChange={(e) =>
                updateConfig(value, onChange, { customizePidRanges: e.target.checked })
              }
            />
            Customize PID-like gains (Kp, Ki, Kd)
          </label>
          {value.customizePidRanges && (
            <div className="mb-4 rounded-lg border border-border bg-surface-muted p-3">
              <FieldGrid>
                <NumberField
                  label="Kp Min"
                  value={value.pidKpRange[0]}
                  step={0.1}
                  onChange={(min) =>
                    onChange({ ...value, pidKpRange: [min, value.pidKpRange[1]] })
                  }
                />
                <NumberField
                  label="Kp Max"
                  value={value.pidKpRange[1]}
                  step={0.1}
                  onChange={(max) =>
                    onChange({ ...value, pidKpRange: [value.pidKpRange[0], max] })
                  }
                />
                {kiVisible && (
                  <>
                    <NumberField
                      label="Ki Min"
                      value={value.pidKiRange[0]}
                      step={0.1}
                      onChange={(min) =>
                        onChange({ ...value, pidKiRange: [min, value.pidKiRange[1]] })
                      }
                    />
                    <NumberField
                      label="Ki Max"
                      value={value.pidKiRange[1]}
                      step={0.1}
                      onChange={(max) =>
                        onChange({ ...value, pidKiRange: [value.pidKiRange[0], max] })
                      }
                    />
                  </>
                )}
                {kdVisible && (
                  <>
                    <NumberField
                      label="Kd Min"
                      value={value.pidKdRange[0]}
                      step={0.1}
                      onChange={(min) =>
                        onChange({ ...value, pidKdRange: [min, value.pidKdRange[1]] })
                      }
                    />
                    <NumberField
                      label="Kd Max"
                      value={value.pidKdRange[1]}
                      step={0.1}
                      onChange={(max) =>
                        onChange({ ...value, pidKdRange: [value.pidKdRange[0], max] })
                      }
                    />
                  </>
                )}
              </FieldGrid>
            </div>
          )}
        </>
      )}

      {value.controllers.includes('FSF') && (
        <>
          <label className={fieldCheckbox}>
            <input
              type="checkbox"
              checked={value.customizeFsfRanges}
              onChange={(e) =>
                updateConfig(value, onChange, { customizeFsfRanges: e.target.checked })
              }
            />
            Customize FSF gains
          </label>
          {value.customizeFsfRanges && (
            <div className="mb-4 rounded-lg border border-border bg-surface-muted p-3">
              <FieldGrid>
                {Object.entries(value.fsfRanges).map(([paramName, [min, max]]) => (
                  <div key={paramName} className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-4">
                    <NumberField
                      label={`${paramName} Min`}
                      value={min}
                      step={0.1}
                      onChange={(nextMin) =>
                        onChange({
                          ...value,
                          fsfRanges: {
                            ...value.fsfRanges,
                            [paramName]: [nextMin, max],
                          },
                        })
                      }
                    />
                    <NumberField
                      label={`${paramName} Max`}
                      value={max}
                      step={0.1}
                      onChange={(nextMax) =>
                        onChange({
                          ...value,
                          fsfRanges: {
                            ...value.fsfRanges,
                            [paramName]: [min, nextMax],
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </FieldGrid>
            </div>
          )}
        </>
      )}

      <SectionHeader>Scenario Configurations</SectionHeader>
      <div className="flex flex-col gap-2">
        {value.scenarios.slice(0, value.max_scenarios).map((scenario, index) => (
          <details
            key={scenario.id}
            className="rounded-lg border border-border bg-surface-muted p-3"
            open={index === 0}
          >
            <summary className="cursor-pointer font-medium text-sm text-foreground">
              Scenario {index + 1} (ID: {scenario.id})
            </summary>
            <div className="mt-3">
              <FieldGrid>
                <label className={fieldLabel}>
                  <span>
                    Initial Condition Min: {scenario.initial_condition_range[0]}
                  </span>
                  <input
                    type="range"
                    className="w-full accent-primary"
                    value={scenario.initial_condition_range[0]}
                    min={-2}
                    max={2}
                    step={0.1}
                    onChange={(e) => {
                      const min = Number(e.target.value)
                      const max = Math.max(min, scenario.initial_condition_range[1])
                      updateScenario(value, onChange, index, {
                        initial_condition_range: [min, max],
                      })
                    }}
                  />
                </label>
                <label className={fieldLabel}>
                  <span>
                    Initial Condition Max: {scenario.initial_condition_range[1]}
                  </span>
                  <input
                    type="range"
                    className="w-full accent-primary"
                    value={scenario.initial_condition_range[1]}
                    min={-2}
                    max={2}
                    step={0.1}
                    onChange={(e) => {
                      const max = Number(e.target.value)
                      const min = Math.min(max, scenario.initial_condition_range[0])
                      updateScenario(value, onChange, index, {
                        initial_condition_range: [min, max],
                      })
                    }}
                  />
                </label>
                <RangeField
                  label="Measurement Noise Level"
                  value={scenario.randomness_level}
                  min={0}
                  max={0.5}
                  step={0.01}
                  onChange={(randomness_level) =>
                    updateScenario(value, onChange, index, { randomness_level })
                  }
                />
                <RangeField
                  label="Input Disturbance Level"
                  value={scenario.disturbance_level}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(disturbance_level) =>
                    updateScenario(value, onChange, index, { disturbance_level })
                  }
                />
              </FieldGrid>
            </div>
          </details>
        ))}
      </div>

      <SectionHeader>Genetic Algorithm (GA) Settings</SectionHeader>
      <label className={fieldCheckbox}>
        <input
          type="checkbox"
          checked={value.enable_ga}
          onChange={(e) => updateConfig(value, onChange, { enable_ga: e.target.checked })}
        />
        Enable GA Optimization
      </label>

      {value.enable_ga && (
        <div className="rounded-lg border border-border bg-surface-muted p-3">
          <FieldGrid>
            <RangeField
              label="Population Size"
              value={value.ga_config.population_size}
              min={10}
              max={100}
              step={1}
              onChange={(population_size) =>
                onChange({
                  ...value,
                  ga_config: { ...value.ga_config, population_size },
                })
              }
            />
            <RangeField
              label="Generations"
              value={value.ga_config.num_generations}
              min={20}
              max={200}
              step={1}
              onChange={(num_generations) =>
                onChange({
                  ...value,
                  ga_config: { ...value.ga_config, num_generations },
                })
              }
            />
            <RangeField
              label="Parents Mating"
              value={value.ga_config.num_parents_mating}
              min={2}
              max={20}
              step={1}
              onChange={(num_parents_mating) =>
                onChange({
                  ...value,
                  ga_config: { ...value.ga_config, num_parents_mating },
                })
              }
            />
            <RangeField
              label="Keep Parents"
              value={value.ga_config.keep_parents}
              min={0}
              max={10}
              step={1}
              onChange={(keep_parents) =>
                onChange({
                  ...value,
                  ga_config: { ...value.ga_config, keep_parents },
                })
              }
            />
            <RangeField
              label="Crossover Probability"
              value={value.ga_config.crossover_probability}
              min={0}
              max={1}
              step={0.05}
              onChange={(crossover_probability) =>
                onChange({
                  ...value,
                  ga_config: { ...value.ga_config, crossover_probability },
                })
              }
            />
            <RangeField
              label="Mutation Probability"
              value={value.ga_config.mutation_probability}
              min={0}
              max={1}
              step={0.05}
              onChange={(mutation_probability) =>
                onChange({
                  ...value,
                  ga_config: { ...value.ga_config, mutation_probability },
                })
              }
            />
            <RangeField
              label="Evaluation Runs (Monte Carlo)"
              value={value.ga_config.num_evaluation_runs}
              min={5}
              max={50}
              step={1}
              onChange={(num_evaluation_runs) =>
                onChange({
                  ...value,
                  ga_config: { ...value.ga_config, num_evaluation_runs },
                })
              }
            />
          </FieldGrid>

          <p className="m-0 mt-4 mb-2 text-sm font-medium text-foreground">Optimization Weights</p>
          <FieldGrid>
            <NumberField
              label="MSE Weight"
              value={value.ga_config.weights.mse}
              min={0}
              max={10}
              step={0.1}
              onChange={(mse) =>
                onChange({
                  ...value,
                  ga_config: {
                    ...value.ga_config,
                    weights: { ...value.ga_config.weights, mse },
                  },
                })
              }
            />
            <NumberField
              label="Settling Weight"
              value={value.ga_config.weights.settling_time}
              min={0}
              max={1}
              step={0.01}
              onChange={(settling_time) =>
                onChange({
                  ...value,
                  ga_config: {
                    ...value.ga_config,
                    weights: { ...value.ga_config.weights, settling_time },
                  },
                })
              }
            />
            <NumberField
              label="Overshoot Weight"
              value={value.ga_config.weights.overshoot}
              min={0}
              max={1}
              step={0.001}
              onChange={(overshoot) =>
                onChange({
                  ...value,
                  ga_config: {
                    ...value.ga_config,
                    weights: { ...value.ga_config.weights, overshoot },
                  },
                })
              }
            />
            <NumberField
              label="Control Effort Weight"
              value={value.ga_config.weights.control_effort}
              min={0}
              max={0.01}
              step={0.0001}
              onChange={(control_effort) =>
                onChange({
                  ...value,
                  ga_config: {
                    ...value.ga_config,
                    weights: { ...value.ga_config.weights, control_effort },
                  },
                })
              }
            />
          </FieldGrid>
        </div>
      )}
    </div>
  )
}
