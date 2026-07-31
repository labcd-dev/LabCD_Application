import { useEffect, useMemo, useState } from 'react'

export const ADMIN_PAGE_SIZE = 25

type Options = {
  pageSize?: number
  /** Change this to reset to page 1 (e.g. search query or filter). */
  resetKey?: string | number | boolean | null
}

export function useClientPagination<T>(items: T[], options: Options = {}) {
  const pageSize = options.pageSize ?? ADMIN_PAGE_SIZE
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [options.resetKey, pageSize])

  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(Math.max(1, page), totalPages)

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, pageSize, safePage])

  return {
    page: safePage,
    setPage,
    pageSize,
    total,
    totalPages,
    pageItems,
    from: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
    to: Math.min(safePage * pageSize, total),
  }
}
