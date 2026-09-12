import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { AuthUser, JourneyComment, JourneyStep, UserJourney } from '../api/types'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import {
  btnBase,
  btnCompact,
  cardPanel,
  fieldInput,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'
import { formatDateTime } from '../lib/formatDateTime'

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem ? `${hours}h ${rem}m` : `${hours}h`
}

function stepStatusClass(status: JourneyStep['status']): string {
  if (status === 'ok') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'fail') return 'text-rose-600 dark:text-rose-400'
  return 'text-muted-text'
}

function commentSourceLabel(source: string): string {
  if (source === 'session_comment') return 'Session comment'
  if (source === 'feedback_survey') return 'Feedback survey'
  if (source === 'bug_report') return 'Bug report'
  return source
}

function TimelineStep({ step }: { step: JourneyStep }) {
  const duration = formatDuration(step.duration_seconds)
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <div className="flex flex-col items-center">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            step.status === 'ok'
              ? 'bg-emerald-500'
              : step.status === 'fail'
                ? 'bg-rose-500'
                : 'bg-primary/70'
          }`}
        />
        <span className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-foreground">{step.title}</p>
          <time className="font-mono text-[11px] text-muted-text">
            {formatDateTime(step.timestamp)}
          </time>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-text">
          <span className={stepStatusClass(step.status)}>{step.status}</span>
          {duration ? <span>{duration}</span> : null}
          {step.detail ? <span>{step.detail}</span> : null}
        </div>
        {step.error ? (
          <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{step.error}</p>
        ) : null}
      </div>
    </li>
  )
}

function CommentCard({ comment }: { comment: JourneyComment }) {
  return (
    <article className="rounded-lg border border-border bg-surface/60 p-3">
      <p className="text-sm italic leading-relaxed text-foreground/90">
        “{comment.text}”
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-text">
        <span>{commentSourceLabel(comment.source)}</span>
        <span>{formatDateTime(comment.timestamp)}</span>
        {comment.rating != null ? <span>Rating {comment.rating} / 5</span> : null}
        {comment.meta ? <span>{comment.meta}</span> : null}
      </div>
    </article>
  )
}

export function AdminUserJourneyPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:users')
  const [users, setUsers] = useState<AuthUser[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [journey, setJourney] = useState<UserJourney | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [loadingJourney, setLoadingJourney] = useState(false)

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => {
      const idMatch = String(u.id) === q || String(u.id).includes(q)
      const emailMatch = u.email.toLowerCase().includes(q)
      const nameMatch = (u.display_name || '').toLowerCase().includes(q)
      return idMatch || emailMatch || nameMatch
    })
  }, [search, users])

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true)
    setError(null)
    try {
      const list = await adminApi.listUsers()
      setUsers(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  const loadJourney = useCallback(async (userId: number) => {
    setLoadingJourney(true)
    setError(null)
    try {
      const data = await adminApi.getUserJourney(userId)
      setJourney(data)
    } catch (err) {
      setJourney(null)
      setError(err instanceof Error ? err.message : 'Failed to load journey')
    } finally {
      setLoadingJourney(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    void loadUsers()
  }, [canManage, loadUsers])

  useEffect(() => {
    if (!canManage || selectedId == null) {
      setJourney(null)
      return
    }
    void loadJourney(selectedId)
  }, [canManage, selectedId, loadJourney])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const selectedUser =
    users.find((u) => u.id === selectedId) ??
    (journey?.user.id === selectedId ? journey.user : null)

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>User journey</h1>
          <p className={pageIntro}>
            Ordered workflow timeline and final comments for a selected user.
          </p>
        </div>
        <button
          type="button"
          className={`${btnBase} ${btnCompact}`}
          onClick={() => {
            void loadUsers()
            if (selectedId != null) void loadJourney(selectedId)
          }}
          disabled={loadingUsers || loadingJourney}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error ? <StatusMessage type="error" message={error} /> : null}

      <div className={`${cardPanel} flex flex-wrap items-end gap-3`}>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Search</span>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-text" />
            <input
              type="search"
              className={`${fieldInput} pl-9`}
              placeholder="Email, user id, display name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </label>
        <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">User</span>
          <select
            className={fieldInput}
            value={selectedId ?? ''}
            onChange={(e) => {
              const value = e.target.value
              setSelectedId(value ? Number(value) : null)
            }}
            disabled={loadingUsers}
          >
            <option value="">Select a user…</option>
            {filteredUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email} · usr_{u.id}
                {u.display_name ? ` · ${u.display_name}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!selectedId ? (
        <div className={`${cardPanel} text-sm text-muted-text`}>
          Select a user to view their journey timeline and comments.
        </div>
      ) : (
        <>
          {selectedUser ? (
            <div className={`${cardPanel} text-sm`}>
              <p className="font-medium text-foreground">
                {('display_name' in selectedUser && selectedUser.display_name) ||
                  selectedUser.email}
              </p>
              <p className="mt-0.5 font-mono text-xs text-muted-text">
                {selectedUser.email} · usr_{selectedUser.id}
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <section className={cardPanel}>
              <h2 className="text-sm font-semibold text-foreground">Full journey</h2>
              <p className="mt-0.5 text-xs text-muted-text">
                Steps ordered by timestamp (jobs, audit, survey, errors)
              </p>
              {loadingJourney ? (
                <p className="mt-4 text-sm text-muted-text">Loading timeline…</p>
              ) : !journey || journey.steps.length === 0 ? (
                <p className="mt-4 text-sm text-muted-text">No journey steps for this user.</p>
              ) : (
                <ol className="mt-4">
                  {journey.steps.map((step) => (
                    <TimelineStep key={step.id} step={step} />
                  ))}
                </ol>
              )}
            </section>

            <section className={cardPanel}>
              <h2 className="text-sm font-semibold text-foreground">Voice of user</h2>
              <p className="mt-0.5 text-xs text-muted-text">
                Final comments from design grades, surveys, and bug reports
              </p>
              {loadingJourney ? (
                <p className="mt-4 text-sm text-muted-text">Loading comments…</p>
              ) : !journey || journey.comments.length === 0 ? (
                <p className="mt-4 text-sm text-muted-text">No comments for this user.</p>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {journey.comments.map((comment) => (
                    <CommentCard key={comment.id} comment={comment} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
