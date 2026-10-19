import { useMemo, useState } from 'react'
import { viewerTimeZone } from '../lib/formatDateTime'

export type AdminDateRangeParams = {
  date_from?: string
  date_to?: string
  tz?: string
}

export function useAdminDateRange() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const params = useMemo<AdminDateRangeParams>(() => {
    if (!dateFrom && !dateTo) return {}
    return {
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      tz: viewerTimeZone(),
    }
  }, [dateFrom, dateTo])

  const isActive = Boolean(dateFrom || dateTo)

  const clear = () => {
    setDateFrom('')
    setDateTo('')
  }

  return {
    dateFrom,
    dateTo,
    setDateFrom,
    setDateTo,
    clear,
    params,
    isActive,
  }
}
