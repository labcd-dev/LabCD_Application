import { ChevronLeft, ChevronRight } from 'lucide-react'
import { btnBase, btnCompact } from '../../lib/classes'

type Props = {
  page: number
  totalPages: number
  total: number
  from: number
  to: number
  onPageChange: (page: number) => void
  /** Hide the whole bar when there are no rows. Default true. */
  hideWhenEmpty?: boolean
}

export function AdminPagination({
  page,
  totalPages,
  total,
  from,
  to,
  onPageChange,
  hideWhenEmpty = true,
}: Props) {
  if (hideWhenEmpty && total === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
      <p className="m-0 text-sm text-muted-text">
        {total === 0 ? 'No results' : `Showing ${from}–${to} of ${total}`}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${btnBase} ${btnCompact}`}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            Prev
          </button>
          <span className="min-w-[7rem] text-center text-sm text-foreground-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className={`${btnBase} ${btnCompact}`}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            Next
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
