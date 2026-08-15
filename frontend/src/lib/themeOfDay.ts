/** Rotating accent palettes for the "theme of the day" preference. */

export interface DayThemePalette {
  name: string
  primary: string
  accent2: string
}

export const DAY_THEME_PALETTES: DayThemePalette[] = [
  { name: 'Aurora', primary: '#5b7fff', accent2: '#8b7dff' },
  { name: 'Tide', primary: '#22d3a7', accent2: '#5b7fff' },
  { name: 'Ember', primary: '#f07a4a', accent2: '#f0b429' },
  { name: 'Orchid', primary: '#c084fc', accent2: '#5b7fff' },
  { name: 'Coral', primary: '#f0576b', accent2: '#f0b429' },
  { name: 'Lagoon', primary: '#38bdf8', accent2: '#22d3a7' },
  { name: 'Citrus', primary: '#f0b429', accent2: '#f07a4a' },
]

/** Day-of-year index (1–366) used to pick today's palette. */
export function dayOfYear(date = new Date()): number {
  const start = Date.UTC(date.getFullYear(), 0, 0)
  const now = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((now - start) / 86_400_000)
}

export function getThemeOfDay(date = new Date()): DayThemePalette {
  const index = (dayOfYear(date) - 1) % DAY_THEME_PALETTES.length
  return DAY_THEME_PALETTES[index < 0 ? 0 : index]
}
