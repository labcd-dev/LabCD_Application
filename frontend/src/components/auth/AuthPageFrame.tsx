import type { ReactNode } from 'react'
import { AuthSplitShell } from './AuthSplitShell'
import { AuthThemeAuto } from './AuthThemeAuto'
import { LoginArtPanel } from './LoginArtPanel'
import { LogoMark } from '../landing/LogoMark'

type AuthPageFrameProps = {
  title: string
  subtitle: string
  children: ReactNode
}

export function AuthPageFrame({ title, subtitle, children }: AuthPageFrameProps) {
  return (
    <>
      <AuthThemeAuto />
      <AuthSplitShell
        form={
          <>
            <LogoMark className="login-auth__logo" />
            <header>
              <h1 className="login-auth__title">{title}</h1>
              <p className="login-auth__subtitle">{subtitle}</p>
            </header>
            {children}
          </>
        }
        art={<LoginArtPanel />}
      />
    </>
  )
}
