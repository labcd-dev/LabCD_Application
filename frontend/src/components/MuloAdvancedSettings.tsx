import { useState } from 'react'
import { ModelSelect } from './ModelSelect'
import type { MuloRunConfig } from '../lib/muloDesignConfig'
import { cardPanel, fieldCheckbox, fieldInput, fieldLabel } from '../lib/classes'

interface MuloAdvancedSettingsProps {
  value: MuloRunConfig
  onChange: (value: MuloRunConfig) => void
  models: string[]
  webSearchModels: string[]
  llmModelLocked?: boolean
}

export function MuloAdvancedSettings({
  value,
  onChange,
  models,
  webSearchModels,
  llmModelLocked = false,
}: MuloAdvancedSettingsProps) {
  const [expanded, setExpanded] = useState(false)
  const [enableWebSearch, setEnableWebSearch] = useState(value.web_search_model !== null)

  const update = (patch: Partial<MuloRunConfig>) => onChange({ ...value, ...patch })

  return (
    <div className={cardPanel}>
      <button
        type="button"
        className="w-full text-left font-semibold text-foreground bg-transparent border-0 p-0 cursor-pointer"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? '▾' : '▸'} Advanced Settings
      </button>

      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="flex flex-col gap-3">
            <ModelSelect
              models={llmModelLocked ? [value.llm_model] : models}
              value={value.llm_model}
              onChange={(llm_model) => update({ llm_model })}
              label="LLM Model"
              disabled={llmModelLocked}
              hint={
                llmModelLocked
                  ? 'Locked when the project was created in Control Design Setup.'
                  : undefined
              }
            />

            <label className={fieldLabel}>
              <span>Max Attempts</span>
              <input
                type="number"
                className={fieldInput}
                min={1}
                max={20}
                value={value.max_attempts}
                onChange={(e) => update({ max_attempts: Number(e.target.value) })}
              />
            </label>

            <label className={fieldLabel}>
              <span>History Buffer Size</span>
              <input
                type="number"
                className={fieldInput}
                min={1}
                max={10}
                value={value.buffer_size}
                onChange={(e) => update({ buffer_size: Number(e.target.value) })}
              />
            </label>

            <label className={`${fieldCheckbox} flex items-center gap-2`}>
              <input
                type="checkbox"
                checked={enableWebSearch}
                onChange={(e) => {
                  setEnableWebSearch(e.target.checked)
                  update({ web_search_model: e.target.checked ? webSearchModels[0] ?? null : null })
                }}
              />
              Enable online search
            </label>

            {enableWebSearch && (
              <ModelSelect
                models={webSearchModels}
                value={value.web_search_model ?? webSearchModels[0] ?? ''}
                onChange={(web_search_model) => update({ web_search_model })}
                label="Web Search Model"
              />
            )}
          </div>

          <div className="flex flex-col gap-3">
            <label className={fieldLabel}>
              <span>Max Wall Clock (s)</span>
              <input
                type="number"
                className={fieldInput}
                min={10}
                max={7200}
                step={10}
                value={value.max_wall_clock}
                onChange={(e) => update({ max_wall_clock: Number(e.target.value) })}
              />
            </label>

            <label className={fieldLabel}>
              <span>Max Cost Budget ($)</span>
              <input
                type="number"
                className={fieldInput}
                min={0.001}
                max={10}
                step={0.01}
                value={value.max_cost_budget}
                onChange={(e) => update({ max_cost_budget: Number(e.target.value) })}
              />
            </label>

            <label className={fieldLabel}>
              <span>Prompt Variant</span>
              <select
                className={fieldInput}
                value={value.prompt_variant}
                onChange={(e) =>
                  update({ prompt_variant: e.target.value as MuloRunConfig['prompt_variant'] })
                }
              >
                <option value="elaborate">elaborate</option>
                <option value="concise">concise</option>
              </select>
            </label>
          </div>

          <label className={`${fieldLabel} md:col-span-2`}>
            <span>Control Objective Statement</span>
            <textarea
              className={fieldInput}
              rows={4}
              value={value.control_objective}
              onChange={(e) => update({ control_objective: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  )
}
