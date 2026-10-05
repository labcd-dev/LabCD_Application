import type { ReactNode } from 'react'
import './login-auth.css'

type AuthSplitShellProps = {
  form: ReactNode
  art: ReactNode
}

export function AuthSplitShell({ form, art }: AuthSplitShellProps) {
  return (
    <div className="login-auth">
      <div className="login-auth__card">
        <div className="login-auth__form-pane">{form}</div>
        <aside className="login-auth__art-pane" aria-hidden>
          {art}
        </aside>
      </div>
    </div>
  )
}
