import { useEffect, useMemo, useState } from 'react'
import { ADMIN_PAGE_SIZE } from './useClientPagination'

type Options = {
  pageSize?: number
  /** Change this to reset to page 1 (e.g. search query or filter). */
  resetKey?: string | number | boolean | null
  total?: number
}

/** Page state for server-driven admin lists (page size matches AdminPagination). */
export function useServerPagination(options: Options = {}) {
  const pageSize = options.pageSize ?? ADMIN_PAGE_SIZE
  const total = options.total ?? 0
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [options.resetKey, pageSize])

  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(Math.max(1, page), totalPages)

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  return useMemo(
    () => ({
      page: safePage,
      setPage,
      pageSize,
      total,
      totalPages,
      from: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
      to: Math.min(safePage * pageSize, total),
    }),
    [pageSize, safePage, total, totalPages],
  )
}
