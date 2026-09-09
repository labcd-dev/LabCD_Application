import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { adaptiveApi } from '../../api/endpoints'
import { btnBase, btnCompact, btnPrimary } from '../../lib/classes'

interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

interface AdaptiveDiagnosisChatProps {
  jobId: string
}

export function AdaptiveDiagnosisChat({ jobId }: AdaptiveDiagnosisChatProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    const message = draft.trim()
    if (!message || pending) return
    setError(null)
    setDraft('')
    const nextHistory = [...turns, { role: 'user' as const, text: message }]
    setTurns(nextHistory)
    setPending(true)
    try {
      const res = await adaptiveApi.diagnosisChat(jobId, {
        message,
        history: turns.map((t) => ({ role: t.role, text: t.text })),
      })
      setTurns((prev) => [...prev, { role: 'assistant', text: res.reply }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Follow-up chat failed')
      setTurns((prev) => prev.slice(0, -1))
      setDraft(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3 space-y-2">
      <div className="text-xs font-semibold text-foreground">Ask about this diagnosis</div>
      <div className="max-h-48 overflow-y-auto space-y-2 text-xs">
        {turns.length === 0 && (
          <p className="text-muted-text">
            Ask why the run failed, what a suggestion means, or how to tune the next attempt.
          </p>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`rounded-lg px-2.5 py-1.5 ${
              t.role === 'user'
                ? 'bg-cyan-500/10 text-foreground ml-6'
                : 'bg-surface-muted text-muted-text mr-6'
            }`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-text block mb-0.5">
              {t.role === 'user' ? 'You' : 'Diagnoser'}
            </span>
            {t.text}
          </div>
        ))}
      </div>
      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          placeholder="Follow-up question…"
          className="flex-1 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-text focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className={`${btnBase} ${btnCompact} ${btnPrimary} text-xs disabled:opacity-50`}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        </button>
      </form>
    </div>
  )
}
