import { useEffect, useState } from 'react'
import { streamUrl } from '../api/client'
import { jobsApi } from '../api/endpoints'
import { subscribeJobStream } from '../api/sse'
import type { StreamEvent } from '../api/types'

interface UseJobStreamOptions {
  module: 'recommender' | 'trimmer' | 'silo' | 'mulo'
  jobId: string | null
  enabled?: boolean
}

function normalizeProgress(value: number): number {
  if (value > 1) return Math.min(value / 100, 1)
  return Math.max(0, value)
}

function progressFromMonitor(content: Record<string, unknown> | undefined): number | null {
  const history = content?.progress_history as Array<Record<string, unknown>> | undefined
  if (!history?.length) return null
  return Math.min(history.length * 5, 95) / 100
}

function messageFromMonitor(content: Record<string, unknown> | undefined): string | null {
  const history = content?.progress_history as Array<Record<string, unknown>> | undefined
  if (!history?.length) return null
  const message = history[history.length - 1]?.message
  return typeof message === 'string' ? message : null
}

export function useJobStream({ module, jobId, enabled = true }: UseJobStreamOptions) {
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [latestMonitor, setLatestMonitor] = useState<Record<string, unknown> | null>(null)
  const [needsPollFallback, setNeedsPollFallback] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [humanInput, setHumanInput] = useState<Record<string, unknown> | null>(null)
  const [isDone, setIsDone] = useState(false)
  const [isCancelled, setIsCancelled] = useState(false)
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([])
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    // Always clear terminal flags when the stream is off. Otherwise a prior
    // isDone=true sticks while enabled=false, and the next enable (e.g. RAG
    // after review) looks immediately complete — matching Streamlit's fresh
    // poll loop which never carries a sticky "done" across runs.
    if (!jobId || !enabled) {
      setIsDone(false)
      setIsRunning(false)
      setIsCancelled(false)
      setNeedsPollFallback(false)
      return
    }

    setEvents([])
    setLatestMonitor(null)
    setNeedsPollFallback(false)
    setProgress(0)
    setStatusText('')
    setError(null)
    setHumanInput(null)
    setIsDone(false)
    setIsCancelled(false)
    setIsRunning(true)
    setLogs([])
    setSummary(null)

    const captureSummary = (event: StreamEvent) => {
      if (event.summary && typeof event.summary === 'object' && !Array.isArray(event.summary)) {
        setSummary(event.summary)
        return
      }
      const metadataSummary = event.metadata?.summary
      if (
        metadataSummary &&
        typeof metadataSummary === 'object' &&
        !Array.isArray(metadataSummary)
      ) {
        setSummary(metadataSummary as Record<string, unknown>)
      }
    }

    const unsubscribe = subscribeJobStream(streamUrl(module, jobId), {
      onEvent: (event) => {
        if (event.type === 'monitor') {
          const content = event.content as Record<string, unknown> | undefined
          if (content && typeof content === 'object') {
            setLatestMonitor(content)
          }
          const monitorProgress = progressFromMonitor(content)
          if (monitorProgress !== null) {
            setProgress((prev) => Math.max(prev, monitorProgress))
          }
          const monitorMessage = messageFromMonitor(content)
          if (monitorMessage) {
            setStatusText(monitorMessage)
          }
          captureSummary(event)
          return
        }

        setEvents((prev) => [...prev, event])
        captureSummary(event)

        if (event.type === 'human_input' && event.content) {
          setHumanInput(event.content as Record<string, unknown>)
        }

        if (event.type === 'stream') {
          const content = event.content as Record<string, unknown> | undefined
          // Keep agent log entries even when log_history is null/empty (e.g. image recognition).
          if (typeof content?.agent_tag === 'string') {
            setLogs((prev) => [...prev, content])
          } else if (content?.log_history) {
            setLogs((prev) => [...prev, content])
          }
          if (typeof content?.progress === 'number') {
            setProgress(normalizeProgress(content.progress as number))
          }
          if (typeof content?.text === 'string') {
            setStatusText(content.text as string)
          }
        }
      },
      onDone: (event) => {
        setIsRunning(false)
        setIsDone(true)
        setNeedsPollFallback(false)
        setProgress(1)
        captureSummary(event)
        if (event.status === 'failed') {
          setError(event.error ?? 'Job failed')
        } else if (event.status === 'cancelled') {
          setIsCancelled(true)
          setStatusText('Design cancelled')
        }
      },
      onError: async (err) => {
        if (!jobId) {
          setIsRunning(false)
          setError(err.message)
          return
        }

        try {
          const status = await jobsApi.status(jobId)
          const statusSummary = status.metadata?.summary
          if (
            statusSummary &&
            typeof statusSummary === 'object' &&
            !Array.isArray(statusSummary)
          ) {
            setSummary(statusSummary as Record<string, unknown>)
          }
          if (status.status === 'completed') {
            setIsRunning(false)
            setIsDone(true)
            setNeedsPollFallback(false)
            setProgress(1)
            setError(null)
            return
          }
          if (status.status === 'failed') {
            setIsRunning(false)
            setIsDone(true)
            setNeedsPollFallback(false)
            setError(status.error ?? err.message)
            return
          }
          if (status.status === 'cancelled') {
            setIsRunning(false)
            setIsDone(true)
            setIsCancelled(true)
            setNeedsPollFallback(false)
            setStatusText('Design cancelled')
            setError(null)
            return
          }
          // Stream dropped but the backend job is still running; polling can continue.
          setNeedsPollFallback(true)
          setError(null)
          return
        } catch {
          setIsRunning(false)
          setError(err.message)
        }
      },
    })

    return unsubscribe
  }, [module, jobId, enabled])

  return {
    events,
    latestMonitor,
    needsPollFallback,
    logs,
    progress,
    statusText,
    isRunning,
    isDone,
    isCancelled,
    error,
    summary,
    humanInput,
    clearHumanInput: () => setHumanInput(null),
  }
}
