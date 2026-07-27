import { useMemo, useState } from 'react'
import { Activity, ChevronDown, ChevronRight } from 'lucide-react'
import {
  logEntrySummary,
  parseLogContent,
  resolveAgentKind,
} from '../lib/activityLogParser'
import { cardPanel, mutedText } from '../lib/classes'
import { ActivityLogContent } from './ActivityLogContent'
import { StatusLabel } from './StatusLabel'

interface ActivityLogProps {
  logs: Array<Record<string, unknown>>
}

interface ParsedLogEntry {
  key: string
  agentTag: string
  agentKind: ReturnType<typeof resolveAgentKind>
  parsed: ReturnType<typeof parseLogContent>
  summary: string | null
}

export function ActivityLog({ logs }: ActivityLogProps) {
  const entries = useMemo(() => parseEntries(logs), [logs])
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (entries.length === 0) return new Set()
    return new Set([entries[entries.length - 1].key])
  })

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Activity className="size-8 text-foreground-faint" aria-hidden />
        <p className={mutedText}>No activity yet. Agent steps will appear here as they run.</p>
      </div>
    )
  }

  const toggleEntry = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry, index) => {
        const isExpanded = expanded.has(entry.key)
        const isLatest = index === entries.length - 1

        return (
          <article
            key={entry.key}
            className={`${cardPanel} overflow-hidden ${isLatest ? 'ring-1 ring-primary/20' : ''}`}
          >
            <button
              type="button"
              className="flex w-full items-start gap-3 p-4 text-left hover:bg-surface-hover/50 transition-colors"
              onClick={() => toggleEntry(entry.key)}
              aria-expanded={isExpanded}
            >
              <span className="mt-0.5 text-muted-text">
                {isExpanded ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusLabel
                    text={entry.agentTag}
                    iconClassName="size-4 shrink-0 text-primary"
                    className="font-semibold text-foreground"
                  />
                  {entry.summary && (
                    <span className="text-xs text-muted-text truncate">{entry.summary}</span>
                  )}
                  {isLatest && (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[0.68rem] font-bold uppercase bg-primary/10 text-primary">
                      Latest
                    </span>
                  )}
                </div>
                {!isExpanded && entry.parsed.kind === 'supervisor' && entry.parsed.data.feedback && (
                  <p className={`${mutedText} text-xs m-0 line-clamp-2`}>{entry.parsed.data.feedback}</p>
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-border px-4 pb-4 pt-3">
                <ActivityLogContent parsed={entry.parsed} />
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}

function parseEntries(logs: Array<Record<string, unknown>>): ParsedLogEntry[] {
  return logs.map((log, index) => {
    const agentTag = typeof log.agent_tag === 'string' ? log.agent_tag : 'System'
    // Prefer log_history even when null so image-recognition None falls through to the parser.
    const content = 'log_history' in log ? log.log_history : log
    const agentKind = resolveAgentKind(agentTag)
    const parsed = parseLogContent(content, agentKind)
    const summary = logEntrySummary(parsed, agentKind)

    return {
      key: `${index}-${agentTag}`,
      agentTag,
      agentKind,
      parsed,
      summary,
    }
  })
}
