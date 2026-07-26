import { useEffect } from 'react'
import { BrainCircuit } from 'lucide-react'
import { fieldInput, fieldLabel } from '../lib/classes'

interface ModelSelectProps {
  models: string[]
  value: string
  onChange: (model: string) => void
  label?: string
  disabled?: boolean
  hint?: string
}

export function ModelSelect({
  models,
  value,
  onChange,
  label = 'LLM Model',
  disabled = false,
  hint,
}: ModelSelectProps) {
  useEffect(() => {
    if (disabled) return
    if (models.length > 0 && !models.includes(value)) {
      onChange(models[0])
    }
  }, [models, value, onChange, disabled])

  const options = models.includes(value) || !value ? models : [value, ...models]

  return (
    <label className={fieldLabel}>
      <span className="inline-flex items-center gap-1.5">
        <BrainCircuit className="size-4 text-primary" aria-hidden />
        {label}
      </span>
      <select
        className={fieldInput}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
      {hint && <span className="text-sm text-muted-text">{hint}</span>}
    </label>
  )
}
