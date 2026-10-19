import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, CalendarRange, ChevronDown, X } from 'lucide-react'
import { btnBase, btnCompact } from '../../lib/classes'
import {
  ADMIN_DATE_PRESETS,
  adminDatePresetRange,
  formatAdminDateRangeSummary,
  matchAdminDatePreset,
  type AdminDatePresetId,
} from '../../lib/dateRangeFilter'

type AdminDateRangeFilterProps = {
  dateFrom: string
  dateTo: string
  onDateFromChange: (value: string) => void
  onDateToChange: (value: string) => void
  onClear?: () => void
  className?: string
  /** Visible section label. Defaults to "Date range". */
  label?: string
  fromLabel?: string
  toLabel?: string
}

type PanelCoords = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

const PANEL_WIDTH = 384
const PANEL_GAP = 6
const VIEWPORT_PAD = 8

const dateFieldClass =
  'min-w-[9.75rem] flex-1 border-0 bg-transparent px-2 py-1.5 text-sm text-foreground shadow-none [color-scheme:light] focus:outline-none focus:ring-0 dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 hover:[&::-webkit-calendar-picker-indicator]:opacity-100'

function placePanel(anchor: DOMRect): PanelCoords {
  const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_PAD * 2)
  let left = anchor.left
  if (left + width > window.innerWidth - VIEWPORT_PAD) {
    left = anchor.right - width
  }
  left = Math.max(VIEWPORT_PAD, left)

  const spaceBelow = window.innerHeight - anchor.bottom - PANEL_GAP - VIEWPORT_PAD
  const spaceAbove = anchor.top - PANEL_GAP - VIEWPORT_PAD
  const openAbove = spaceBelow < 280 && spaceAbove > spaceBelow

  if (openAbove) {
    return {
      bottom: window.innerHeight - anchor.top + PANEL_GAP,
      left,
      width,
      maxHeight: Math.max(160, spaceAbove),
    }
  }

  return {
    top: anchor.bottom + PANEL_GAP,
    left,
    width,
    maxHeight: Math.max(160, spaceBelow),
  }
}

export function AdminDateRangeFilter({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
  className = '',
  label = 'Date range',
  fromLabel = 'From',
  toLabel = 'To',
}: AdminDateRangeFilterProps) {
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const active = Boolean(dateFrom || dateTo)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<PanelCoords | null>(null)
  const activePreset = matchAdminDatePreset(dateFrom, dateTo)
  const summary = formatAdminDateRangeSummary(dateFrom, dateTo)

  const applyPreset = (id: AdminDatePresetId) => {
    const range = adminDatePresetRange(id)
    onDateFromChange(range.from)
    onDateToChange(range.to)
  }

  const closePanel = () => setOpen(false)

  const clearAndClose = () => {
    setOpen(false)
    onClear?.()
  }

  const updatePosition = () => {
    const button = buttonRef.current
    if (!button) return
    setCoords(placePanel(button.getBoundingClientRect()))
  }

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    updatePosition()
  }, [open])

  useEffect(() => {
    if (!open) return

    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onReposition = () => updatePosition()

    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  const panel =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={label}
            style={{
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
            }}
            className="fixed z-[80] overflow-y-auto rounded-xl border border-border bg-surface-elevated p-3 shadow-[0_16px_48px_rgba(0,0,0,0.22)]"
          >
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                <CalendarRange className="size-3.5 shrink-0 text-muted" aria-hidden />
                {label}
              </span>
              <div className="flex items-center gap-1">
                {active && onClear ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-text transition-colors hover:bg-surface-hover hover:text-foreground"
                    onClick={clearAndClose}
                    aria-label="Clear date filter"
                  >
                    <X className="size-3.5" aria-hidden />
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-text transition-colors hover:bg-surface-hover hover:text-foreground"
                  onClick={closePanel}
                  aria-label="Close date filter"
                >
                  Done
                </button>
              </div>
            </div>

            <div
              className="mb-2.5 inline-flex w-full flex-wrap gap-1 rounded-xl border border-border bg-surface-muted p-1"
              role="group"
              aria-label="Quick date ranges"
            >
              {ADMIN_DATE_PRESETS.map((preset) => {
                const selected = activePreset === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.label}
                    aria-pressed={selected}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? 'bg-surface-elevated text-foreground shadow-sm'
                        : 'bg-transparent text-muted-text hover:text-foreground'
                    }`}
                    onClick={() => applyPreset(preset.id)}
                  >
                    <span className="sm:hidden">{preset.shortLabel}</span>
                    <span className="hidden sm:inline">{preset.label}</span>
                  </button>
                )
              })}
            </div>

            <div
              className={`flex flex-col gap-0.5 rounded-lg border bg-surface-muted/40 p-0.5 transition-[border-color,box-shadow] duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${
                active ? 'border-primary/40' : 'border-border-input'
              }`}
            >
              <label className="flex flex-col gap-0.5 px-1.5 pt-1 pb-0.5">
                <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {fromLabel}
                </span>
                <input
                  type="date"
                  className={dateFieldClass}
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => onDateFromChange(e.target.value)}
                  aria-label={fromLabel}
                />
              </label>
              <div className="flex items-center gap-2 px-2">
                <div className="h-px flex-1 bg-border-subtle" />
                <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden />
                <div className="h-px flex-1 bg-border-subtle" />
              </div>
              <label className="flex flex-col gap-0.5 px-1.5 pt-0.5 pb-1">
                <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {toLabel}
                </span>
                <input
                  type="date"
                  className={dateFieldClass}
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => onDateToChange(e.target.value)}
                  aria-label={toLabel}
                />
              </label>
            </div>

            {summary ? (
              <p className="mb-0 mt-2 text-xs text-muted-text" aria-live="polite">
                Showing {summary}
              </p>
            ) : null}
          </div>,
          document.body,
        )
      : null

  return (
    <div className={`relative shrink-0 ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        className={`${btnBase} ${btnCompact} ${
          open || active
            ? 'border-primary/40 bg-[color-mix(in_srgb,var(--app-primary)_10%,transparent)] text-foreground'
            : ''
        }`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <CalendarRange className="size-3.5 shrink-0" aria-hidden />
        <span>{active && summary ? summary : label}</span>
        {active ? (
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
        ) : (
          <ChevronDown
            className={`size-3.5 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        )}
      </button>
      {panel}
    </div>
  )
}
