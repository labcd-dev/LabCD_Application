import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import {
  type ControllerInfo,
  type ParsedControlLoop,
  type ParsedLogContent,
  type ParsedSupervisor,
  type ParsedSystemAnalysis,
  type ReasoningSection,
  type VariableRow,
} from '../lib/activityLogParser'
import { badgeStyles, cardPanel, codeBlock, logPre, mutedText } from '../lib/classes'

interface ActivityLogContentProps {
  parsed: ParsedLogContent
}

export function ActivityLogContent({ parsed }: ActivityLogContentProps) {
  switch (parsed.kind) {
    case 'code':
      return <pre className={codeBlock}>{parsed.code}</pre>
    case 'image':
      return (
        <figure className="space-y-2">
          <img
            src={parsed.url}
            alt="Block diagram reference"
            className="max-w-full rounded-lg border border-border"
          />
          <figcaption className={`${mutedText} text-xs break-all`}>{parsed.url}</figcaption>
        </figure>
      )
    case 'system_analysis':
      return <SystemAnalysisView data={parsed.data} />
    case 'control_loop':
      return <ControlLoopView data={parsed.data} />
    case 'supervisor':
      return <SupervisorView data={parsed.data} />
    case 'reasoning':
      return <ReasoningView sections={parsed.sections} />
    case 'json':
      return <pre className={logPre}>{JSON.stringify(parsed.data, null, 2)}</pre>
    case 'text':
      return <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground-secondary">{parsed.text}</p>
  }
}

function PropertyChips({ properties }: { properties?: Record<string, unknown> }) {
  if (!properties) return null
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(properties).map(([key, value]) => (
        <span
          key={key}
          className="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-foreground-secondary capitalize"
        >
          {key.replace(/_/g, ' ')}: {String(value)}
        </span>
      ))}
    </div>
  )
}

function VariableTable({ title, rows }: { title: string; rows?: VariableRow[] }) {
  if (!rows?.length) return null

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key))
      return set
    }, new Set<string>()),
  )

  const columnLabels: Record<string, string> = {
    physical_meaning: 'Meaning',
    variable_name: 'Name',
    variable_in_equation: 'In equation',
    unit: 'Unit',
  }

  return (
    <div className="space-y-2">
      <h5 className="text-sm font-semibold text-foreground m-0">{title}</h5>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-3 py-2 font-medium text-foreground-secondary">
                  {columnLabels[col] ?? col.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-border">
                {columns.map((col) => (
                  <td key={col} className="px-3 py-2 text-foreground-secondary">
                    {String(row[col] ?? '—')}
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

function SystemAnalysisView({ data }: { data: ParsedSystemAnalysis }) {
  return (
    <div className="space-y-4">
      {data.system_name && (
        <div>
          <h4 className="text-base font-semibold text-foreground m-0">{data.system_name}</h4>
          {data.description && (
            <p className="text-sm text-muted-text mt-1 mb-0 leading-relaxed">{data.description}</p>
          )}
        </div>
      )}
      <PropertyChips properties={data.system_properties} />
      <VariableTable title="Inputs" rows={data.inputs} />
      <VariableTable title="Outputs" rows={data.outputs} />
      <VariableTable title="State variables" rows={data.state_variables} />
    </div>
  )
}

function ControllerCard({ controller, index }: { controller: ControllerInfo; index: number }) {
  const fields: Array<[string, string | undefined]> = [
    ['Controlled variable', controller.controlled_variable],
    ['In equation', controller.controlled_variable_in_equation],
    ['Setpoint', controller.setpoint_variable_in_equation],
    ['Output signal', controller.output_signal],
    ['Output', controller.output_variable_in_equation],
    ['Input unit', controller.input_unit],
    ['Output unit', controller.output_unit],
  ]

  return (
    <div className={`${cardPanel} p-3 space-y-2`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-text m-0">
        Controller {index + 1}
      </p>
      <dl className="grid gap-1.5 text-sm m-0">
        {fields
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[minmax(0,9rem)_1fr] sm:gap-2">
              <dt className="text-xs text-muted-text sm:text-sm">{label}</dt>
              <dd className="m-0 break-all font-mono text-[0.82rem] text-foreground">{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}

function ControlLoopView({ data }: { data: ParsedControlLoop }) {
  return (
    <div className="space-y-4">
      {data.control_architecture && (
        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${badgeStyles.strategy}`}>
          {data.control_architecture}
        </span>
      )}
      {data.pid_loops?.map((loop, loopIndex) => (
        <div key={loopIndex} className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {loop.loop_number != null && (
              <span className="text-xs font-bold text-primary">Loop {loop.loop_number}</span>
            )}
            {loop.loop_name && (
              <span className="text-sm font-medium text-foreground">{loop.loop_name.replace(/_/g, ' ')}</span>
            )}
          </div>
          <div className="grid gap-2">
            {loop.controllers?.map((controller, index) => (
              <ControllerCard key={index} controller={controller} index={index} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function AuditIcon({ result }: { result: 'pass' | 'fail' | 'unknown' }) {
  if (result === 'pass') return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
  if (result === 'fail') return <XCircle className="size-4 shrink-0 text-red-600" aria-hidden />
  return <MinusCircle className="size-4 shrink-0 text-muted-text" aria-hidden />
}

function SupervisorView({ data }: { data: ParsedSupervisor }) {
  const statusBadge =
    data.status === 'passed'
      ? badgeStyles.continue
      : data.status === 'failed'
        ? badgeStyles.terminate
        : badgeStyles.strategy

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {data.status !== 'unknown' && (
          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusBadge}`}>
            {data.status === 'passed' ? 'Passed' : 'Failed'}
          </span>
        )}
        {data.flag && (
          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-surface-muted text-foreground-secondary">
            {data.flag}
          </span>
        )}
      </div>

      {data.auditLog.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-semibold text-foreground m-0">Audit checks</h5>
          <ul className="space-y-2 m-0 p-0 list-none">
            {data.auditLog.map((item) => (
              <li
                key={item.check}
                className={`flex gap-2 items-start rounded-lg border px-3 py-2 text-sm ${
                  item.result === 'pass'
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30'
                    : item.result === 'fail'
                      ? 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30'
                      : 'border-border bg-surface-muted/40'
                }`}
              >
                <AuditIcon result={item.result} />
                <div className="min-w-0">
                  <p className="font-medium text-foreground m-0">{item.check}</p>
                  <p className="text-muted-text mt-0.5 mb-0 leading-relaxed">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.feedback && (
        <div className="rounded-lg border border-border bg-surface-muted/30 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-text m-0 mb-1">Feedback</p>
          <p className="text-sm leading-relaxed text-foreground-secondary m-0">{data.feedback}</p>
        </div>
      )}
    </div>
  )
}

function ReasoningView({ sections }: { sections: ReasoningSection[] }) {
  return (
    <div className="space-y-3">
      {sections.map((section, index) => {
        if (section.type === 'json' && section.data) {
          if ('pid_loops' in section.data || 'control_architecture' in section.data) {
            return (
              <ControlLoopView
                key={index}
                data={{
                  control_architecture:
                    typeof section.data.control_architecture === 'string'
                      ? section.data.control_architecture
                      : undefined,
                  pid_loops: Array.isArray(section.data.pid_loops)
                    ? (section.data.pid_loops as ParsedControlLoop['pid_loops'])
                    : undefined,
                }}
              />
            )
          }

          return (
            <details key={index} className={`${cardPanel} p-3`} open={index === sections.length - 1}>
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Structured output
              </summary>
              <pre className={`${logPre} mt-2`}>{JSON.stringify(section.data, null, 2)}</pre>
            </details>
          )
        }

        return (
          <p
            key={index}
            className="text-sm leading-relaxed whitespace-pre-wrap text-foreground-secondary m-0"
          >
            {section.content}
          </p>
        )
      })}
    </div>
  )
}
