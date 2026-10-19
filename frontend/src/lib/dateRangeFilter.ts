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

export type AdminDatePresetId = 'today' | '7d' | '30d' | '90d' | 'month'

export const ADMIN_DATE_PRESETS: ReadonlyArray<{
  id: AdminDatePresetId
  label: string
  shortLabel: string
}> = [
  { id: 'today', label: 'Today', shortLabel: 'Today' },
  { id: '7d', label: 'Last 7 days', shortLabel: '7d' },
  { id: '30d', label: 'Last 30 days', shortLabel: '30d' },
  { id: '90d', label: 'Last 90 days', shortLabel: '90d' },
  { id: 'month', label: 'This month', shortLabel: 'Month' },
]

/** Local YYYY-MM-DD for a Date (calendar day in the viewer timezone). */
export function toLocalDayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseLocalDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim())
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

export function adminDatePresetRange(id: AdminDatePresetId): { from: string; to: string } {
  const today = new Date()
  const to = toLocalDayKey(today)

  switch (id) {
    case 'today':
      return { from: to, to }
    case '7d':
      return { from: toLocalDayKey(addLocalDays(today, -6)), to }
    case '30d':
      return { from: toLocalDayKey(addLocalDays(today, -29)), to }
    case '90d':
      return { from: toLocalDayKey(addLocalDays(today, -89)), to }
    case 'month':
      return {
        from: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`,
        to,
      }
  }
}

export function matchAdminDatePreset(
  dateFrom: string,
  dateTo: string,
): AdminDatePresetId | null {
  if (!dateFrom || !dateTo) return null
  for (const preset of ADMIN_DATE_PRESETS) {
    const range = adminDatePresetRange(preset.id)
    if (range.from === dateFrom && range.to === dateTo) return preset.id
  }
  return null
}

export function formatAdminDateRangeSummary(dateFrom: string, dateTo: string): string {
  if (!dateFrom && !dateTo) return ''
  const fromLabel = dateFrom
    ? (parseLocalDayKey(dateFrom)?.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }) ?? dateFrom)
    : null
  const toLabel = dateTo
    ? (parseLocalDayKey(dateTo)?.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }) ?? dateTo)
    : null
  if (fromLabel && toLabel) {
    if (dateFrom === dateTo) return fromLabel
    return `${fromLabel} – ${toLabel}`
  }
  if (fromLabel) return `From ${fromLabel}`
  return `Through ${toLabel}`
}
