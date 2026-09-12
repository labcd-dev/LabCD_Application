import { useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { BugReportFab } from './BugReportFab'
import { BeforeTestSurveyModal } from './BeforeTestSurveyModal'
import { useAuth } from '../context/AuthContext'
import { surveyApi } from '../api/endpoints'

const fabButtonClass =
  'flex size-11 items-center justify-center rounded-full border border-border bg-surface-elevated text-foreground shadow-lg transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:size-12'

const BEFORE_TEST_SUBMITTED_KEY = 'before_test_survey_submitted'

export function SupportFabs() {
  const { user, refreshUser } = useAuth()
  const [beforeTestOpen, setBeforeTestOpen] = useState(false)
  const [surveyCompleted, setSurveyCompleted] = useState<boolean>(() => {
    return localStorage.getItem(BEFORE_TEST_SUBMITTED_KEY) === 'true'
  })

  useEffect(() => {
    if (user?.profile_survey_completed) {
      setSurveyCompleted(true)
      localStorage.setItem(BEFORE_TEST_SUBMITTED_KEY, 'true')
      return
    }

    let cancelled = false
    void surveyApi
      .status()
      .then((res) => {
        if (cancelled) return
        if (res.before_test_completed || !res.needs_profile_survey) {
          setSurveyCompleted(true)
          localStorage.setItem(BEFORE_TEST_SUBMITTED_KEY, 'true')
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [user?.profile_survey_completed])

  const handleSurveySubmitted = () => {
    setSurveyCompleted(true)
    localStorage.setItem(BEFORE_TEST_SUBMITTED_KEY, 'true')
    void refreshUser().catch(() => {})
  }

  const showBeforeTestButton = !surveyCompleted && !user?.profile_survey_completed

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 sm:bottom-6 sm:right-6">
        {showBeforeTestButton && (
          <button
            type="button"
            className={fabButtonClass}
            aria-label="Before-test survey"
            title="Prior Experience & Control Background Survey"
            onClick={() => setBeforeTestOpen(true)}
          >
            <ClipboardCheck className="size-5 text-primary" aria-hidden />
          </button>
        )}
        <BugReportFab className={fabButtonClass} />
      </div>

      {showBeforeTestButton && (
        <BeforeTestSurveyModal
          open={beforeTestOpen}
          onClose={() => setBeforeTestOpen(false)}
          onSubmitted={handleSurveySubmitted}
        />
      )}
    </>
  )
}
