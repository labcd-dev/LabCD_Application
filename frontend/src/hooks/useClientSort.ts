import { useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc'

export type SortState<K extends string> = {
  key: K
  dir: SortDir
}

type SortValue = string | number | boolean | null | undefined
type AccessorMap<T> = Record<string, (item: T) => SortValue>

type Options<T, A extends AccessorMap<T>> = {
  items: T[]
  defaultKey: keyof A & string
  defaultDir?: SortDir
  accessors: A
}

function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const emptyA = a === null || a === undefined || a === ''
  const emptyB = b === null || b === undefined || b === ''
  if (emptyA && emptyB) return 0
  if (emptyA) return 1
  if (emptyB) return -1

  let result = 0
  if (typeof a === 'number' && typeof b === 'number') {
    result = a - b
  } else if (typeof a === 'boolean' && typeof b === 'boolean') {
    result = Number(a) - Number(b)
  } else {
    result = String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  }
  return dir === 'asc' ? result : -result
}

export function useClientSort<T, A extends AccessorMap<T>>({
  items,
  defaultKey,
  defaultDir = 'asc',
  accessors,
}: Options<T, A>) {
  type K = keyof A & string

  const [sort, setSort] = useState<SortState<K>>({
    key: defaultKey,
    dir: defaultDir,
  })

  const toggle = (key: K) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }

  const sortedItems = useMemo(() => {
    const accessor = accessors[sort.key]
    if (!accessor) return items
    const copy = [...items]
    copy.sort((left, right) =>
      compareValues(accessor(left), accessor(right), sort.dir),
    )
    return copy
  }, [accessors, items, sort.dir, sort.key])

  return {
    sort,
    sortBy: sort.key,
    sortDir: sort.dir,
    toggle,
    sortedItems,
    resetKey: `${sort.key}|${sort.dir}`,
  }
}
