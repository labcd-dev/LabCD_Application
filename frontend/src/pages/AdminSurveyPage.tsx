import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ClipboardList,
  Eye,
  HelpCircle,
  MessageSquare,
  RefreshCw,
  Star,
  UserCheck,
  X,
} from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type {
  BeforeTestSurveyResponseRow,
  FeedbackPipelineType,
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
  btnPrimary,
  cardPanel,
  fieldCheckbox,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'
import { formatDateTime } from '../lib/formatDateTime'

type TabType = 'outro' | 'before_test' | 'profile'

function pipelineLabel(pipeline: FeedbackPipelineType): string {
  switch (pipeline) {
    case 'mpcDesign':
      return 'Agentic MPC'
    case 'adaptiveDesign':
      return 'Adaptive Nonlinear'
    case 'muloDesign':
      return 'Multi Loop'
    case 'siloDesign':
    default:
      return 'Single Loop'
  }
}

function pipelineBadgeClass(pipeline: FeedbackPipelineType): string {
  switch (pipeline) {
    case 'mpcDesign':
      return 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30'
    case 'adaptiveDesign':
      return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30'
    case 'muloDesign':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30'
    case 'siloDesign':
    default:
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30'
  }
}

export function AdminSurveyPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:survey')
  const [activeTab, setActiveTab] = useState<TabType>('outro')
  const [settings, setSettings] = useState<SurveySettings>({ enabled: true })
  const [profileRows, setProfileRows] = useState<ProfileSurveyResponseRow[]>([])
  const [feedbackRows, setFeedbackRows] = useState<FeedbackSurveyResponseRow[]>([])
  const [beforeTestRows, setBeforeTestRows] = useState<BeforeTestSurveyResponseRow[]>([])
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackSurveyResponseRow | null>(null)
  const [selectedBeforeTest, setSelectedBeforeTest] = useState<BeforeTestSurveyResponseRow | null>(null)
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
      setProfileRows(responses.profile || [])
      setFeedbackRows(responses.feedback || [])
      setBeforeTestRows(responses.before_test || [])
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

  const feedbackPagination = useClientPagination(feedbackRows)
  const beforeTestPagination = useClientPagination(beforeTestRows)
  const profilePagination = useClientPagination(profileRows)

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
          ? 'Survey module enabled. Profile, Before-Test, and Outro feedback prompts are active.'
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
              Survey Administration
            </span>
          </h1>
          <p className={pageIntro}>
            Configure survey triggers and monitor user ratings, before-test benchmarks, and outro evaluations.
          </p>
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

      {/* Global Module Settings */}
      <div className={cardPanel}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="mt-0 text-base font-semibold text-foreground">Survey Module Status</h2>
            <p className="text-xs text-muted-text mt-0.5">
              Controls whether onboarding profile surveys, before-test prompts, and pipeline outro rating modals are active.
            </p>
          </div>
          <label className={`${fieldCheckbox} m-0`}>
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={saving || loading}
              onChange={(e) => void toggleEnabled(e.target.checked)}
            />
            <span className="text-xs font-semibold">
              {settings.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>
      </div>

      {/* Modern Navigation Tabs */}
      <div className="flex border-b border-border gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('outro')}
          className={`flex items-center gap-2 pb-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer bg-transparent ${
            activeTab === 'outro'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-text hover:text-foreground'
          }`}
        >
          <MessageSquare className="size-3.5" />
          <span>Outro Feedback Surveys</span>
          <span className="rounded-full bg-surface-muted border border-border px-1.5 py-0.2 text-[10px] font-mono">
            {feedbackRows.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('before_test')}
          className={`flex items-center gap-2 pb-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer bg-transparent ${
            activeTab === 'before_test'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-text hover:text-foreground'
          }`}
        >
          <HelpCircle className="size-3.5" />
          <span>Before-Test Surveys</span>
          <span className="rounded-full bg-surface-muted border border-border px-1.5 py-0.2 text-[10px] font-mono">
            {beforeTestRows.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-2 pb-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer bg-transparent ${
            activeTab === 'profile'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-text hover:text-foreground'
          }`}
        >
          <UserCheck className="size-3.5" />
          <span>Profile Surveys</span>
          <span className="rounded-full bg-surface-muted border border-border px-1.5 py-0.2 text-[10px] font-mono">
            {profileRows.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Outro Feedback Surveys */}
      {activeTab === 'outro' && (
        <div className={cardPanel}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
              <h2 className="mt-0 text-base font-semibold text-foreground">
                Per-Pipeline Outro Feedback
              </h2>
              <p className="text-xs text-muted-text mt-0.5">
                Surveys captured when users rate design results from MPC, Adaptive, SILO, or MULO pipelines.
              </p>
            </div>
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
            <p className="text-sm text-muted-text py-4 text-center">No outro feedback surveys submitted yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1150px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-text font-medium">
                      <th className="px-2.5 py-2">User</th>
                      <th className="px-2.5 py-2">Pipeline</th>
                      <th className="px-2.5 py-2">Plant / Job</th>
                      <th className="px-2.5 py-2">Score & Status</th>
                      <th className="px-2.5 py-2 text-center" title="Overall 5-Star Controller Design Grade">Design Rating</th>
                      <th className="px-2 py-2 text-center" title="Q1 Technical Usefulness (1-5)">Q1 Tech</th>
                      <th className="px-2 py-2 text-center" title="Q2 Trust (1-5)">Q2 Trust</th>
                      <th className="px-2 py-2 text-center" title="Q3 Ease of Use (1-5)">Q3 Ease</th>
                      <th className="px-2 py-2 text-center" title="Q4 Reuse Likelihood (1-5)">Q4 Reuse</th>
                      <th className="px-2 py-2 text-center" title="Q5 NPS (0-10)">NPS</th>
                      <th className="px-2.5 py-2">Bug?</th>
                      <th className="px-2.5 py-2 max-w-[200px]">Problems / Notes</th>
                      <th className="px-2.5 py-2">Date</th>
                      <th className="px-2.5 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbackPagination.pageItems.map((row) => {
                      const hasScore = typeof row.score === 'number' && Number.isFinite(row.score)
                      const isSuccess = row.success === true
                      const isFailed = row.success === false
                      const nps = row.nps
                      const displayRating = row.satisfaction || 0

                      return (
                        <tr
                          key={`${row.id || row.user_id}-${row.pipeline_type}-${row.created_at}`}
                          className="border-b border-border-subtle hover:bg-surface-hover/50 transition-colors"
                        >
                          {/* User */}
                          <td className="px-2.5 py-2 font-medium text-foreground">{row.email}</td>

                          {/* Pipeline */}
                          <td className="px-2.5 py-2">
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${pipelineBadgeClass(
                                row.pipeline_type,
                              )}`}
                            >
                              {pipelineLabel(row.pipeline_type)}
                            </span>
                          </td>

                          {/* Plant / Job */}
                          <td className="px-2.5 py-2">
                            <div className="flex flex-col text-[11px]">
                              <span className="font-semibold text-foreground truncate max-w-[140px]" title={row.plant_name || '—'}>
                                {row.plant_name || '—'}
                              </span>
                              {row.job_id && (
                                <span className="font-mono text-[10px] text-muted-text truncate max-w-[120px]" title={row.job_id}>
                                  {row.job_id.slice(0, 10)}…
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Score & Status */}
                          <td className="px-2.5 py-2">
                            <div className="flex items-center gap-1.5">
                              {row.success !== undefined && row.success !== null && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-bold border ${
                                    isSuccess
                                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                      : isFailed
                                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
                                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                  }`}
                                >
                                  {isSuccess ? (
                                    <CheckCircle2 className="size-2.5 text-emerald-500" />
                                  ) : (
                                    <AlertTriangle className="size-2.5 text-rose-500" />
                                  )}
                                  {isSuccess ? 'Success' : isFailed ? 'Needs Tuning' : 'Eval'}
                                </span>
                              )}
                              {hasScore && (
                                <span className="font-mono text-[11px] font-bold text-foreground">
                                  {(row.score! * 100).toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Design Rating (★) */}
                          <td className="px-2.5 py-2 text-center">
                            {displayRating > 0 ? (
                              <span className="inline-flex items-center gap-1 font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 text-[11.5px]">
                                <Star className="size-3 fill-amber-400 text-amber-400" />
                                {displayRating} / 5
                              </span>
                            ) : (
                              <span className="text-muted text-[11px]">—</span>
                            )}
                          </td>

                          {/* Q1 Technical Usefulness */}
                          <td className="px-2 py-2 text-center font-mono">
                            {row.technical_usefulness_na ? (
                              <span className="text-[10px] text-muted">N/A</span>
                            ) : row.technical_usefulness !== null && row.technical_usefulness !== undefined ? (
                              <span className="font-bold text-foreground">{row.technical_usefulness}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>

                          {/* Q2 Trust */}
                          <td className="px-2 py-2 text-center font-mono">
                            {row.trust_na ? (
                              <span className="text-[10px] text-muted">N/A</span>
                            ) : row.trust !== null && row.trust !== undefined ? (
                              <span className="font-bold text-foreground">{row.trust}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>

                          {/* Q3 Ease */}
                          <td className="px-2 py-2 text-center font-mono font-bold text-foreground">
                            {row.ease_of_use ?? '—'}
                          </td>

                          {/* Q4 Reuse */}
                          <td className="px-2 py-2 text-center font-mono font-bold text-foreground">
                            {row.reuse_intention ?? '—'}
                          </td>

                          {/* Q5 NPS */}
                          <td className="px-2 py-2 text-center font-mono">
                            {nps !== null && nps !== undefined ? (
                              <span
                                className={`inline-block px-1.5 py-0.2 rounded font-bold text-[11px] ${
                                  nps >= 9
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    : nps >= 7
                                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {nps}
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>

                          {/* Bug Flag */}
                          <td className="px-2.5 py-2">
                            {row.is_bug ? (
                              <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400 border border-red-500/30">
                                <Bug className="size-3" /> Bug
                              </span>
                            ) : (
                              <span className="text-muted text-[10px]">—</span>
                            )}
                          </td>

                          {/* Notes */}
                          <td className="px-2.5 py-2 max-w-[200px] truncate text-muted-text" title={row.main_problems}>
                            {row.main_problems || '—'}
                          </td>

                          {/* Date */}
                          <td className="px-2.5 py-2 whitespace-nowrap text-muted-text text-[11px]">
                            {formatDateTime(row.created_at)}
                          </td>

                          {/* Action button */}
                          <td className="px-2.5 py-2 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelectedFeedback(row)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-primary hover:bg-primary/10 border border-primary/20 transition-colors cursor-pointer bg-transparent"
                            >
                              <Eye className="size-3" /> Details
                            </button>
                          </td>
                        </tr>
                      )
                    })}
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
      )}

      {/* Tab 2: Before-Test Surveys */}
      {activeTab === 'before_test' && (
        <div className={cardPanel}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
              <h2 className="mt-0 text-base font-semibold text-foreground">
                Before-Test Surveys
              </h2>
              <p className="text-xs text-muted-text mt-0.5">
                9-question benchmarks on prior control-design experience, knowledge gaps, and willingness to pay.
              </p>
            </div>
            <AdminDownloadCsvButton
              onClick={async () => {
                setError(null)
                try {
                  await downloadCsv(
                    () => adminApi.downloadBeforeTestSurveyCsv(),
                    'before_test_survey_responses.csv',
                  )
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to download CSV')
                }
              }}
              disabled={loading || beforeTestRows.length === 0}
            />
          </div>

          {beforeTestRows.length === 0 ? (
            <p className="text-sm text-muted-text py-4 text-center">No before-test surveys submitted yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1150px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-text font-medium">
                      <th className="px-2.5 py-2">User</th>
                      <th className="px-2.5 py-2">Q1 Last Worked</th>
                      <th className="px-2.5 py-2">Q2 Time</th>
                      <th className="px-2 py-2 text-center" title="Q3 Gaps slowed you down (1-5)">Q3 Gaps</th>
                      <th className="px-2.5 py-2 max-w-[200px]">Q4 Friction (Up to 3)</th>
                      <th className="px-2.5 py-2 max-w-[200px]">Q5 Biggest Problem</th>
                      <th className="px-2.5 py-2 max-w-[180px]">Q6 Help Sources</th>
                      <th className="px-2.5 py-2">Q7 Consider Paying</th>
                      <th className="px-2.5 py-2">Q8 Amount (M Tomans)</th>
                      <th className="px-2.5 py-2 max-w-[180px]">Q9 Project Impact</th>
                      <th className="px-2.5 py-2">Date</th>
                      <th className="px-2.5 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {beforeTestPagination.pageItems.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-border-subtle hover:bg-surface-hover/50 transition-colors"
                      >
                        {/* User */}
                        <td className="px-2.5 py-2 font-medium text-foreground">{row.email}</td>

                        {/* Q1 */}
                        <td className="px-2.5 py-2 text-muted-text">{row.q1_last_worked}</td>

                        {/* Q2 */}
                        <td className="px-2.5 py-2 text-muted-text">{row.q2_time_spent || '—'}</td>

                        {/* Q3 */}
                        <td className="px-2 py-2 text-center font-mono font-bold text-foreground">
                          {row.q3_knowledge_gaps}
                        </td>

                        {/* Q4 */}
                        <td className="px-2.5 py-2 max-w-[200px]">
                          <div className="flex flex-wrap gap-1">
                            {row.q4_difficult_parts && row.q4_difficult_parts.length > 0 ? (
                              row.q4_difficult_parts.map((p, idx) => (
                                <span
                                  key={idx}
                                  className="rounded bg-surface-muted border border-border px-1.5 py-0.2 text-[10px] text-foreground font-mono"
                                >
                                  {p}
                                </span>
                              ))
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </div>
                        </td>

                        {/* Q5 */}
                        <td className="px-2.5 py-2 max-w-[200px] truncate text-muted-text" title={row.q5_biggest_problem}>
                          {row.q5_biggest_problem || '—'}
                        </td>

                        {/* Q6 */}
                        <td className="px-2.5 py-2 max-w-[180px]">
                          <div className="flex flex-wrap gap-1">
                            {row.q6_help_sources && row.q6_help_sources.length > 0 ? (
                              row.q6_help_sources.map((s, idx) => (
                                <span
                                  key={idx}
                                  className="rounded bg-surface-muted border border-border px-1.5 py-0.2 text-[10px] text-foreground font-mono"
                                >
                                  {s}
                                </span>
                              ))
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </div>
                        </td>

                        {/* Q7 */}
                        <td className="px-2.5 py-2 text-muted-text text-[11px] truncate max-w-[160px]" title={row.q7_considered_paying}>
                          {row.q7_considered_paying}
                        </td>

                        {/* Q8 */}
                        <td className="px-2.5 py-2 font-mono text-[11px]">
                          {row.q8a_amount_hired ? (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold" title="Hired and paid">
                              Hired: {row.q8a_amount_hired}M
                            </span>
                          ) : row.q8b_amount_paid_to_user ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold" title="Paid to do work">
                              Earned: {row.q8b_amount_paid_to_user}M
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>

                        {/* Q9 */}
                        <td className="px-2.5 py-2 max-w-[180px]">
                          <div className="flex flex-wrap gap-1">
                            {row.q9_impact && row.q9_impact.length > 0 ? (
                              row.q9_impact.map((imp, idx) => (
                                <span
                                  key={idx}
                                  className="rounded bg-surface-muted border border-border px-1.5 py-0.2 text-[10px] text-foreground font-mono"
                                >
                                  {imp}
                                </span>
                              ))
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </div>
                        </td>

                        {/* Date */}
                        <td className="px-2.5 py-2 whitespace-nowrap text-muted-text text-[11px]">
                          {formatDateTime(row.created_at)}
                        </td>

                        {/* Action button */}
                        <td className="px-2.5 py-2 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedBeforeTest(row)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-primary hover:bg-primary/10 border border-primary/20 transition-colors cursor-pointer bg-transparent"
                          >
                            <Eye className="size-3" /> Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <AdminPagination
                page={beforeTestPagination.page}
                totalPages={beforeTestPagination.totalPages}
                total={beforeTestPagination.total}
                from={beforeTestPagination.from}
                to={beforeTestPagination.to}
                onPageChange={beforeTestPagination.setPage}
              />
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Profile Surveys */}
      {activeTab === 'profile' && (
        <div className={cardPanel}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
              <h2 className="mt-0 text-base font-semibold text-foreground">Profile Survey Responses</h2>
              <p className="text-xs text-muted-text mt-0.5">
                Onboarding education, MATLAB, and control design experience.
              </p>
            </div>
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
            <p className="text-sm text-muted-text py-4 text-center">No profile surveys submitted yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-text font-medium">
                      <th className="px-2.5 py-2">User</th>
                      <th className="px-2.5 py-2">University</th>
                      <th className="px-2.5 py-2">Degree</th>
                      <th className="px-2.5 py-2">Major</th>
                      <th className="px-2.5 py-2">MATLAB Exp</th>
                      <th className="px-2.5 py-2">Control Exp</th>
                      <th className="px-2.5 py-2">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profilePagination.pageItems.map((row) => (
                      <tr key={row.user_id} className="border-b border-border-subtle hover:bg-surface-hover/50 transition-colors">
                        <td className="px-2.5 py-2 text-foreground font-medium">{row.email}</td>
                        <td className="px-2.5 py-2 text-muted-text">{row.university ?? '—'}</td>
                        <td className="px-2.5 py-2 text-muted-text">{row.degree ?? '—'}</td>
                        <td className="px-2.5 py-2 text-muted-text">{row.major ?? '—'}</td>
                        <td className="px-2.5 py-2 text-muted-text">{row.matlab_experience ?? '—'}</td>
                        <td className="px-2.5 py-2 text-muted-text">{row.control_design_experience ?? '—'}</td>
                        <td className="px-2.5 py-2 text-muted-text text-[11px]">{formatDateTime(row.completed_at)}</td>
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
      )}

      {/* Outro Survey Detailed Inspection Modal */}
      {selectedFeedback && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(6,8,11,0.75)] p-4 backdrop-blur-[6px] animate-in fade-in-50 duration-150"
          onClick={() => setSelectedFeedback(null)}
        >
          <div
            className="w-[560px] max-w-full max-h-[90vh] flex flex-col rounded-2xl border border-border bg-surface-elevated p-6 shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="m-0 text-base font-bold text-foreground flex items-center gap-2">
                  <span>Outro Survey Inspection</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${pipelineBadgeClass(selectedFeedback.pipeline_type)}`}>
                    {pipelineLabel(selectedFeedback.pipeline_type)}
                  </span>
                </h3>
                <p className="mt-1 text-xs text-muted-text">
                  Submitted by <strong className="text-foreground">{selectedFeedback.email}</strong> on {formatDateTime(selectedFeedback.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className="p-1 text-muted hover:text-foreground rounded cursor-pointer border-none bg-transparent"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {/* Tracing context */}
              <div className="rounded-xl bg-surface-muted/50 p-3 border border-border flex flex-wrap gap-x-4 gap-y-2">
                <div>
                  <span className="text-muted-text">Plant: </span>
                  <strong className="text-foreground">{selectedFeedback.plant_name || '—'}</strong>
                </div>
                <div>
                  <span className="text-muted-text">Job ID: </span>
                  <span className="font-mono text-foreground">{selectedFeedback.job_id || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-text">Score: </span>
                  <strong className="text-foreground">
                    {typeof selectedFeedback.score === 'number' ? `${(selectedFeedback.score * 100).toFixed(0)}%` : '—'}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-text">Status: </span>
                  <strong className={selectedFeedback.success ? 'text-emerald-500' : 'text-rose-500'}>
                    {selectedFeedback.success === true ? 'Success' : selectedFeedback.success === false ? 'Needs Tuning' : '—'}
                  </strong>
                </div>
              </div>

              {/* Overall Star Rating */}
              <div className="p-3.5 rounded-xl bg-surface-muted/30 border border-border flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-foreground block">Overall Controller Design Grade:</span>
                  <span className="text-[11px] text-muted-text">User's certified 1–5 star rating</span>
                </div>
                <div className="flex items-center gap-1.5 font-bold text-amber-500 bg-amber-500/15 px-3 py-1 rounded-full border border-amber-500/30 text-sm">
                  <Star className="size-4 fill-amber-400 text-amber-400" />
                  <span>{selectedFeedback.satisfaction || '—'} / 5</span>
                </div>
              </div>

              {/* Questions 1 - 5 */}
              <div className="space-y-2.5">
                <div className="flex justify-between py-1.5 border-b border-border/60">
                  <span className="text-muted-text">1. Technical Usefulness:</span>
                  <strong className="font-mono text-foreground">
                    {selectedFeedback.technical_usefulness_na ? 'N/A (Couldn\'t evaluate)' : `${selectedFeedback.technical_usefulness ?? '—'} / 5`}
                  </strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/60">
                  <span className="text-muted-text">2. Trust in Result:</span>
                  <strong className="font-mono text-foreground">
                    {selectedFeedback.trust_na ? 'N/A (Couldn\'t evaluate)' : `${selectedFeedback.trust ?? '—'} / 5`}
                  </strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/60">
                  <span className="text-muted-text">3. Ease of Use:</span>
                  <strong className="font-mono text-foreground">{selectedFeedback.ease_of_use ?? '—'} / 5</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/60">
                  <span className="text-muted-text">4. Likelihood to Reuse:</span>
                  <strong className="font-mono text-foreground">{selectedFeedback.reuse_intention ?? '—'} / 5</strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/60">
                  <span className="text-muted-text">5. Net Promoter Score (NPS):</span>
                  <strong className="font-mono text-foreground">
                    {selectedFeedback.nps !== null && selectedFeedback.nps !== undefined ? `${selectedFeedback.nps} / 10` : '—'}
                  </strong>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border/60">
                  <span className="text-muted-text">Bug Report Flag:</span>
                  <strong className={selectedFeedback.is_bug ? 'text-rose-500' : 'text-muted'}>
                    {selectedFeedback.is_bug ? 'YES (Reported as Bug)' : 'No'}
                  </strong>
                </div>
              </div>

              {/* Problems / Feedback */}
              <div>
                <span className="text-xs font-semibold text-foreground block mb-1">User Comments / Feedback:</span>
                <div className="rounded-xl border border-border bg-surface p-3 text-foreground whitespace-pre-wrap leading-relaxed">
                  {selectedFeedback.main_problems || <span className="text-muted italic">No written comments provided.</span>}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className={`${btnBase} ${btnCompact} ${btnPrimary} px-4 font-semibold`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Before-Test Survey Detailed Inspection Modal */}
      {selectedBeforeTest && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(6,8,11,0.75)] p-4 backdrop-blur-[6px] animate-in fade-in-50 duration-150"
          onClick={() => setSelectedBeforeTest(null)}
        >
          <div
            className="w-[580px] max-w-full max-h-[90vh] flex flex-col rounded-2xl border border-border bg-surface-elevated p-6 shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="m-0 text-base font-bold text-foreground">
                  Before-Test Survey Details
                </h3>
                <p className="mt-1 text-xs text-muted-text">
                  Submitted by <strong className="text-foreground">{selectedBeforeTest.email}</strong> on {formatDateTime(selectedBeforeTest.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBeforeTest(null)}
                className="p-1 text-muted hover:text-foreground rounded cursor-pointer border-none bg-transparent"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div className="p-2.5 rounded-lg bg-surface-muted border border-border">
                <span className="text-muted-text block mb-0.5">Q1. Last worked on a control project:</span>
                <strong className="text-foreground">{selectedBeforeTest.q1_last_worked}</strong>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-muted border border-border">
                <span className="text-muted-text block mb-0.5">Q2. Time spent on control design:</span>
                <strong className="text-foreground">{selectedBeforeTest.q2_time_spent || '—'}</strong>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-muted border border-border">
                <span className="text-muted-text block mb-0.5">Q3. Knowledge gaps slowed down (1–5):</span>
                <strong className="text-foreground font-mono">{selectedBeforeTest.q3_knowledge_gaps} / 5</strong>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-muted border border-border">
                <span className="text-muted-text block mb-1">Q4. Most difficult parts:</span>
                <div className="flex flex-wrap gap-1">
                  {selectedBeforeTest.q4_difficult_parts && selectedBeforeTest.q4_difficult_parts.length > 0 ? (
                    selectedBeforeTest.q4_difficult_parts.map((item, idx) => (
                      <span key={idx} className="bg-surface border border-border px-2 py-0.5 rounded text-foreground font-mono">
                        {item}
                      </span>
                    ))
                  ) : '—'}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-muted border border-border">
                <span className="text-muted-text block mb-0.5">Q5. Single biggest problem faced:</span>
                <p className="text-foreground mt-1 whitespace-pre-wrap">{selectedBeforeTest.q5_biggest_problem || '—'}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-muted border border-border">
                <span className="text-muted-text block mb-1">Q6. Help sources used:</span>
                <div className="flex flex-wrap gap-1">
                  {selectedBeforeTest.q6_help_sources && selectedBeforeTest.q6_help_sources.length > 0 ? (
                    selectedBeforeTest.q6_help_sources.map((item, idx) => (
                      <span key={idx} className="bg-surface border border-border px-2 py-0.5 rounded text-foreground font-mono">
                        {item}
                      </span>
                    ))
                  ) : '—'}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-surface-muted border border-border">
                <span className="text-muted-text block mb-0.5">Q7. Considered paying for help:</span>
                <strong className="text-foreground">{selectedBeforeTest.q7_considered_paying}</strong>
              </div>
              {(selectedBeforeTest.q8a_amount_hired || selectedBeforeTest.q8b_amount_paid_to_user) && (
                <div className="p-2.5 rounded-lg bg-surface-muted border border-border">
                  <span className="text-muted-text block mb-0.5">Q8. Amount (Million Tomans):</span>
                  <strong className="text-foreground font-mono">
                    {selectedBeforeTest.q8a_amount_hired ? `Hired: ${selectedBeforeTest.q8a_amount_hired}M Tomans` : `Earned: ${selectedBeforeTest.q8b_amount_paid_to_user}M Tomans`}
                  </strong>
                </div>
              )}
              <div className="p-2.5 rounded-lg bg-surface-muted border border-border">
                <span className="text-muted-text block mb-1">Q9. Impact on project:</span>
                <div className="flex flex-wrap gap-1">
                  {selectedBeforeTest.q9_impact && selectedBeforeTest.q9_impact.length > 0 ? (
                    selectedBeforeTest.q9_impact.map((item, idx) => (
                      <span key={idx} className="bg-surface border border-border px-2 py-0.5 rounded text-foreground font-mono">
                        {item}
                      </span>
                    ))
                  ) : '—'}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setSelectedBeforeTest(null)}
                className={`${btnBase} ${btnCompact} ${btnPrimary} px-4 font-semibold`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
