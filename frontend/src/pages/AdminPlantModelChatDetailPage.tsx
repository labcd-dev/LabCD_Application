import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { adminApi } from '../api/endpoints'
import type { PlantModelConversationDetail } from '../api/types'
import { CodePreview } from '../components/CodePreview'
import { MarkdownContent } from '../components/MarkdownContent'
import { StatusMessage } from '../components/StatusMessage'
import { btnBase, btnCompact, cardPanel } from '../lib/classes'
import { statusBadgeClass } from '../lib/projectLabels'

export function AdminPlantModelChatDetailPage() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const id = Number(conversationId)
  const [conversation, setConversation] = useState<PlantModelConversationDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setError('Invalid conversation id')
      setLoading(false)
      return
    }
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        setConversation(await adminApi.getPlantModelConversation(id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load conversation')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [id])

  const handleDelete = async () => {
    if (!conversation) return
    if (!window.confirm('Delete this plant-model chat? This cannot be undone.')) return
    try {
      await adminApi.deletePlantModelConversation(conversation.id)
      navigate('/admin/plant-model', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete chat')
    }
  }

  if (loading) {
    return <p className="text-muted-text">Loading conversation…</p>
  }

  if (!conversation) {
    return (
      <div className="space-y-4">
        {error && <StatusMessage type="error" message={error} />}
        <Link to="/admin/plant-model" className={btnBase}>
          <ArrowLeft className="size-4" />
          Back
        </Link>
      </div>
    )
  }

  const model = conversation.final_result
  const draft = conversation.session_state?.latest_draft

  return (
    <div className="admin-fade-in space-y-6">
      <Link to="/admin/plant-model" className={`${btnBase} ${btnCompact} w-fit`}>
        <ArrowLeft className="size-3.5" />
        All chats
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-foreground">
            {conversation.final_result?.system_name || conversation.title}
          </h1>
          <p className="m-0 text-muted-text">
            Owner: {conversation.owner_email ?? `user #${conversation.user_id}`} ·{' '}
            {conversation.llm_model}
          </p>
          <span className={statusBadgeClass(conversation.status)}>{conversation.status}</span>
        </div>
        <button type="button" className={btnBase} onClick={() => void handleDelete()}>
          <Trash2 className="size-3.5" />
          Delete
        </button>
      </header>

      {error && <StatusMessage type="error" message={error} />}

      {(model || draft) && (
        <div className={cardPanel}>
          <h2 className="m-0 mb-3 text-lg font-semibold text-foreground">
            {model ? 'Final plant model' : 'Latest draft'}
          </h2>
          <p className="mt-0 mb-3 text-sm text-muted-text">
            {(model ?? draft)?.system_name}
          </p>
          <CodePreview
            value={(model ?? draft)?.python_code ?? ''}
            readOnly
            height={280}
            language="python"
          />
        </div>
      )}

      <div className={cardPanel}>
        <h2 className="m-0 mb-4 text-lg font-semibold text-foreground">Messages</h2>
        {conversation.messages.length === 0 ? (
          <p className="m-0 text-sm text-muted-text">No messages in this conversation.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {conversation.messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`rounded-xl border px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                  message.role === 'assistant'
                    ? 'border-border bg-surface-muted text-foreground'
                    : 'border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--app-primary)_10%,transparent)] text-foreground'
                }`}
              >
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {message.role}
                </div>
                {message.role === 'assistant' ? (
                  <MarkdownContent content={message.content} className="plant-chat-md" />
                ) : (
                  <p className="m-0 whitespace-pre-wrap">{message.content}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
