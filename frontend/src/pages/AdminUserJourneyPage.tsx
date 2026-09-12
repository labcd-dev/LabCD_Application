import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { AuthUser, JourneySession, UserJourney } from '../api/types'
import { JourneyComments } from '../components/admin/journey/JourneyComments'
import { JourneyDossierColumn } from '../components/admin/journey/JourneyDossierColumn'
import { JourneyHero } from '../components/admin/journey/JourneyHero'
import { JourneyKpiRow } from '../components/admin/journey/JourneyKpiRow'
import {
  JourneyTimeline,
  type TimelineKindGroup,
} from '../components/admin/journey/JourneyTimeline'
import { JourneyUserPicker } from '../components/admin/journey/JourneyUserPicker'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { btnBase, btnCompact, cardPanel, pageIntro, pageSection, pageTitle } from '../lib/classes'

type ViewTab = 'dossier' | 'timeline'

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
  const [tab, setTab] = useState<ViewTab>('dossier')
  const [kindFilter, setKindFilter] = useState<TimelineKindGroup>('all')
  const [projectFilterId, setProjectFilterId] = useState<number | null>(null)

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
    setKindFilter('all')
    setProjectFilterId(null)
    setTab('dossier')
    void loadJourney(selectedId)
  }, [canManage, selectedId, loadJourney])

  const onSelectSession = useCallback((session: JourneySession) => {
    setProjectFilterId(session.id)
    setKindFilter('all')
    setTab('timeline')
  }, [])

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
          <h1 className={pageTitle}>User intelligence</h1>
          <p className={pageIntro}>
            Dossier summary and ordered workflow timeline for a selected user.
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

      <JourneyUserPicker
        search={search}
        onSearchChange={setSearch}
        selectedId={selectedId}
        onSelect={setSelectedId}
        users={filteredUsers}
        loading={loadingUsers}
      />

      {!selectedId ? (
        <div className={`${cardPanel} text-sm text-muted-text`}>
          Select a user to view their dossier and journey timeline.
        </div>
      ) : (
        <>
          {journey && selectedUser ? (
            <JourneyHero user={journey.user} dossier={journey.dossier} />
          ) : selectedUser ? (
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

          {journey ? <JourneyKpiRow kpis={journey.dossier.kpis} /> : null}

          <div className="sticky top-0 z-10 -mx-1 flex gap-1.5 bg-surface/90 px-1 py-2 backdrop-blur-sm">
            {(
              [
                ['dossier', 'Dossier'],
                ['timeline', 'Timeline'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${btnCompact} rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  tab === id
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border bg-surface-elevated text-muted-text hover:text-foreground'
                }`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'dossier' ? (
            <div className="grid gap-3.5 lg:grid-cols-[1.35fr_1fr]">
              <div>
                {journey ? (
                  <JourneyDossierColumn
                    dossier={journey.dossier}
                    onSelectSession={onSelectSession}
                  />
                ) : (
                  <div className={`${cardPanel} text-sm text-muted-text`}>
                    {loadingJourney ? 'Loading dossier…' : 'No dossier data.'}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3.5">
                <JourneyComments
                  comments={journey?.comments ?? []}
                  loading={loadingJourney}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-3.5 lg:grid-cols-[1.4fr_1fr]">
              <JourneyTimeline
                steps={journey?.steps ?? []}
                loading={loadingJourney}
                kindFilter={kindFilter}
                onKindFilterChange={setKindFilter}
                projectFilterId={projectFilterId}
                onClearProjectFilter={() => setProjectFilterId(null)}
              />
              <JourneyComments
                comments={journey?.comments ?? []}
                loading={loadingJourney}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
