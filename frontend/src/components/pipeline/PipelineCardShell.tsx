import type { ReactNode } from 'react'
import { UserCheck } from 'lucide-react'

/** Shared HITL chrome for every pipeline gate. Reuses the .ap-hitl classes from HitlModuleSelector. */
export function PipelineCardShell({
  title,
  description,
  footer,
  children,
}: {
  title: string
  description?: string
  footer: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="ap-hitl" role="region" aria-label={title}>
      <div className="ap-hitl-header">
        <div className="ap-hitl-header-left">
          <div className="ap-hitl-badge">
            <span className="ap-hitl-pulse" aria-hidden />
            <UserCheck className="size-3 text-indigo-400" aria-hidden />
            <span>Human-in-the-Loop</span>
          </div>
          <h4 className="ap-hitl-title">{title}</h4>
          {description && <p className="ap-hitl-desc">{description}</p>}
        </div>
      </div>
      {children}
      <div className="ap-hitl-footer">{footer}</div>
    </div>
  )
}
