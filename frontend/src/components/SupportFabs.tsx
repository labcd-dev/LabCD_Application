import { BugReportFab } from './BugReportFab'
import { FeedbackSurveyFab } from './FeedbackSurveyFab'

const fabButtonClass =
  'flex size-11 items-center justify-center rounded-full border border-border bg-surface-elevated text-foreground shadow-lg transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:size-12'

export function SupportFabs() {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 sm:bottom-6 sm:right-6">
      <FeedbackSurveyFab className={fabButtonClass} />
      <BugReportFab className={fabButtonClass} />
    </div>
  )
}
