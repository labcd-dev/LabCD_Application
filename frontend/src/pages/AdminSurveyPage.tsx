import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type {
  FeedbackSurveyResponseRow,
  ProfileSurveyResponseRow,
  SurveySettings,
} from '../api/types'
import { AdminDownloadCsvButton } from '../components/admin/AdminDownloadCsvButton'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import { downloadCsv } from '../lib/downloadCsv'
import {
  btnBase,
  btnCompact,
  cardPanel,
  fieldCheckbox,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

export function AdminSurveyPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:survey')
  const [settings, setSettings] = useState<SurveySettings>({ enabled: true })
  const [profileRows, setProfileRows] = useState<ProfileSurveyResponseRow[]>([])
  const [feedbackRows, setFeedbackRows] = useState<FeedbackSurveyResponseRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextSettings, responses] = await Promise.all([
        adminApi.getSurveySettings(),
        adminApi.listSurveyResponses(),
      ])
      setSettings(nextSettings)
      setProfileRows(responses.profile)
      setFeedbackRows(responses.feedback)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load survey admin')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  const profilePagination = useClientPagination(profileRows)
  const feedbackPagination = useClientPagination(feedbackRows)

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const toggleEnabled = async (enabled: boolean) => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const next = await adminApi.updateSurveySettings({ enabled })
      setSettings(next)
      setMessage(
        next.enabled
          ? 'Survey module enabled. Profile and feedback prompts are active.'
          : 'Survey module disabled. Profile and feedback prompts are off.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>
            <span className="inline-flex items-center gap-2">
              <ClipboardList className="size-6 text-primary" aria-hidden />
              Survey
            </span>
          </h1>
          <p className={pageIntro}>Toggle the survey module and review responses.</p>
        </div>
        <button
          type="button"
          className={`${btnBase} ${btnCompact}`}
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </button>
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      <div className={cardPanel}>
        <h2 className="mt-0 text-base font-semibold text-foreground">Survey module</h2>
        <p className="text-sm text-muted-text">
          When enabled, new users must complete the profile survey before using the studio, and
          feedback is requested after a successful SILO or MULO design run.
        </p>
        <label className={`${fieldCheckbox} mt-4`}>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={saving || loading}
            onChange={(e) => void toggleEnabled(e.target.checked)}
          />
          <span>Survey module enabled</span>
        </label>
      </div>

      <div className={cardPanel}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="mt-0 text-base font-semibold text-foreground">Profile survey responses</h2>
          <AdminDownloadCsvButton
            onClick={async () => {
              setError(null)
              try {
                await downloadCsv(
                  () => adminApi.downloadProfileSurveyCsv(),
                  'profile_survey_responses.csv',
                )
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to download CSV')
              }
            }}
            disabled={loading || profileRows.length === 0}
          />
        </div>
        {profileRows.length === 0 ? (
          <p className="text-sm text-muted-text">No profile surveys submitted yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-text">
                    <th className="px-2 py-2 font-medium">User</th>
                    <th className="px-2 py-2 font-medium">University</th>
                    <th className="px-2 py-2 font-medium">Degree</th>
                    <th className="px-2 py-2 font-medium">Major</th>
                    <th className="px-2 py-2 font-medium">MATLAB</th>
                    <th className="px-2 py-2 font-medium">Control</th>
                    <th className="px-2 py-2 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {profilePagination.pageItems.map((row) => (
                    <tr key={row.user_id} className="border-b border-border-subtle">
                      <td className="px-2 py-2 text-foreground">{row.email}</td>
                      <td className="px-2 py-2">{row.university ?? '—'}</td>
                      <td className="px-2 py-2">{row.degree ?? '—'}</td>
                      <td className="px-2 py-2">{row.major ?? '—'}</td>
                      <td className="px-2 py-2">{row.matlab_experience ?? '—'}</td>
                      <td className="px-2 py-2">{row.control_design_experience ?? '—'}</td>
                      <td className="px-2 py-2">{formatWhen(row.completed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AdminPagination
              page={profilePagination.page}
              totalPages={profilePagination.totalPages}
              total={profilePagination.total}
              from={profilePagination.from}
              to={profilePagination.to}
              onPageChange={profilePagination.setPage}
            />
          </div>
        )}
      </div>

      <div className={cardPanel}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="mt-0 text-base font-semibold text-foreground">Feedback survey responses</h2>
          <AdminDownloadCsvButton
            onClick={async () => {
              setError(null)
              try {
                await downloadCsv(
                  () => adminApi.downloadFeedbackSurveyCsv(),
                  'feedback_survey_responses.csv',
                )
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to download CSV')
              }
            }}
            disabled={loading || feedbackRows.length === 0}
          />
        </div>
        {feedbackRows.length === 0 ? (
          <p className="text-sm text-muted-text">No feedback surveys submitted yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-text">
                    <th className="px-2 py-2 font-medium">User</th>
                    <th className="px-2 py-2 font-medium">Design</th>
                    <th className="px-2 py-2 font-medium">Sat.</th>
                    <th className="px-2 py-2 font-medium">Ease</th>
                    <th className="px-2 py-2 font-medium">Value</th>
                    <th className="px-2 py-2 font-medium">Conf.</th>
                    <th className="px-2 py-2 font-medium">Reuse</th>
                    <th className="px-2 py-2 font-medium">Pay</th>
                    <th className="px-2 py-2 font-medium">Problems</th>
                    <th className="px-2 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {feedbackPagination.pageItems.map((row) => (
                    <tr
                      key={`${row.user_id}-${row.pipeline_type}-${row.created_at}`}
                      className="border-b border-border-subtle"
                    >
                      <td className="px-2 py-2 text-foreground">{row.email}</td>
                      <td className="px-2 py-2">
                        {row.pipeline_type === 'muloDesign' ? 'Multi Loop' : 'Single Loop'}
                      </td>
                      <td className="px-2 py-2">{row.satisfaction}</td>
                      <td className="px-2 py-2">{row.ease_of_use}</td>
                      <td className="px-2 py-2">{row.product_value}</td>
                      <td className="px-2 py-2">{row.confidence}</td>
                      <td className="px-2 py-2">{row.reuse_intention}</td>
                      <td className="px-2 py-2">{row.willingness_to_pay}</td>
                      <td className="max-w-[200px] truncate px-2 py-2" title={row.main_problems}>
                        {row.main_problems || '—'}
                      </td>
                      <td className="px-2 py-2">{formatWhen(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AdminPagination
              page={feedbackPagination.page}
              totalPages={feedbackPagination.totalPages}
              total={feedbackPagination.total}
              from={feedbackPagination.from}
              to={feedbackPagination.to}
              onPageChange={feedbackPagination.setPage}
            />
          </div>
        )}
      </div>
    </section>
  )
}
