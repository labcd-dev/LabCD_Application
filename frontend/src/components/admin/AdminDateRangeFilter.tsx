import { CalendarRange, X } from 'lucide-react'
import { btnBase, btnCompact, fieldInput } from '../../lib/classes'

type AdminDateRangeFilterProps = {
  dateFrom: string
  dateTo: string
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  onClear?: () => void
  className?: string
  fromLabel?: string
  toLabel?: string
}

const fieldClass =
  'flex w-[11.5rem] shrink-0 flex-col gap-1.5 [&>span]:text-sm [&>span]:font-medium [&>span]:text-foreground'

export function AdminDateRangeFilter({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
  className = '',
  fromLabel = 'From',
  toLabel = 'To',
}: AdminDateRangeFilterProps) {
  const active = Boolean(dateFrom || dateTo)

  return (
    <div className={`flex flex-row flex-wrap items-start gap-3 ${className}`.trim()}>
      <label className={fieldClass}>
        <span className="inline-flex items-center gap-1.5">
          <CalendarRange className="size-3.5 shrink-0 text-muted" aria-hidden />
          {fromLabel}
        </span>
        <input
          type="date"
          className={fieldInput}
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => onDateFromChange(e.target.value)}
          aria-label={fromLabel}
        />
      </label>
      <label className={fieldClass}>
        <span className="inline-flex h-[1.25rem] items-center">{toLabel}</span>
        <input
          type="date"
          className={fieldInput}
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => onDateToChange(e.target.value)}
          aria-label={toLabel}
        />
      </label>
      {active && onClear ? (
        <button
          type="button"
          className={`${btnBase} ${btnCompact} mt-[1.625rem] shrink-0`}
          onClick={onClear}
          aria-label="Clear date filter"
        >
          <X className="size-3.5" aria-hidden />
          Clear dates
        </button>
      ) : null}
    </div>
  )
}
