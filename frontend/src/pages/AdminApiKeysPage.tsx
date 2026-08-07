import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { KeyRound, RefreshCw } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { ApiKeyName, ApiKeyStatus, ApiKeysUpdate } from '../api/types'
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

const KEY_LABELS: Record<ApiKeyName, string> = {
  OPENAI_API_KEY: 'OpenAI',
  NVIDIA_API_KEY: 'NVIDIA',
  GROQ_API_KEY: 'Groq',
  CEREBRAS_API_KEY: 'Cerebras',
  TAVILY_API_KEY: 'Tavily (search)',
}

type DraftRow = {
  value: string
  clear: boolean
}

function emptyDrafts(keys: ApiKeyStatus[]): Record<string, DraftRow> {
  const drafts: Record<string, DraftRow> = {}
  for (const key of keys) {
    drafts[key.name] = { value: '', clear: false }
  }
  return drafts
}

export function AdminApiKeysPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:api_keys')
  const [keys, setKeys] = useState<ApiKeyStatus[]>([])
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({})
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await adminApi.getApiKeys()
      setKeys(response.keys)
      setDrafts(emptyDrafts(response.keys))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys')
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

  const updateDraft = (name: string, patch: Partial<DraftRow>) => {
    setDrafts((prev) => ({
      ...prev,
      [name]: { ...(prev[name] ?? { value: '', clear: false }), ...patch },
    }))
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const body: ApiKeysUpdate = {}
      for (const key of keys) {
        const draft = drafts[key.name]
        if (!draft) continue
        if (draft.clear) {
          body[key.name as ApiKeyName] = ''
        } else if (draft.value.trim()) {
          body[key.name as ApiKeyName] = draft.value.trim()
        }
      }
      if (Object.keys(body).length === 0) {
        setMessage('No changes to save.')
        return
      }
      const response = await adminApi.updateApiKeys(body)
      setKeys(response.keys)
      setDrafts(emptyDrafts(response.keys))
      setMessage('API keys saved. New jobs use the updated values immediately.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API keys')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>API keys</h1>
          <p className={pageIntro}>
            Manage LLM and search provider keys. Changes are written to{' '}
            <code className="text-sm">.env</code> and applied to new jobs without a restart.
          </p>
        </div>
        <button type="button" className={`${btnBase} ${btnCompact}`} onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </button>
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      <form className={cardPanel} onSubmit={(event) => void handleSave(event)}>
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden />
          Provider keys
        </div>

        {loading && keys.length === 0 ? (
          <p className="text-sm text-muted-text">Loading…</p>
        ) : (
          <div className="space-y-5">
            {keys.map((key) => {
              const draft = drafts[key.name] ?? { value: '', clear: false }
              const label = KEY_LABELS[key.name as ApiKeyName] ?? key.name
              return (
                <div key={key.name} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <code className="text-xs text-muted-text">{key.name}</code>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        key.configured
                          ? 'bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] text-foreground'
                          : 'bg-surface text-muted-text'
                      }`}
                    >
                      {key.configured ? `Configured ${key.masked_value}` : 'Not set'}
                    </span>
                  </div>
                  <label className={fieldLabel}>
                    <span>New value</span>
                    <input
                      type="password"
                      autoComplete="off"
                      className={fieldInput}
                      value={draft.value}
                      disabled={draft.clear || saving}
                      placeholder={key.configured ? 'Leave blank to keep current' : 'Paste API key'}
                      onChange={(event) => updateDraft(key.name, { value: event.target.value, clear: false })}
                    />
                  </label>
                  <label className={fieldCheckbox}>
                    <input
                      type="checkbox"
                      checked={draft.clear}
                      disabled={saving || !key.configured}
                      onChange={(event) =>
                        updateDraft(key.name, {
                          clear: event.target.checked,
                          value: event.target.checked ? '' : draft.value,
                        })
                      }
                    />
                    <span className="text-sm">Clear this key</span>
                  </label>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="submit" className={btnPrimary} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
