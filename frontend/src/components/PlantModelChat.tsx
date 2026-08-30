import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'
import { plantModelApi, triggerBlobDownload } from '../api/endpoints'
import type {
  PlantModelChatMessage,
  PlantModelResult,
  PlantModelSessionState,
} from '../api/types'
import { useAuth } from '../context/AuthContext'
import { AUTO_MODEL, resolveChatModel } from '../lib/modelPicker'
import { btnBase, btnCompact, btnPrimary } from '../lib/classes'
import { CodePreview } from './CodePreview'
import { ComposerModelPicker } from './ComposerModelPicker'
import { MarkdownContent } from './MarkdownContent'
import { StatusMessage } from './StatusMessage'

const CHIPS = [
  {
    label: 'Boost converter · 12V → 48V',
    prompt: 'Boost converter, 12V to 48V, want tight settling under load steps',
  },
  {
    label: 'Quadrotor altitude hold',
    prompt: 'Quadrotor altitude hold, need to reject wind gusts',
  },
  {
    label: 'CSTR reactor temperature',
    prompt: 'CSTR reactor temperature loop, slow thermal lag',
  },
  {
    label: 'Paste a transfer function',
    prompt: 'I have a transfer function I want to paste in',
  },
]

interface PlantModelChatProps {
  model: string
  models: string[]
  onModelChange: (model: string) => void
  disabled?: boolean
  onUseModel: (result: PlantModelResult) => void
  continueLabel?: string
  continueIcon?: ReactNode
}

function userInitials(user: { display_name: string | null; email: string } | null): string {
  if (!user) return 'U'
  const source = user.display_name?.trim() || user.email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function autoresize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

export function PlantModelChat({
  model: _model = AUTO_MODEL,
  models,
  onModelChange,
  disabled = false,
  onUseModel,
  continueLabel = 'Configure & launch →',
  continueIcon,
}: PlantModelChatProps) {
  const { user } = useAuth()
  const initials = userInitials(user)
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const newChatRequest = (location.state as { newChat?: number } | null)?.newChat

  const [messages, setMessages] = useState<PlantModelChatMessage[]>([])
  const [sessionState, setSessionState] = useState<PlantModelSessionState | null>(null)
  const [finalResult, setFinalResult] = useState<PlantModelResult | null>(null)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastOpen, setToastOpen] = useState(false)
  const [selection, setSelection] = useState(AUTO_MODEL)
  const deepLinkHandled = useRef<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const landingInputRef = useRef<HTMLTextAreaElement>(null)
  const threadInputRef = useRef<HTMLTextAreaElement>(null)

  const inChat = messages.length > 0 || finalResult !== null
  const chatDisabled = disabled || loading
  const draft = finalResult ?? sessionState?.latest_draft ?? null
  const resolvedModel = resolveChatModel(selection, models)
  const progressPct = finalResult
    ? 100
    : sessionState?.latest_draft
      ? Math.min(90, 35 + (sessionState.draft_count || 1) * 20)
      : messages.length > 0
        ? Math.min(30, messages.length * 8)
        : 0

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading, finalResult])

  const syncConversationParam = (id: number | null) => {
    const current = searchParams.get('conversation')
    const nextValue = id != null ? String(id) : null
    if (current === nextValue) return
    const next = new URLSearchParams(searchParams)
    if (nextValue) next.set('conversation', nextValue)
    else next.delete('conversation')
    setSearchParams(next, { replace: true })
  }

  const handleSelectionChange = (next: string) => {
    setSelection(next)
    onModelChange(resolveChatModel(next, models))
  }

  const resetConversation = () => {
    setMessages([])
    setSessionState(null)
    setFinalResult(null)
    setConversationId(null)
    setInput('')
    setError(null)
    setToastOpen(false)
    setSelection(AUTO_MODEL)
    deepLinkHandled.current = null
    syncConversationParam(null)
    requestAnimationFrame(() => landingInputRef.current?.focus())
  }

  useEffect(() => {
    if (newChatRequest == null) return
    resetConversation()
    // Reset when the header New chat control fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newChatRequest])

  const openConversation = async (id: number) => {
    setError(null)
    try {
      const detail = await plantModelApi.getConversation(id)
      setConversationId(detail.id)
      setMessages(detail.messages)
      setSessionState(detail.session_state)
      setFinalResult(detail.final_result)
      setToastOpen(false)
      setInput('')
      syncConversationParam(detail.id)
      if (detail.llm_model) {
        setSelection(detail.llm_model)
        onModelChange(detail.llm_model)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open conversation')
    }
  }

  useEffect(() => {
    const raw = searchParams.get('conversation')
    if (!raw) return
    if (deepLinkHandled.current === raw) return
    const id = Number(raw)
    if (!Number.isFinite(id) || id <= 0) return
    deepLinkHandled.current = raw
    if (conversationId === id) return
    void openConversation(id)
    // Intentionally only when the query param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const sendMessage = async (raw?: string) => {
    const trimmed = (raw ?? input).trim()
    if (!trimmed || chatDisabled) return

    setError(null)
    setLoading(true)
    setInput('')
    if (threadInputRef.current) {
      threadInputRef.current.style.height = 'auto'
    }

    const historyBefore = messages
    const userMessage: PlantModelChatMessage = { role: 'user', content: trimmed }
    setMessages((prev) => [...prev, userMessage])

    try {
      const response = await plantModelApi.chat({
        messages: historyBefore,
        user_message: trimmed,
        model: resolvedModel,
        session_state: sessionState,
        conversation_id: conversationId,
      })

      onModelChange(resolvedModel)

      if (response.conversation_id != null) {
        setConversationId(response.conversation_id)
        deepLinkHandled.current = String(response.conversation_id)
        syncConversationParam(response.conversation_id)
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: response.reply }])
      setSessionState(response.session_state)
      if (response.final_result) {
        setFinalResult(response.final_result)
      } else if (response.status !== 'complete') {
        // Allow revise: clear the locked plant panel until a new complete result arrives.
        setFinalResult(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat request failed')
      setMessages((prev) => prev.slice(0, -1))
      setInput(trimmed)
    } finally {
      setLoading(false)
      requestAnimationFrame(() => threadInputRef.current?.focus())
    }
  }

  const handleConfirm = () => {
    if (!finalResult) return
    setToastOpen(true)
  }

  const caseStudiesHref =
    conversationId != null ? `/case-studies?new=${conversationId}` : '/case-studies'

  const handleLaunch = () => {
    if (!finalResult) return
    onUseModel(finalResult)
  }

  const handleDownload = () => {
    if (!finalResult) return
    triggerBlobDownload(
      new Blob([finalResult.python_code], { type: 'text/x-python' }),
      'dynamics.py',
    )
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  const plantRows: { k: string; v: string }[] = []
  if (draft) {
    plantRows.push({ k: 'System', v: draft.system_name })
    if (sessionState?.draft_count) {
      plantRows.push({ k: 'Drafts', v: String(sessionState.draft_count) })
    }
    plantRows.push({
      k: 'Status',
      v: finalResult ? 'Ready to confirm' : 'Draft in progress',
    })
    plantRows.push({ k: 'Artifact', v: 'dynamics(t, x, u) · Python' })
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Landing */}
        {!inChat && (
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <div className="w-full max-w-[620px] text-center">
              <div className="mb-[22px] inline-flex items-center gap-2 text-xs font-semibold text-muted">
                <span className="size-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_8px_color-mix(in_srgb,var(--app-primary)_50%,transparent)]" />
                Describe a system, get a plant model
              </div>
              <h1 className="mb-3 text-[clamp(28px,4vw,38px)] font-bold tracking-[-0.03em] text-foreground">
                What&apos;s on your mind?
              </h1>
              <p className="mx-auto mb-8 max-w-[440px] text-[15px] leading-relaxed text-muted-text">
                Tell me about the system you want to control — a converter, a drone, a reactor,
                anything with dynamics. We&apos;ll turn the conversation into a plant model together,
                no file required.
              </p>

              {error && (
                <div className="mb-4 text-left">
                  <StatusMessage type="error" message={error} />
                </div>
              )}

              <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-elevated px-3 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.35)] transition-[border-color] duration-150 focus-within:border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)]">
                <textarea
                  ref={landingInputRef}
                  rows={1}
                  className="max-h-40 w-full resize-none border-none bg-transparent px-1.5 py-2 font-inherit text-[14.5px] leading-normal text-foreground outline-none placeholder:text-muted"
                  placeholder="e.g. A buck-boost converter stepping 12V up to 48V, some ESR on the inductor..."
                  value={input}
                  disabled={chatDisabled}
                  onChange={(e) => {
                    setInput(e.target.value)
                    autoresize(e.target)
                  }}
                  onKeyDown={onComposerKeyDown}
                />
                <div className="flex items-center justify-between gap-2">
                  <ComposerModelPicker
                    models={models}
                    value={selection}
                    onChange={handleSelectionChange}
                    disabled={chatDisabled}
                  />
                  <button
                    type="button"
                    className="grid size-9 shrink-0 place-items-center rounded-[10px] border-none bg-gradient-to-br from-primary to-[#4a63e0] text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--app-primary)_30%,transparent)] transition-[filter,transform] duration-[130ms] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                    disabled={chatDisabled || !input.trim()}
                    aria-label="Send"
                    onClick={() => void sendMessage()}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-4"
                      aria-hidden
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="mt-[18px] flex flex-wrap justify-center gap-2">
                {CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    disabled={chatDisabled}
                    className="cursor-pointer rounded-full border border-border bg-surface-elevated px-3.5 py-[7px] text-[12.5px] font-medium text-muted-text transition-all duration-[130ms] hover:border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void sendMessage(chip.prompt)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <div className="mt-7 text-[12.5px] text-muted">
                Already have systems worked out?{' '}
                <Link
                  to="/case-studies"
                  className="font-semibold text-primary no-underline hover:underline"
                >
                  Browse case studies →
                </Link>
                {' · '}
                <Link
                  to="/studio"
                  className="font-semibold text-primary no-underline hover:underline"
                >
                  Upload a file instead
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Chat layout */}
        {inChat && (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_340px]">
            <div className="flex min-h-0 flex-col border-border lg:border-r">
              {error && (
                <div className="px-5 pt-3 sm:px-8">
                  <StatusMessage type="error" message={error} />
                </div>
              )}

              <div
                ref={listRef}
                className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-7 sm:px-8"
                aria-live="polite"
              >
                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`flex max-w-[640px] gap-3 ${
                      message.role === 'user' ? 'flex-row-reverse self-end' : ''
                    }`}
                  >
                    <div
                      className={`mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-lg text-[10px] font-bold ${
                        message.role === 'assistant'
                          ? 'bg-gradient-to-br from-primary to-accent-2 text-white'
                          : 'border border-border bg-surface-muted text-muted-text'
                      }`}
                    >
                      {message.role === 'user' ? initials : 'L'}
                    </div>
                    <div
                      className={`rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                        message.role === 'assistant'
                          ? 'border border-border bg-surface-elevated text-foreground'
                          : 'border border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-foreground'
                      }`}
                    >
                      {message.role === 'assistant' ? (
                        <MarkdownContent content={message.content} className="plant-chat-md" />
                      ) : (
                        <p className="m-0 whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex max-w-[640px] gap-3">
                    <div className="mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent-2 text-[10px] font-bold text-white">
                      L
                    </div>
                    <div className="rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5">
                      <div className="flex gap-1 px-0.5 py-1">
                        <span className="size-[5px] animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
                        <span className="size-[5px] animate-bounce rounded-full bg-muted [animation-delay:150ms]" />
                        <span className="size-[5px] animate-bounce rounded-full bg-muted [animation-delay:300ms]" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-border px-5 py-4 sm:px-8 sm:pb-5">
                <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-elevated px-3 py-2.5 transition-[border-color] duration-150 focus-within:border-[color-mix(in_srgb,var(--app-primary)_28%,transparent)]">
                  <textarea
                    ref={threadInputRef}
                    rows={1}
                    className="max-h-40 w-full resize-none border-none bg-transparent px-1.5 py-2 font-inherit text-[14.5px] leading-normal text-foreground outline-none placeholder:text-muted disabled:opacity-60"
                    placeholder={
                      finalResult
                        ? 'Conversation complete — start a new chat to design another system.'
                        : 'Reply...'
                    }
                    value={input}
                    disabled={chatDisabled}
                    onChange={(e) => {
                      setInput(e.target.value)
                      autoresize(e.target)
                    }}
                    onKeyDown={onComposerKeyDown}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <ComposerModelPicker
                      models={models}
                      value={selection}
                      onChange={handleSelectionChange}
                      disabled={disabled || loading}
                    />
                    <button
                      type="button"
                      className="grid size-9 shrink-0 place-items-center rounded-[10px] border-none bg-gradient-to-br from-primary to-[#4a63e0] text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--app-primary)_30%,transparent)] transition-[filter] duration-[130ms] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                      disabled={chatDisabled || !input.trim()}
                      aria-label="Send"
                      onClick={() => void sendMessage()}
                    >
                      {loading ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="size-4"
                          aria-hidden
                        >
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Plant model side panel */}
            <aside className="hidden min-h-0 flex-col bg-surface-elevated lg:flex">
              <div className="border-b border-border px-5 pb-3.5 pt-[18px]">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                  Building
                </div>
                <h3 className="m-0 text-[15px] font-semibold text-foreground">Plant model</h3>
              </div>

              <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
                {plantRows.length === 0 ? (
                  <p className="m-0 px-2.5 py-[30px] text-center text-[12.5px] leading-relaxed text-muted">
                    As we talk through the system, the model takes shape here — structure, order, and
                    the parameters that matter for control.
                  </p>
                ) : (
                  plantRows.map((row) => (
                    <div
                      key={row.k}
                      className="flex items-start justify-between gap-3 rounded-[10px] border border-border-subtle bg-surface-muted px-3 py-2.5"
                    >
                      <div className="text-[11.5px] font-semibold text-muted">{row.k}</div>
                      <div className="text-right font-mono text-[12.5px] text-foreground">{row.v}</div>
                    </div>
                  ))
                )}

                {draft && (
                  <div className="mt-1 overflow-hidden rounded-[10px] border border-border-subtle">
                    <CodePreview value={draft.python_code} readOnly height={180} language="python" />
                  </div>
                )}
              </div>

              <div className="px-5 pb-4 pt-1">
                <div className="h-1 overflow-hidden rounded-sm bg-surface-muted">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-[var(--app-status-success-text)] transition-[width] duration-400"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div
                  className={`mt-1.5 text-[11px] ${
                    progressPct >= 100 ? 'text-[var(--app-status-success-text)]' : 'text-muted'
                  }`}
                >
                  {progressPct >= 100
                    ? 'Model complete — ready to confirm'
                    : progressPct === 0
                      ? 'Not started'
                      : `${progressPct}% shaped`}
                </div>
              </div>

              <div className="border-t border-border px-5 pb-5 pt-4">
                {finalResult && (
                  <button
                    type="button"
                    className={`${btnBase} ${btnCompact} mb-2 w-full justify-center`}
                    onClick={handleDownload}
                  >
                    Download dynamics.py
                  </button>
                )}
                <button
                  type="button"
                  className={`${btnPrimary} w-full justify-center py-2.5 text-[13.5px]`}
                  disabled={!finalResult || disabled}
                  onClick={handleConfirm}
                >
                  Confirm system
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* Mobile confirm when complete */}
        {inChat && finalResult && (
          <div className="border-t border-border px-4 py-3 lg:hidden">
            <button
              type="button"
              className={`${btnPrimary} w-full justify-center`}
              disabled={disabled}
              onClick={handleConfirm}
            >
              Confirm system
            </button>
          </div>
        )}
      </div>

      {/* Toast */}
      <div
        className={`fixed bottom-[26px] left-1/2 z-[500] flex items-center gap-3.5 rounded-xl border border-border bg-surface-muted px-4 py-3.5 shadow-[0_16px_50px_rgba(0,0,0,0.5)] transition-all duration-250 ${
          toastOpen
            ? 'pointer-events-auto translate-x-[-50%] translate-y-0 opacity-100'
            : 'pointer-events-none translate-x-[-50%] translate-y-5 opacity-0'
        }`}
      >
        <div className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-[var(--app-status-success-bg)] text-[var(--app-status-success-text)]">
          <Check className="size-[15px]" strokeWidth={2.5} aria-hidden />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-foreground">Ready for Studio</div>
          <div className="text-xs text-muted">{finalResult?.system_name ?? 'Plant model'}</div>
        </div>
        <div className="ml-2 flex gap-2">
          <Link to={caseStudiesHref} className={`${btnBase} ${btnCompact}`}>
            Library
          </Link>
          <button
            type="button"
            className={`${btnPrimary} ${btnCompact}`}
            onClick={handleLaunch}
          >
            {continueLabel}
            {continueIcon}
          </button>
        </div>
      </div>
    </div>
  )
}
