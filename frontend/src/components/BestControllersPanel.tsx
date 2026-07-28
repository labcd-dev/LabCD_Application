import { useMemo, useState } from 'react'
import {
  extractScenarioBestResults,
  hasBestControllerData,
  parseBestControllerEntries,
  type BestControllerEntry,
} from '../lib/bestControllers'
import { formatScorePercent } from '../lib/scenarioMetrics'
import { badgeStyles, btnBase, cardPanel, fieldInput, mutedText } from '../lib/classes'
import { CodePreview } from './CodePreview'

const EXPORT_FORMATS = ['MATLAB (.m)', 'Python (.py)', 'Simulink (.slx)', 'JSON'] as const

interface BestControllersPanelProps {
  currentState?: Record<string, unknown> | null
  stateHistory?: Array<Record<string, unknown>> | unknown
}

export function BestControllersPanel({
  currentState,
  stateHistory,
}: BestControllersPanelProps) {
  const bestResults = useMemo(
    () => extractScenarioBestResults(currentState, stateHistory),
    [currentState, stateHistory],
  )
  const entries = useMemo(() => parseBestControllerEntries(bestResults), [bestResults])

  if (!hasBestControllerData(bestResults)) {
    return (
      <p className={mutedText}>
        No best-controller data available yet. Run a design to completion to see results.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="m-0 text-base font-semibold text-foreground">
        Best Controllers per Scenario
      </h3>
      {entries.map((entry) =>
        'missing' in entry ? (
          <div key={`missing-${entry.scenarioLevel}`} className={cardPanel}>
            <p className="m-0 text-sm text-[var(--app-status-warning-text)]">
              Scenario {entry.scenarioLevel} — No valid controller found.
            </p>
          </div>
        ) : (
          <BestControllerCard key={`best-${entry.scenarioLevel}`} entry={entry} />
        ),
      )}
    </div>
  )
}

function BestControllerCard({ entry }: { entry: BestControllerEntry }) {
  const [format, setFormat] = useState<(typeof EXPORT_FORMATS)[number]>('JSON')
  const [stagedPayload, setStagedPayload] = useState<string | null>(null)

  const stageExport = () => {
    const payload = {
      scenario_level: entry.scenarioLevel,
      controller_type: entry.controllerType,
      gains: entry.gains,
      performance_metrics: entry.bestMetrics,
      target_format: format,
    }
    setStagedPayload(JSON.stringify(payload, null, 2))
  }

  return (
    <div className={`${cardPanel} flex flex-col gap-4 lg:flex-row lg:items-start`}>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h4 className="m-0 text-sm font-semibold text-foreground">
            Scenario {entry.scenarioLevel} — Controller:{' '}
            <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
              {entry.controllerType}
            </code>
          </h4>
          <p className="mt-1 mb-0 text-sm text-muted-text">
            Success Score: <strong>{formatScorePercent(entry.score)}</strong>
            {' | '}
            Stable:{' '}
            <span
              className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                entry.stable ? badgeStyles.continue : badgeStyles.terminate
              }`}
            >
              {entry.stable ? 'Yes' : 'No'}
            </span>
            {' | '}
            Best MSE:{' '}
            {entry.mse === null || !Number.isFinite(entry.mse) ? '∞' : entry.mse.toFixed(4)}
          </p>
        </div>

        {Object.keys(entry.gains).length > 0 ? (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-label">
              Optimal Gains
            </div>
            <CodePreview value={JSON.stringify(entry.gains, null, 2)} readOnly />
          </div>
        ) : (
          <p className={`m-0 text-sm ${mutedText}`}>No gain parameters recorded.</p>
        )}
      </div>

      <div className="w-full shrink-0 space-y-2 lg:w-56">
        <div className="text-xs font-semibold uppercase tracking-wide text-label">
          Export Placeholder
        </div>
        <select
          className={fieldInput}
          value={format}
          onChange={(event) =>
            setFormat(event.target.value as (typeof EXPORT_FORMATS)[number])
          }
          aria-label={`Export format for scenario ${entry.scenarioLevel}`}
        >
          {EXPORT_FORMATS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button type="button" className={`${btnBase} w-full`} onClick={stageExport}>
          Stage Export
        </button>
        {stagedPayload && (
          <div className="space-y-1">
            <p className="m-0 text-xs text-[var(--app-status-success-text)]">
              Staged for {format} export.
            </p>
            <CodePreview value={stagedPayload} readOnly />
          </div>
        )}
      </div>
    </div>
  )
}
