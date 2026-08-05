import { adminApi, triggerBlobDownload } from '../api/endpoints'

export async function downloadCsv(
  fetchBlob: () => Promise<Blob>,
  filename: string,
): Promise<void> {
  const blob = await fetchBlob()
  triggerBlobDownload(blob, filename)
}

export async function downloadAdminModuleCsv(
  module:
    | 'users'
    | 'plans'
    | 'projects'
    | 'monitoring'
    | 'overview'
    | 'profile-survey'
    | 'feedback-survey'
    | 'errors',
  params?: {
    user_id?: number
    pipeline_type?: string
    source?: string
    status_code?: number
    q?: string
  },
): Promise<void> {
  switch (module) {
    case 'users':
      return downloadCsv(() => adminApi.downloadUsersCsv(), 'users.csv')
    case 'plans':
      return downloadCsv(() => adminApi.downloadPlansCsv(), 'plans.csv')
    case 'projects':
      return downloadCsv(
        () =>
          adminApi.downloadProjectsCsv({
            user_id: params?.user_id,
            pipeline_type: params?.pipeline_type,
          }),
        'projects.csv',
      )
    case 'monitoring':
      return downloadCsv(() => adminApi.downloadMonitoringCsv(), 'monitoring_history.csv')
    case 'overview':
      return downloadCsv(() => adminApi.downloadOverviewCsv(), 'admin_all_data.xlsx')
    case 'profile-survey':
      return downloadCsv(
        () => adminApi.downloadProfileSurveyCsv(),
        'profile_survey_responses.csv',
      )
    case 'feedback-survey':
      return downloadCsv(
        () => adminApi.downloadFeedbackSurveyCsv(),
        'feedback_survey_responses.csv',
      )
    case 'errors':
      return downloadCsv(
        () =>
          adminApi.downloadErrorsCsv({
            source: params?.source,
            status_code: params?.status_code,
            q: params?.q,
          }),
        'error_events.csv',
      )
  }
}
