import type { ReactNode } from 'react'
import { cardPanel } from '../lib/classes'
import { JsonViewer } from './JsonViewer'

interface EquilibriumPayload {
  system?: {
    name?: string
    n_states?: number
    n_inputs?: number
    n_outputs?: number
    state_variables?: string[]
    input_variables?: string[]
    parameters?: Record<string, number | string>
  }
  equilibrium?: {
    x_e?: number[]
    u_e?: number[]
    y_e?: number[]
  }
  linearized?: {
    A?: number[][]
    B?: number[][]
    C?: number[][]
    D?: number[][]
  }
  stability?: {
    eigenvalues?: string[]
    classification?: string
  }
  diagnostics?: {
    converged?: boolean
    feasible?: boolean
    equilibrium_match?: boolean
    timestamp?: string
  }
}

interface TrimmerEquilibriumResultsProps {
  result: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseResult(raw: unknown): EquilibriumPayload {
  const root = asRecord(raw) ?? {}
  return {
    system: asRecord(root.system) as EquilibriumPayload['system'],
    equilibrium: asRecord(root.equilibrium) as EquilibriumPayload['equilibrium'],
    linearized: asRecord(root.linearized) as EquilibriumPayload['linearized'],
    stability: asRecord(root.stability) as EquilibriumPayload['stability'],
    diagnostics: asRecord(root.diagnostics) as EquilibriumPayload['diagnostics'],
  }
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return value.toExponential(3)
  return Number(value.toFixed(6)).toString()
}

function BoolBadge({ label, ok }: { label: string; ok?: boolean }) {
  const tone =
    ok === true
      ? 'bg-[var(--app-status-success-bg)] text-[var(--app-status-success-text)]'
      : ok === false
        ? 'bg-[var(--app-status-error-bg)] text-[var(--app-status-error-text)]'
        : 'bg-muted text-foreground-secondary'

  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {label}: {ok === true ? 'Yes' : ok === false ? 'No' : '—'}
    </span>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${cardPanel} space-y-3`}>
      <h4 className="m-0 text-sm font-semibold uppercase tracking-wide text-label">{title}</h4>
      {children}
    </section>
  )
}

function VectorTable({
  title,
  values,
  labels,
}: {
  title: string
  values?: number[]
  labels?: string[]
}) {
  if (!values || values.length === 0) return null

  return (
    <div>
      <div className="mb-2 text-sm font-medium text-foreground">{title}</div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-hover text-left text-foreground-secondary">
              <th className="px-3 py-2 font-medium">Variable</th>
              <th className="px-3 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {values.map((value, index) => (
              <tr key={`${title}-${index}`} className="border-t border-border">
                <td className="px-3 py-2 text-foreground-secondary">
                  {labels?.[index] ?? `${title}[${index}]`}
                </td>
                <td className="px-3 py-2 font-mono text-foreground">{formatNumber(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MatrixTable({ name, matrix }: { name: string; matrix?: number[][] }) {
  if (!matrix || matrix.length === 0) return null

  const cols = Math.max(...matrix.map((row) => row.length), 0)

  return (
    <div>
      <div className="mb-2 text-sm font-medium text-foreground">{name}</div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse font-mono text-xs sm:text-sm">
          <tbody>
            {matrix.map((row, rowIndex) => (
              <tr key={`${name}-r${rowIndex}`} className="border-t border-border first:border-t-0">
                {Array.from({ length: cols }, (_, colIndex) => (
                  <td key={`${name}-r${rowIndex}-c${colIndex}`} className="px-3 py-2 text-center text-foreground">
                    {row[colIndex] === undefined ? '—' : formatNumber(row[colIndex])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function TrimmerEquilibriumResults({ result }: TrimmerEquilibriumResultsProps) {
  const data = parseResult(result)
  const system = data.system ?? {}
  const equilibrium = data.equilibrium ?? {}
  const linearized = data.linearized ?? {}
  const stability = data.stability ?? {}
  const diagnostics = data.diagnostics ?? {}

  const classification = stability.classification ?? 'unknown'
  const classificationTone = /unstable/i.test(classification)
    ? 'bg-[var(--app-status-error-bg)] text-[var(--app-status-error-text)]'
    : /stable/i.test(classification)
      ? 'bg-[var(--app-status-success-bg)] text-[var(--app-status-success-text)]'
      : 'bg-[var(--app-status-warning-bg)] text-[var(--app-status-warning-text)]'

  const params = system.parameters ?? {}
  const paramEntries = Object.entries(params)

  return (
    <div className="space-y-4">
      <Section title="System">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-xs text-foreground-secondary">Name</div>
            <div className="mt-0.5 text-sm font-semibold text-foreground break-all">
              {system.name ?? '—'}
            </div>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-xs text-foreground-secondary">States</div>
            <div className="mt-0.5 text-lg font-semibold text-foreground">{system.n_states ?? '—'}</div>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-xs text-foreground-secondary">Inputs</div>
            <div className="mt-0.5 text-lg font-semibold text-foreground">{system.n_inputs ?? '—'}</div>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-xs text-foreground-secondary">Outputs</div>
            <div className="mt-0.5 text-lg font-semibold text-foreground">{system.n_outputs ?? '—'}</div>
          </div>
        </div>

        {(system.state_variables?.length || system.input_variables?.length) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {system.state_variables && system.state_variables.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-label">
                  State variables
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {system.state_variables.map((name) => (
                    <span
                      key={name}
                      className="rounded-md border border-border bg-surface-hover px-2 py-1 text-xs text-foreground"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {system.input_variables && system.input_variables.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-label">
                  Input variables
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {system.input_variables.map((name) => (
                    <span
                      key={name}
                      className="rounded-md border border-border bg-surface-hover px-2 py-1 text-xs text-foreground"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {paramEntries.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-label">
              Parameters
            </div>
            <div className="flex flex-wrap gap-2">
              {paramEntries.map(([key, value]) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs"
                >
                  <span className="text-foreground-secondary">{key}</span>
                  <span className="font-mono font-semibold text-foreground">
                    {typeof value === 'number' ? formatNumber(value) : String(value)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Equilibrium">
        <div className="grid gap-4 lg:grid-cols-3">
          <VectorTable
            title="x_e"
            values={equilibrium.x_e}
            labels={system.state_variables}
          />
          <VectorTable
            title="u_e"
            values={equilibrium.u_e}
            labels={system.input_variables}
          />
          <VectorTable title="y_e" values={equilibrium.y_e} />
        </div>
      </Section>

      <Section title="Stability">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${classificationTone}`}>
            {classification}
          </span>
        </div>
        {stability.eigenvalues && stability.eigenvalues.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-hover text-left text-foreground-secondary">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Eigenvalue</th>
                </tr>
              </thead>
              <tbody>
                {stability.eigenvalues.map((value, index) => (
                  <tr key={`eig-${index}`} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground-secondary">{index + 1}</td>
                    <td className="px-3 py-2 font-mono text-foreground">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Diagnostics">
        <div className="flex flex-wrap gap-2">
          <BoolBadge label="Converged" ok={diagnostics.converged} />
          <BoolBadge label="Feasible" ok={diagnostics.feasible} />
          <BoolBadge label="Equilibrium match" ok={diagnostics.equilibrium_match} />
        </div>
        {diagnostics.timestamp && (
          <div className="text-xs text-foreground-secondary">
            Timestamp: {diagnostics.timestamp}
          </div>
        )}
      </Section>

      <Section title="Linearized model">
        <div className="grid gap-4 lg:grid-cols-2">
          <MatrixTable name="A" matrix={linearized.A} />
          <MatrixTable name="B" matrix={linearized.B} />
          <MatrixTable name="C" matrix={linearized.C} />
          <MatrixTable name="D" matrix={linearized.D} />
        </div>
      </Section>

      <JsonViewer data={result} title="Raw JSON" />
    </div>
  )
}
