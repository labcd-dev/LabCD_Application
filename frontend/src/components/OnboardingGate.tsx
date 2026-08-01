import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { surveyApi } from '../api/endpoints'
import type { SurveyStatus } from '../api/types'
import { useAuth } from '../context/AuthContext'
import { ProfileSurveyModal } from './ProfileSurveyModal'
import {
  isTutorialRemindLater,
  TutorialSliderModal,
} from './TutorialSliderModal'

interface OnboardingGateProps {
  children: ReactNode
}

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { user, refreshUser } = useAuth()
  const location = useLocation()
  const [status, setStatus] = useState<SurveyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [tutorialDismissedLocally, setTutorialDismissedLocally] = useState(false)

  const isAdminRoute = location.pathname.startsWith('/admin')

  const loadStatus = useCallback(async () => {
    if (!user) {
      setStatus(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const next = await surveyApi.status()
      setStatus(next)
    } catch {
      // Don't block the app on survey/status failures (timeouts under load).
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  if (!user) {
    return <>{children}</>
  }

  // Only block briefly while the first status request is in flight.
  if (loading && !status) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-text">
        Loading…
      </div>
    )
  }

  const needsProfile = Boolean(status?.needs_profile_survey) && !isAdminRoute
  const showTutorial =
    !needsProfile &&
    !isAdminRoute &&
    !tutorialDismissedLocally &&
    !isTutorialRemindLater() &&
    Boolean(status?.show_tutorial) &&
    (status?.videos.length ?? 0) > 0

  return (
    <>
      {needsProfile ? (
        <ProfileSurveyModal
          onCompleted={async () => {
            await refreshUser()
            await loadStatus()
          }}
        />
      ) : (
        <>
          {children}
          {showTutorial && status && (
            <TutorialSliderModal
              videos={status.videos}
              onClosed={async () => {
                setTutorialDismissedLocally(true)
                await refreshUser()
                await loadStatus()
              }}
            />
          )}
        </>
      )}
    </>
  )
}
