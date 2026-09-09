import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Stethoscope,
} from 'lucide-react'
import type {
  AdaptiveDiagnosis,
  AdaptiveDiagnosisOption,
  AdaptiveDiagnosisSuggestion,
  DiagnosisApplyPatch,
} from '../../api/types'
import { btnBase, btnCompact } from '../../lib/classes'

export interface AdaptiveDiagnosisViewProps {
  diagnosis?: AdaptiveDiagnosis | null
  /** When true, omit outer chrome (used inside modal that already has a header). */
  compact?: boolean
  onApplyOption?: (patch: DiagnosisApplyPatch) => void
  /** After max applies (1), hide/disable Apply buttons. */
  applyDisabled?: boolean
  /** Last user-entered run knobs (shown under suggestions). */
  currentInputs?: {
    reference?: string
    x0?: string
    solverStep?: number
    simTime?: number
  } | null
}

function asStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const s = value.trim()
    return s ? [s] : []
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean)
  }
  return []
}

function parseOptions(raw: unknown): AdaptiveDiagnosisOption[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const o = item as Record<string, unknown>
          const value = o.value
          if (value == null || !String(value).trim()) return null
          return {
            label: String(o.label ?? value).trim(),
            value: typeof value === 'number' ? value : String(value).trim(),
          } as AdaptiveDiagnosisOption
        }
        if (item != null && String(item).trim()) {
          const s = String(item).trim()
          return { label: s, value: s } as AdaptiveDiagnosisOption
        }
        return null
      })
      .filter((x): x is AdaptiveDiagnosisOption => x != null)
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v != null && String(v).trim())
      .map(([k, v]) => ({ label: k, value: String(v) }))
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    return [{ label: String(raw), value: raw }]
  }
  return []
}

function suggestionField(s: AdaptiveDiagnosisSuggestion): string | undefined {
  const lever = typeof s.lever === 'string' ? s.lever : undefined
  const field = typeof s.field === 'string' ? s.field : undefined
  return lever || field
}

function truncate(text: string, max = 160): string {
  const t = text.trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + '…'
}

function evidenceScalarEntries(evidence: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const method = evidence.method
  if (method != null) out.push(['Method', String(method)])

  const metrics = evidence.metrics
  if (metrics && typeof metrics === 'object') {
    const m = metrics as Record<string, unknown>
    for (const key of ['success_reason', 'tracking_pct_headline', 'max_u', 'tracking_rms']) {
      if (m[key] != null && typeof m[key] !== 'object') {
        out.push([key, String(m[key])])
      }
    }
  }

  if (Array.isArray(evidence.x0)) {
    out.push(['Initial state x0', evidence.x0.map(String).join(', ')])
  } else if (evidence.x0 != null && typeof evidence.x0 !== 'object') {
    out.push(['Initial state x0', String(evidence.x0)])
  }

  const tuning = evidence.tuning
  if (tuning && typeof tuning === 'object') {
    const scalars = Object.entries(tuning as Record<string, unknown>)
      .filter(([, v]) => v != null && typeof v !== 'object')
      .slice(0, 12)
    if (scalars.length) {
      out.push(['Tuning', scalars.map(([k, v]) => `${k}=${v}`).join(', ')])
    }
  }

  const refs = evidence.refs
  if (Array.isArray(refs)) {
    const bits = refs
      .map((r) => {
        if (r && typeof r === 'object') {
          const o = r as Record<string, unknown>
          return truncate(String(o.expr ?? o.reference ?? ''), 80)
        }
        return truncate(String(r), 80)
      })
      .filter(Boolean)
    if (bits.length) out.push(['References', bits.join(' · ')])
  }

  return out
}

function plantEquations(evidence: Record<string, unknown>): string | null {
  const plant = evidence.plant
  if (plant && typeof plant === 'object') {
    const p = plant as Record<string, unknown>
    if (typeof p.state_equations === 'string' && p.state_equations.trim()) {
      return p.state_equations.trim()
    }
  }
  if (typeof evidence.system_text === 'string' && evidence.system_text.trim()) {
    return evidence.system_text.trim()
  }
  if (typeof evidence.control_law_text === 'string' && evidence.control_law_text.trim()) {
    return evidence.control_law_text.trim()
  }
  return null
}

export function AdaptiveDiagnosisView({
  diagnosis,
  compact = false,
  onApplyOption,
  applyDisabled = false,
  currentInputs = null,
}: AdaptiveDiagnosisViewProps) {
  const [plantOpen, setPlantOpen] = useState(false)

  const report = diagnosis?.report
  const suggestions = useMemo(() => {
    const list = report?.suggestions
    return Array.isArray(list) ? list : []
  }, [report])

  const explanationLines = useMemo(() => asStringList(report?.explanation), [report])

  const cause =
    (typeof report?.headline === 'string' && report.headline.trim()) ||
    (typeof report?.cause === 'string' && report.cause.trim()) ||
    (typeof report?.summary === 'string' && report.summary.trim()) ||
    (typeof report?.diagnosis === 'string' && report.diagnosis.trim()) ||
    null

  const evidence = (diagnosis?.evidence && typeof diagnosis.evidence === 'object'
    ? diagnosis.evidence
    : null) as Record<string, unknown> | null

  const evidenceRows = useMemo(
    () => (evidence ? evidenceScalarEntries(evidence) : []),
    [evidence],
  )
  const plant = evidence ? plantEquations(evidence) : null

  const hasContent = Boolean(
    report && (cause || explanationLines.length || suggestions.length || report.error),
  )
  if (!diagnosis || !hasContent) return null

  const body = (
    <div className={`space-y-3 text-xs leading-relaxed ${compact ? '' : ''}`}>
      {cause && (
        <div className="flex gap-2 text-amber-950 dark:text-amber-50">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold text-sm text-foreground">{cause}</p>
            {explanationLines.length > 0 && (
              <ul className="mt-1.5 list-disc pl-4 space-y-1 text-muted-text">
                {explanationLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {!cause && explanationLines.length > 0 && (
        <ul className="list-disc pl-4 space-y-1 text-muted-text">
          {explanationLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}

      {typeof report?.error === 'string' && report.error && (
        <p className="text-red-600 dark:text-red-400">{report.error}</p>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200">
            <Lightbulb className="size-3.5" />
            Suggestions
          </div>
          <ul className="space-y-2">
            {suggestions.map((raw, i) => {
              const s = (raw || {}) as AdaptiveDiagnosisSuggestion
              const title =
                (typeof s.title === 'string' && s.title) ||
                suggestionField(s) ||
                `Suggestion ${i + 1}`
              const detail =
                [s.detail, s.rationale, s.text].find(
                  (x) => typeof x === 'string' && x.trim(),
                ) || ''
              const field = suggestionField(s)
              const options = parseOptions(s.options ?? s.values ?? s.apply_values)
              return (
                <li
                  key={`${title}-${i}`}
                  className="rounded-lg border border-amber-500/25 bg-surface/60 dark:bg-surface-elevated/40 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{title}</span>
                    {field && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono text-amber-800 dark:text-amber-200">
                        {field}
                      </span>
                    )}
                  </div>
                  {detail && <p className="mt-1 text-muted-text">{String(detail)}</p>}
                  {options.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {options.map((opt, j) => {
                        const label = String(opt.label ?? opt.value ?? '')
                        const value = opt.value
                        return (
                          <div
                            key={`${label}-${j}`}
                            className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border/80 bg-surface px-2 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="text-[11px] font-medium text-foreground">{label}</div>
                              <div className="font-mono text-[10.5px] text-amber-900 dark:text-amber-100 break-all">
                                {String(value)}
                              </div>
                            </div>
                            {onApplyOption && (
                              <button
                                type="button"
                                disabled={applyDisabled}
                                className={`${btnBase} ${btnCompact} shrink-0 text-[10.5px] border border-amber-500/40 text-amber-900 dark:text-amber-100 hover:bg-amber-500/15 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
                                title={
                                  applyDisabled
                                    ? 'Suggestion apply already used (max 1)'
                                    : 'Write this value into the run inputs'
                                }
                                onClick={() =>
                                  onApplyOption({
                                    field,
                                    lever: field,
                                    label,
                                    value,
                                  })
                                }
                              >
                                {applyDisabled ? 'Applied' : 'Apply'}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {currentInputs && (
        <div className="space-y-1.5 border-t border-amber-500/20 pt-2">
          <div className="font-semibold text-amber-800 dark:text-amber-200">Last user inputs</div>
          <p className="text-[11px] text-muted-text">
            Values currently on the run form (updated when you Apply a suggestion).
          </p>
          <dl className="grid grid-cols-1 gap-1 sm:grid-cols-[auto_1fr] text-[11px]">
            {currentInputs.reference != null && currentInputs.reference !== '' && (
              <>
                <dt className="text-muted-text font-medium">Reference</dt>
                <dd className="font-mono text-foreground break-all">{currentInputs.reference}</dd>
              </>
            )}
            {currentInputs.x0 != null && currentInputs.x0 !== '' && (
              <>
                <dt className="text-muted-text font-medium">Initial state x0</dt>
                <dd className="font-mono text-foreground break-all">{currentInputs.x0}</dd>
              </>
            )}
            {currentInputs.solverStep != null && (
              <>
                <dt className="text-muted-text font-medium">Solver step</dt>
                <dd className="font-mono text-foreground">{String(currentInputs.solverStep)}</dd>
              </>
            )}
            {currentInputs.simTime != null && (
              <>
                <dt className="text-muted-text font-medium">Sim time</dt>
                <dd className="font-mono text-foreground">{String(currentInputs.simTime)}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {(evidenceRows.length > 0 || plant) && (
        <div className="space-y-2 border-t border-amber-500/20 pt-2">
          <div className="font-semibold text-amber-800 dark:text-amber-200">Evidence summary</div>
          {evidenceRows.length > 0 && (
            <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-[auto_1fr]">
              {evidenceRows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-text font-medium">{k}</dt>
                  <dd className="text-foreground break-words font-mono text-[10.5px] sm:font-sans sm:text-xs">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {plant && (
            <div>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-200 hover:underline"
                onClick={() => setPlantOpen((v) => !v)}
              >
                {plantOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                Plant &amp; equations
              </button>
              {plantOpen ? (
                <pre className="mt-1.5 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto rounded-lg border border-border bg-surface p-2 text-[10.5px] text-muted-text">
                  {plant}
                </pre>
              ) : (
                <p className="mt-1 text-[11px] text-muted-text font-mono">{truncate(plant, 120)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (compact) return body

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
      <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200">
        <Stethoscope className="size-4 shrink-0" />
        Diagnoser
        <span className="font-normal text-amber-700/80 dark:text-amber-300/80">
          (failed or missed-target run)
        </span>
      </div>
      {body}
    </div>
  )
}
