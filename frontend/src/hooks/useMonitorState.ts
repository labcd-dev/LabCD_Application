import { useMemo } from 'react'

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function pickLongerArray(
  left: unknown,
  right: unknown,
): unknown[] | undefined {
  const leftLen = arrayLength(left)
  const rightLen = arrayLength(right)
  if (leftLen === 0 && rightLen === 0) return undefined
  if (leftLen >= rightLen) return left as unknown[]
  return right as unknown[]
}

function monitorRevision(state: Record<string, unknown> | null | undefined): number {
  const revision = state?.revision
  return typeof revision === 'number' ? revision : 0
}

function mergeMonitorState(
  pollData: Record<string, unknown> | null | undefined,
  streamSnapshot: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!pollData && !streamSnapshot) return null
  if (!pollData) return streamSnapshot
  if (!streamSnapshot) return pollData

  const pollRevision = monitorRevision(pollData)
  const streamRevision = monitorRevision(streamSnapshot)
  const pollStateLen = arrayLength(pollData.state_history)
  const streamStateLen = arrayLength(streamSnapshot.state_history)
  const pollLlmLen = arrayLength(pollData.llm_responses)
  const streamLlmLen = arrayLength(streamSnapshot.llm_responses)
  const pollScore = pollRevision + pollStateLen + pollLlmLen
  const streamScore = streamRevision + streamStateLen + streamLlmLen

  const primary = pollScore >= streamScore ? pollData : streamSnapshot
  const secondary = pollScore >= streamScore ? streamSnapshot : pollData

  return {
    ...secondary,
    ...primary,
    revision: Math.max(pollRevision, streamRevision),
    state_history:
      pickLongerArray(pollData.state_history, streamSnapshot.state_history) ??
      primary.state_history,
    llm_responses:
      pickLongerArray(pollData.llm_responses, streamSnapshot.llm_responses) ??
      primary.llm_responses,
    progress_history:
      pickLongerArray(pollData.progress_history, streamSnapshot.progress_history) ??
      primary.progress_history,
    scenario_metrics_history:
      pickLongerArray(
        pollData.scenario_metrics_history,
        streamSnapshot.scenario_metrics_history,
      ) ?? primary.scenario_metrics_history,
    current_state:
      pollRevision >= streamRevision
        ? (pollData.current_state ?? streamSnapshot.current_state)
        : (streamSnapshot.current_state ?? pollData.current_state),
  }
}

export function useMonitorState(
  pollData: Record<string, unknown> | null | undefined,
  streamMonitor: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return useMemo(
    () => mergeMonitorState(pollData, streamMonitor),
    [pollData, streamMonitor],
  )
}
