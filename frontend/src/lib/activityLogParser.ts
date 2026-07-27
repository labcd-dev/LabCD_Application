import { cleanStatusLabel } from './statusText'
import { extractJsonFromResponse } from './llmResponseParser'

export type AgentKind =
  | 'equation'
  | 'system_analysis'
  | 'control_loop_analysis'
  | 'control_loop'
  | 'supervisor'
  | 'web_search'
  | 'image_recognition'
  | 'block_diagram'
  | 'unknown'

export interface SupervisorAuditItem {
  check: string
  result: 'pass' | 'fail' | 'unknown'
  detail: string
}

export interface ParsedSupervisor {
  status: 'passed' | 'failed' | 'unknown'
  flag?: string
  auditLog: SupervisorAuditItem[]
  feedback?: string
}

export interface VariableRow {
  [key: string]: string | number | undefined
}

export interface ParsedSystemAnalysis {
  system_name?: string
  description?: string
  system_properties?: Record<string, unknown>
  inputs?: VariableRow[]
  outputs?: VariableRow[]
  state_variables?: VariableRow[]
}

export interface ControllerInfo {
  controlled_variable?: string
  controlled_variable_in_equation?: string
  setpoint_variable_in_equation?: string
  output_signal?: string
  output_variable_in_equation?: string
  output_unit?: string
  input_unit?: string
}

export interface ParsedControlLoop {
  control_architecture?: string
  pid_loops?: Array<{
    loop_number?: number
    loop_name?: string
    controllers?: ControllerInfo[]
  }>
}

export interface ReasoningSection {
  type: 'text' | 'json'
  content: string
  data?: Record<string, unknown>
}

export type ParsedLogContent =
  | { kind: 'code'; code: string }
  | { kind: 'image'; url: string }
  | { kind: 'system_analysis'; data: ParsedSystemAnalysis }
  | { kind: 'control_loop'; data: ParsedControlLoop }
  | { kind: 'supervisor'; data: ParsedSupervisor }
  | { kind: 'reasoning'; sections: ReasoningSection[] }
  | { kind: 'json'; data: Record<string, unknown> }
  | { kind: 'text'; text: string }

export function resolveAgentKind(agentTag: string): AgentKind {
  const label = cleanStatusLabel(agentTag).toLowerCase()

  if (label.includes('equation')) return 'equation'
  if (label.includes('system analysis')) return 'system_analysis'
  if (label.includes('control loop analysis')) return 'control_loop_analysis'
  if (label.includes('control loop')) return 'control_loop'
  if (label.includes('supervisor')) return 'supervisor'
  if (label.includes('web search')) return 'web_search'
  if (label.includes('image recognition')) return 'image_recognition'
  if (label.includes('block diagram')) return 'block_diagram'
  return 'unknown'
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (typeof content === 'object' && 'log_history' in (content as Record<string, unknown>)) {
    const nested = (content as Record<string, unknown>).log_history
    if (typeof nested === 'string') return nested
    if (nested == null) return ''
    try {
      return JSON.stringify(nested, null, 2)
    } catch {
      return String(nested)
    }
  }
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

function isNoneOrFailedArchitecture(json: Record<string, unknown>): boolean {
  const architecture =
    typeof json.control_architecture === 'string' ? json.control_architecture.toUpperCase() : ''
  const flag = typeof json.flag === 'string' ? json.flag.toUpperCase() : ''
  return flag === 'FAILED' || architecture === 'NONE' || architecture === 'FAILED'
}

function isNullishText(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  return trimmed === '' || trimmed === 'none' || trimmed === 'null'
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/^```(?:json|plaintext|text)?\s*([\s\S]*?)```\s*$/i)
  return fenced ? fenced[1].trim() : text.trim()
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const stripped = stripCodeFences(text.trim())
  const fromExtractor = extractJsonFromResponse(stripped)
  if (fromExtractor) return fromExtractor

  try {
    const parsed = JSON.parse(stripped)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function parseAuditResult(value: string): SupervisorAuditItem['result'] {
  const lower = value.toLowerCase()
  if (lower.startsWith('pass')) return 'pass'
  if (lower.startsWith('fail')) return 'fail'
  return 'unknown'
}

export function parseSupervisor(text: string): ParsedSupervisor {
  const body = stripCodeFences(text)
  const statusMatch = body.match(/STATUS:\s*(PASSED|FAILED)/i)
  const flagMatch = body.match(/FLAG:\s*(.+)/i)
  const feedbackMatch = body.match(/FEEDBACK:\s*([\s\S]+?)(?:\n\s*$|$)/i)

  const auditStart = body.search(/AUDIT_LOG:/i)
  const feedbackStart = body.search(/FEEDBACK:/i)
  let auditBlock = ''
  if (auditStart !== -1) {
    const end = feedbackStart !== -1 && feedbackStart > auditStart ? feedbackStart : body.length
    auditBlock = body.slice(auditStart, end)
  }

  const auditLog: SupervisorAuditItem[] = []
  for (const line of auditBlock.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('-')) continue
    const match = trimmed.match(/^-\s*([^:]+):\s*(Pass|Fail)\s*-\s*(.+)$/i)
    if (!match) continue
    auditLog.push({
      check: match[1].trim(),
      result: parseAuditResult(match[2]),
      detail: match[3].trim(),
    })
  }

  const statusRaw = statusMatch?.[1]?.toLowerCase()
  return {
    status: statusRaw === 'passed' ? 'passed' : statusRaw === 'failed' ? 'failed' : 'unknown',
    flag: flagMatch?.[1]?.trim(),
    auditLog,
    feedback: feedbackMatch?.[1]?.trim(),
  }
}

function parseReasoningSections(text: string): ReasoningSection[] {
  const sections: ReasoningSection[] = []
  const pattern = /```(?:json|plaintext|text)?\s*([\s\S]*?)```/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim()
    if (before) sections.push({ type: 'text', content: before })

    const block = match[1].trim()
    const json = tryParseJson(block)
    if (json) sections.push({ type: 'json', content: block, data: json })
    else sections.push({ type: 'text', content: block })

    lastIndex = pattern.lastIndex
  }

  const tail = text.slice(lastIndex).trim()
  if (tail) sections.push({ type: 'text', content: tail })

  if (sections.length === 0) sections.push({ type: 'text', content: text.trim() })
  return sections
}

function asSystemAnalysis(data: Record<string, unknown>): ParsedSystemAnalysis {
  return {
    system_name: typeof data.system_name === 'string' ? data.system_name : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    system_properties:
      typeof data.system_properties === 'object' && data.system_properties !== null
        ? (data.system_properties as Record<string, unknown>)
        : undefined,
    inputs: Array.isArray(data.inputs) ? (data.inputs as VariableRow[]) : undefined,
    outputs: Array.isArray(data.outputs) ? (data.outputs as VariableRow[]) : undefined,
    state_variables: Array.isArray(data.state_variables)
      ? (data.state_variables as VariableRow[])
      : undefined,
  }
}

function asControlLoop(data: Record<string, unknown>): ParsedControlLoop {
  return {
    control_architecture:
      typeof data.control_architecture === 'string' ? data.control_architecture : undefined,
    pid_loops: Array.isArray(data.pid_loops)
      ? (data.pid_loops as ParsedControlLoop['pid_loops'])
      : undefined,
  }
}

export function parseLogContent(content: unknown, agentKind: AgentKind): ParsedLogContent {
  const text = normalizeContent(content)

  if (agentKind === 'equation') {
    return { kind: 'code', code: text }
  }

  if (agentKind === 'block_diagram' && /^https?:\/\//i.test(text.trim())) {
    return { kind: 'image', url: text.trim() }
  }

  if (agentKind === 'supervisor') {
    return { kind: 'supervisor', data: parseSupervisor(text) }
  }

  if (agentKind === 'control_loop_analysis') {
    return { kind: 'reasoning', sections: parseReasoningSections(text) }
  }

  // Image recognition sometimes yields null/empty/"NONE" — always surface JSON when possible.
  if (agentKind === 'image_recognition' && isNullishText(text)) {
    return {
      kind: 'json',
      data: {
        flag: 'FAILED',
        message: 'Image recognition result was null or empty',
        control_architecture: 'NONE',
        pid_loops: [],
      },
    }
  }

  const json = tryParseJson(text)
  if (json) {
    if (agentKind === 'system_analysis' || 'system_properties' in json || 'state_variables' in json) {
      return { kind: 'system_analysis', data: asSystemAnalysis(json) }
    }
    // Prefer raw JSON for image recognition and NONE/FAILED architectures.
    if (agentKind === 'image_recognition' || isNoneOrFailedArchitecture(json)) {
      return { kind: 'json', data: json }
    }
    if (agentKind === 'control_loop' || 'pid_loops' in json || 'control_architecture' in json) {
      return { kind: 'control_loop', data: asControlLoop(json) }
    }
    return { kind: 'json', data: json }
  }

  if (agentKind === 'system_analysis' || agentKind === 'control_loop') {
    const fallbackJson = extractJsonFromResponse(text)
    if (fallbackJson) {
      if (agentKind === 'system_analysis') {
        return { kind: 'system_analysis', data: asSystemAnalysis(fallbackJson) }
      }
      if (isNoneOrFailedArchitecture(fallbackJson)) {
        return { kind: 'json', data: fallbackJson }
      }
      return { kind: 'control_loop', data: asControlLoop(fallbackJson) }
    }
  }

  return { kind: 'text', text }
}

export function logEntrySummary(parsed: ParsedLogContent, agentKind: AgentKind): string | null {
  if (parsed.kind === 'supervisor') {
    if (parsed.data.status === 'passed') return 'Validation passed'
    if (parsed.data.status === 'failed') return 'Validation failed'
    return null
  }
  if (parsed.kind === 'system_analysis' && parsed.data.system_name) {
    return parsed.data.system_name
  }
  if (parsed.kind === 'control_loop' && parsed.data.control_architecture) {
    const loopCount = parsed.data.pid_loops?.length ?? 0
    return `${parsed.data.control_architecture}${loopCount ? ` · ${loopCount} loop${loopCount === 1 ? '' : 's'}` : ''}`
  }
  if (parsed.kind === 'json') {
    const flag = typeof parsed.data.flag === 'string' ? parsed.data.flag : null
    const architecture =
      typeof parsed.data.control_architecture === 'string' ? parsed.data.control_architecture : null
    if (flag) return flag
    if (architecture) return architecture
    if (agentKind === 'image_recognition') return 'JSON result'
  }
  if (agentKind === 'equation') return 'Standardized equations'
  return null
}
