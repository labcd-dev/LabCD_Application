import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortDir } from '../../hooks/useClientSort'

type AdminSortHeaderProps<K extends string> = {
  label: string
  sortKey: K
  activeKey: K
  dir: SortDir
  onSort: (key: K) => void
  className?: string
}

export function AdminSortHeader<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className = '',
}: AdminSortHeaderProps<K>) {
  const active = activeKey === sortKey
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown

  return (
    <th className={className}>
      <button
        type="button"
        className="inline-flex items-center gap-1 font-medium text-left hover:text-foreground"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}${active ? `, ${dir}` : ''}`}
      >
        <span>{label}</span>
        <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      </button>
    </th>
  )
}
