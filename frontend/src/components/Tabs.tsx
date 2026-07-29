import type { ReactNode } from 'react'

interface TabsProps {
  tabs: Array<{ id: string; label: string; content: ReactNode }>
  activeTab: string
  onChange: (tabId: string) => void
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="mt-4">
      <div
        className="flex gap-1 border-b border-border mb-4 overflow-x-auto"
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`shrink-0 border-none bg-transparent px-4 py-3 cursor-pointer border-b-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-b-primary text-primary'
                  : 'border-b-transparent text-muted-text hover:text-foreground'
              }`}
              onClick={() => onChange(tab.id)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {tabs.map((tab) =>
        activeTab === tab.id ? (
          <div key={tab.id} role="tabpanel">
            {tab.content}
          </div>
        ) : null,
      )}
    </div>
  )
}
