import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Plus, Shield } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { SsoProviderAdmin, SsoProviderKey } from '../api/types'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldCheckbox,
  fieldInput,
  fieldLabel,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

type FormState = {
  provider: SsoProviderKey
  display_name: string
  client_id: string
  client_secret: string
  enabled: boolean
}

export function AdminSsoPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:sso')
  const [providers, setProviders] = useState<SsoProviderAdmin[]>([])
  const [form, setForm] = useState<FormState>({
    provider: 'google',
    display_name: 'Google',
    client_id: '',
    client_secret: '',
    enabled: false,
  })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProviders(await adminApi.listSsoProviders())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SSO providers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const configuredProviders = new Set(providers.map((p) => p.provider))
  const canAddMore = configuredProviders.size < 2

  const openCreate = () => {
    const provider: SsoProviderKey = !configuredProviders.has('google') ? 'google' : 'github'
    setEditingId(null)
    setForm({
      provider,
      display_name: provider === 'google' ? 'Google' : 'GitHub',
      client_id: '',
      client_secret: '',
      enabled: false,
    })
    setShowForm(true)
    setMessage(null)
    setError(null)
  }

  const openEdit = (row: SsoProviderAdmin) => {
    setEditingId(row.id)
    setForm({
      provider: row.provider,
      display_name: row.display_name,
      client_id: row.client_id,
      client_secret: '',
      enabled: row.enabled,
    })
    setShowForm(true)
    setMessage(null)
    setError(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (editingId == null) {
        await adminApi.createSsoProvider({
          provider: form.provider,
          display_name: form.display_name.trim(),
          client_id: form.client_id.trim(),
          client_secret: form.client_secret.trim(),
          enabled: form.enabled,
        })
        setMessage('SSO provider created.')
      } else {
        const body: {
          display_name: string
          client_id: string
          enabled: boolean
          client_secret?: string
        } = {
          display_name: form.display_name.trim(),
          client_id: form.client_id.trim(),
          enabled: form.enabled,
        }
        if (form.client_secret.trim()) {
          body.client_secret = form.client_secret.trim()
        }
        await adminApi.updateSsoProvider(editingId, body)
        setMessage('SSO provider updated.')
      }
      setShowForm(false)
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save SSO provider')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row: SsoProviderAdmin) => {
    if (!window.confirm(`Delete ${row.display_name} (${row.provider})?`)) return
    setError(null)
    setMessage(null)
    try {
      await adminApi.deleteSsoProvider(row.id)
      setMessage('SSO provider deleted.')
      if (editingId === row.id) {
        setShowForm(false)
        setEditingId(null)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete SSO provider')
    }
  }

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>SSO providers</h1>
          <p className={pageIntro}>
            Configure Google and GitHub OAuth apps. Callback URLs must match{' '}
            <code className="text-sm">API_PUBLIC_URL</code> +{' '}
            <code className="text-sm">/api/v1/auth/sso/{'{provider}'}/callback</code>.
          </p>
        </div>
        <button type="button" className={btnPrimary} onClick={openCreate} disabled={!canAddMore}>
          <Plus className="h-4 w-4" />
          Add provider
        </button>
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      {showForm && (
        <form className={`${cardPanel} mt-4 space-y-3`} onSubmit={(e) => void handleSubmit(e)}>
          <h2 className="m-0 text-lg font-semibold text-foreground">
            {editingId == null ? 'New provider' : 'Edit provider'}
          </h2>
          <label className={fieldLabel}>
            <span>Provider</span>
            <select
              className={fieldInput}
              value={form.provider}
              disabled={editingId != null}
              onChange={(e) => {
                const provider = e.target.value as SsoProviderKey
                setForm((prev) => ({
                  ...prev,
                  provider,
                  display_name:
                    prev.display_name === 'Google' ||
                    prev.display_name === 'GitHub' ||
                    !prev.display_name
                      ? provider === 'google'
                        ? 'Google'
                        : 'GitHub'
                      : prev.display_name,
                }))
              }}
            >
              <option value="google" disabled={editingId == null && configuredProviders.has('google')}>
                Google
              </option>
              <option value="github" disabled={editingId == null && configuredProviders.has('github')}>
                GitHub
              </option>
            </select>
          </label>
          <label className={fieldLabel}>
            <span>Display name</span>
            <input
              className={fieldInput}
              required
              value={form.display_name}
              onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
            />
          </label>
          <label className={fieldLabel}>
            <span>Client ID</span>
            <input
              className={fieldInput}
              required
              value={form.client_id}
              onChange={(e) => setForm((prev) => ({ ...prev, client_id: e.target.value }))}
            />
          </label>
          <label className={fieldLabel}>
            <span>
              Client secret
              {editingId != null ? ' (leave blank to keep current)' : ''}
            </span>
            <input
              className={fieldInput}
              type="password"
              autoComplete="new-password"
              required={editingId == null}
              value={form.client_secret}
              onChange={(e) => setForm((prev) => ({ ...prev, client_secret: e.target.value }))}
            />
          </label>
          <label className={fieldCheckbox}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            <span>Enabled on login page</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className={`${btnBase} ${btnCompact}`}
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className={`${cardPanel} mt-4 overflow-x-auto`}>
        {loading ? (
          <p className="m-0 text-sm text-muted-text">Loading…</p>
        ) : providers.length === 0 ? (
          <div className="flex items-start gap-3 text-sm text-muted-text">
            <Shield className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="m-0">No SSO providers configured yet.</p>
          </div>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-text">
                <th className="px-2 py-2 font-medium">Provider</th>
                <th className="px-2 py-2 font-medium">Display name</th>
                <th className="px-2 py-2 font-medium">Client ID</th>
                <th className="px-2 py-2 font-medium">Secret</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((row) => (
                <tr key={row.id} className="border-b border-border/70">
                  <td className="px-2 py-3 capitalize">{row.provider}</td>
                  <td className="px-2 py-3">{row.display_name}</td>
                  <td className="px-2 py-3 font-mono text-xs">{row.client_id}</td>
                  <td className="px-2 py-3 font-mono text-xs">
                    {row.client_secret_configured ? row.client_secret_masked : '—'}
                  </td>
                  <td className="px-2 py-3">{row.enabled ? 'Enabled' : 'Disabled'}</td>
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`${btnBase} ${btnCompact}`}
                        onClick={() => openEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`${btnBase} ${btnCompact}`}
                        onClick={() => void handleDelete(row)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
