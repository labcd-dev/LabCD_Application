import { cardPanel, logPre } from '../lib/classes'

interface JsonViewerProps {
  data: unknown
  title?: string
  defaultOpen?: boolean
}

export function JsonViewer({ data, title, defaultOpen }: JsonViewerProps) {
  const isOpen = defaultOpen ?? !title
  return (
    <details className={`${cardPanel} p-3 mb-3 text-foreground`} open={isOpen}>
      {title && <summary className="cursor-pointer">{title}</summary>}
      <pre className={logPre}>{JSON.stringify(data, null, 2)}</pre>
    </details>
  )
}
