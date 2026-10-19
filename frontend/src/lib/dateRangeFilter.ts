import { parseApiDate } from './formatDateTime'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Local calendar day (YYYY-MM-DD) for an API timestamp. */
export function toLocalDateKey(value: string | Date | null | undefined): string | null {
  const date = parseApiDate(value)
  if (!date) return null
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Inclusive local-day range check for admin date pickers. */
export function isInAdminDateRange(
  value: string | Date | null | undefined,
  dateFrom: string,
  dateTo: string,
): boolean {
  if (!dateFrom && !dateTo) return true
  const key = toLocalDateKey(value)
  if (!key) return false
  if (dateFrom && key < dateFrom) return false
  if (dateTo && key > dateTo) return false
  return true
}
