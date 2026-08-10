import {
  useCallback,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

interface TabItem {
  id: string
  label: string
  content: ReactNode
}

interface TabsProps {
  tabs: TabItem[]
  activeTab: string
  onChange: (tabId: string) => void
  /** Optional accessible name for the tab list. */
  label?: string
}

export function Tabs({ tabs, activeTab, onChange, label }: TabsProps) {
  const baseId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const focusTabAt = useCallback(
    (index: number) => {
      const nodes = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      const target = nodes?.[index]
      if (!target) return
      target.focus()
      onChange(tabs[index].id)
    },
    [onChange, tabs],
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab)
    if (currentIndex < 0) return

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusTabAt((currentIndex + 1) % tabs.length)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusTabAt((currentIndex - 1 + tabs.length) % tabs.length)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusTabAt(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusTabAt(tabs.length - 1)
    }
  }

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]
  if (!active) return null

  return (
    <div className="module-tabs">
      <div className="module-tabs__rail">
        <div
          ref={listRef}
          className="module-tabs__list"
          role="tablist"
          aria-label={label}
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
        >
          {tabs.map((tab) => {
            const isActive = active.id === tab.id
            const tabId = `${baseId}-tab-${tab.id}`
            const panelId = `${baseId}-panel-${tab.id}`
            return (
              <button
                key={tab.id}
                id={tabId}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={panelId}
                tabIndex={isActive ? 0 : -1}
                className={[
                  'module-tabs__tab',
                  isActive && 'module-tabs__tab--active',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onChange(tab.id)}
              >
                <span className="module-tabs__label">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div
        id={`${baseId}-panel-${active.id}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active.id}`}
        className="module-tabs__panel"
      >
        {active.content}
      </div>
    </div>
  )
}
