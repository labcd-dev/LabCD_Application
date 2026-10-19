import { useState } from 'react'
import type { SortDir } from './useClientSort'

/** Sort state for server-driven admin tables. */
export function useServerSort(defaultKey: string, defaultDir: SortDir = 'asc') {
  const [sortBy, setSortBy] = useState(defaultKey)
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir)

  const toggle = (key: string) => {
    if (key === sortBy) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(key)
    setSortDir('asc')
  }

  return {
    sortBy,
    sortDir,
    toggle,
    resetKey: `${sortBy}|${sortDir}`,
  }
}
