import type { AuthUser } from '../../../api/types'
import { cardPanel, fieldInput } from '../../../lib/classes'
import { Search } from 'lucide-react'

type Props = {
  search: string
  onSearchChange: (value: string) => void
  selectedId: number | null
  onSelect: (id: number | null) => void
  users: AuthUser[]
  loading: boolean
}

export function JourneyUserPicker({
  search,
  onSearchChange,
  selectedId,
  onSelect,
  users,
  loading,
}: Props) {
  return (
    <div className={`${cardPanel} flex flex-wrap items-end gap-3`}>
      <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Search</span>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-text" />
          <input
            type="search"
            className={`${fieldInput} pl-9`}
            placeholder="Email, user id, display name…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </label>
      <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">User</span>
        <select
          className={fieldInput}
          value={selectedId ?? ''}
          onChange={(e) => {
            const value = e.target.value
            onSelect(value ? Number(value) : null)
          }}
          disabled={loading}
        >
          <option value="">Select a user…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email} · usr_{u.id}
              {u.display_name ? ` · ${u.display_name}` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
