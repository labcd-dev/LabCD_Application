import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  Activity,
  ArrowUp,
  Brain,
  CheckCircle2,
  FileCode,
  FileText,
  Loader2,
  RefreshCw,
  Sliders,
  Sparkles,
  StopCircle,
  User,
} from 'lucide-react'
import { MarkdownContent } from '../MarkdownContent'
import { MpcThinkingBlock } from './MpcThinkingBlock'
import { MpcParameterDrawer, type MpcTuningParams } from './MpcParameterDrawer'
import type { MPCJobResultsResponse, MPCJobStatusResponse } from '../../api/types'
import { btnBase, btnCompact, btnPrimary } from '../../lib/classes'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /** Specific parameters associated with this user prompt */
  paramsSummary?: string
  /** Whether this turn is currently in-flight */
  pending?: boolean
  /** Duration in seconds of the synthesis run */
  durationSec?: number
  /** Job results snapshot if available */
  results?: MPCJobResultsResponse | null
  /** Specific sub-type of message: 'mpc_run' | 'followup_chat' */
  kind?: 'mpc_run' | 'followup_chat'
}

interface ReasoningLogItem {
  id: number
  agent: string
  badgeColor: string
  text: string
  round: number | null
}

interface MpcChatPaneProps {
  systemName: string
  isRunning: boolean
  elapsedSec: number
  job: MPCJobStatusResponse | null
  results: MPCJobResultsResponse | null
  reasoningLogs: ReasoningLogItem[]
  messages: ChatMessage[]
  onSendMessage: (text: string, params: MpcTuningParams) => void
  onAskFollowUp: (text: string) => void
  onCancelJob: () => void
  onResetSession: () => void
  onSelectTab: (tab: 'waveform' | 'code' | 'logs' | 'schematic' | 'sandbox') => void
  onDownloadReport: () => void
  downloadingPdf: boolean
  currentParams: MpcTuningParams
  onChangeParams: (updated: Partial<MpcTuningParams>) => void
  onResetParamsDefaults: () => void
  onOpenSetup?: () => void
}

const PRESETS = [
  {
    title: '⚡ Nominal Fast Tracking',
    prompt: 'Tune nominal MPC for fast tracking with Np=12, Nc=4 and balanced state weights.',
    params: { np: 12, nc: 4, scenarioLevel: 1 as const, qWeightsInput: '10.0, 1.0, 10.0, 1.0', rWeightsInput: '0.1' },
  },
  {
    title: '🛡️ Robust Disturbance Rejection',
    prompt: 'Optimize MPC under 20% model drift and external step gust disturbances.',
    params: { np: 16, nc: 5, scenarioLevel: 3 as const, customDriftPct: 20, disturbanceAmp: 1.0, qWeightsInput: '25.0, 2.0, 25.0, 2.0', rWeightsInput: '0.05' },
  },
  {
    title: '🎯 Smooth Conservative Actuation',
    prompt: 'Synthesize smooth MPC controller with high actuator penalties (R=1.0) to prevent actuator saturation.',
    params: { np: 12, nc: 4, scenarioLevel: 1 as const, rWeightsInput: '1.0' },
  },
  {
    title: '🏎️ Rapid Setpoint Convergence',
    prompt: 'Apply aggressive state tracking weights (Q=50.0) for rapid rise time and minimal steady-state offset.',
    params: { np: 18, nc: 6, scenarioLevel: 1 as const, qWeightsInput: '50.0, 5.0, 50.0, 5.0', rWeightsInput: '0.02' },
  },
]

export function MpcChatPane({
  systemName,
  isRunning,
  elapsedSec,
  job,
  results,
  reasoningLogs,
  messages,
  onSendMessage,
  onAskFollowUp,
  onCancelJob,
  onResetSession,
  onSelectTab,
  onDownloadReport,
  downloadingPdf,
  currentParams,
  onChangeParams,
  onResetParamsDefaults,
  onOpenSetup,
}: MpcChatPaneProps) {
  const [inputText, setInputText] = useState('')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom when messages update or when job updates
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [messages.length, isRunning, reasoningLogs.length])

  const handleSend = () => {
    const text = inputText.trim()
    if (!text || isRunning) return
    setInputText('')

    // Check if a job is already complete and user is asking a conversational question
    const isFollowUpQuery =
      results &&
      (text.toLowerCase().startsWith('why') ||
        text.toLowerCase().startsWith('how') ||
        text.toLowerCase().startsWith('what') ||
        text.toLowerCase().startsWith('explain') ||
        text.toLowerCase().includes('?') ||
        text.toLowerCase().includes('چرا') ||
        text.toLowerCase().includes('چطور') ||
        text.toLowerCase().includes('توضیح'))

    if (isFollowUpQuery && job?.job_id) {
      onAskFollowUp(text)
    } else {
      onSendMessage(text, currentParams)
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePresetClick = (preset: typeof PRESETS[0]) => {
    onChangeParams(preset.params)
    onSendMessage(preset.prompt, { ...currentParams, ...preset.params })
  }

  return (
    <div className="flex h-full flex-col min-h-0 bg-surface border-r border-border relative">
      {/* Chat Header Bar */}
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-border bg-surface-elevated/75 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-7 items-center justify-center rounded-lg border border-purple-500/30 bg-purple-500/15 text-purple-400">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">Agentic MPC Copilot</span>
              <span className="rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.2 text-[10px] font-semibold text-purple-300">
                Autonomous Tuning
              </span>
            </div>
            <p className="truncate text-[10.5px] text-muted-text">
              Target: <span className="font-mono text-foreground font-semibold">{systemName}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {onOpenSetup && (
            <button
              type="button"
              onClick={onOpenSetup}
              className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-300 hover:bg-purple-500/20 transition-colors"
              title="Return to setup and reference trajectory configuration"
            >
              <Sliders className="size-3.5 text-purple-400" />
              <span className="hidden sm:inline">Setup Screen</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-border bg-surface-muted px-2.5 py-1 text-xs text-foreground hover:bg-surface-hover transition-colors"
            title="Configure controller levers & horizons"
          >
            <Sliders className="size-3.5 text-purple-400" />
            <span className="hidden sm:inline font-mono text-[11px]">
              Np={currentParams.np} Nc={currentParams.nc}
            </span>
          </button>

          {messages.length > 0 && !isRunning && (
            <button
              type="button"
              onClick={onResetSession}
              className="rounded-lg p-1.5 text-muted-text hover:bg-surface-hover hover:text-foreground transition-colors"
              title="Start new conversation / reconfigure"
            >
              <RefreshCw className="size-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* Messages Scroll Area */}
      <div
        ref={chatScrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-border"
      >
        {/* Empty State Welcome Card */}
        {messages.length === 0 && (
          <div className="mx-auto max-w-xl py-6 text-center space-y-4 animate-in fade-in-50 duration-300">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-purple-500/30 bg-gradient-to-tr from-purple-500/20 via-indigo-500/10 to-transparent shadow-lg shadow-purple-500/10 text-purple-400">
              <Brain className="size-7" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-foreground">
                How can I optimize your MPC controller?
              </h2>
              <p className="text-xs text-muted-text max-w-md mx-auto leading-relaxed">
                I autonomously formulate QP active-set horizons, state weights ($Q$), actuator penalties ($R$), and verify closed-loop stability across multi-agent iterations.
              </p>
            </div>

            {/* Quick Prompt Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left pt-2">
              {PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handlePresetClick(p)}
                  className="group flex flex-col justify-between rounded-xl border border-border bg-surface-elevated/70 p-3 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-left"
                >
                  <span className="text-xs font-semibold text-foreground group-hover:text-purple-300 transition-colors">
                    {p.title}
                  </span>
                  <span className="mt-1 text-[11px] text-muted-text line-clamp-2">
                    {p.prompt}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message History */}
        {messages.map((msg) => (
          <div key={msg.id} className="space-y-2 animate-in fade-in-50 duration-200">
            {/* User Message */}
            {msg.role === 'user' && (
              <div className="flex justify-end gap-2.5">
                <div className="max-w-[85%] rounded-2xl rounded-tr-xs border border-purple-500/30 bg-gradient-to-br from-purple-600/20 via-purple-700/15 to-indigo-600/20 px-4 py-2.5 text-foreground shadow-sm">
                  <div className="text-xs font-medium leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                  {msg.paramsSummary && (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-purple-500/20 pt-1.5">
                      <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[9.5px] text-purple-300">
                        {msg.paramsSummary}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white text-xs font-bold shadow-xs">
                  <User className="size-4" />
                </div>
              </div>
            )}

            {/* Assistant Message */}
            {msg.role === 'assistant' && (
              <div className="flex gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-purple-500/30 bg-purple-500/20 text-purple-400 text-xs shadow-xs">
                  <Sparkles className="size-4" />
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  {/* Thinking Block: Rendered for MPC runs */}
                  {msg.kind !== 'followup_chat' && (
                    <MpcThinkingBlock
                      isRunning={Boolean(msg.pending)}
                      elapsedSec={elapsedSec}
                      iteration={job?.iteration ?? 0}
                      maxIterations={job?.max_iterations || currentParams.maxIterations}
                      currentStage={job?.stage || 'actor'}
                      logs={reasoningLogs}
                      defaultExpanded={Boolean(msg.pending)}
                      durationSec={msg.durationSec}
                    />
                  )}

                  {/* Main Response Content Bubble */}
                  <div className="rounded-2xl rounded-tl-xs border border-border bg-surface-elevated/85 p-3.5 shadow-sm space-y-3">
                    <div className="text-xs leading-relaxed text-foreground">
                      <MarkdownContent content={msg.content} />
                    </div>

                    {/* Deliverable Artifact Quick Card (when run is complete) */}
                    {msg.results && (
                      <div className="rounded-xl border border-border/80 bg-surface p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                            <CheckCircle2 className="size-4 text-emerald-500" />
                            <span>Optimal MPC Controller Certified</span>
                          </div>
                          {typeof msg.results.best_mse === 'number' && (
                            <span className="font-mono text-xs font-bold text-emerald-400">
                              MSE: {msg.results.best_mse.toFixed(5)}
                            </span>
                          )}
                        </div>

                        {/* Parameter Quick Strip */}
                        <div className="grid grid-cols-3 gap-2 font-mono text-center text-[10.5px]">
                          <div className="rounded-lg border border-border bg-surface-muted p-1.5">
                            <span className="text-muted block text-[9px]">Horizon</span>
                            <span className="font-bold text-purple-300">
                              Np={String(msg.results.best_params?.Np ?? currentParams.np)} Nc={String(msg.results.best_params?.Nc ?? currentParams.nc)}
                            </span>
                          </div>
                          <div className="rounded-lg border border-border bg-surface-muted p-1.5">
                            <span className="text-muted block text-[9px]">Sample dt</span>
                            <span className="font-bold text-cyan-300">
                              {Number(msg.results.best_params?.dt || currentParams.dtMpc).toFixed(3)}s
                            </span>
                          </div>
                          <div className="rounded-lg border border-border bg-surface-muted p-1.5">
                            <span className="text-muted block text-[9px]">Iterations</span>
                            <span className="font-bold text-foreground">
                              {msg.results.iteration || 1} rounds
                            </span>
                          </div>
                        </div>

                        {/* Artifact View Buttons */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => onSelectTab('waveform')}
                            className={`${btnBase} ${btnCompact} ${btnPrimary} flex items-center gap-1 text-[11px]`}
                          >
                            <Activity className="size-3.5" /> View Oscilloscope
                          </button>

                          <button
                            type="button"
                            onClick={() => onSelectTab('code')}
                            className={`${btnBase} ${btnCompact} flex items-center gap-1 text-[11px] border border-border hover:bg-surface-hover`}
                          >
                            <FileCode className="size-3.5 text-purple-400" /> Python Deliverable (.py)
                          </button>

                          <button
                            type="button"
                            onClick={onDownloadReport}
                            disabled={downloadingPdf}
                            className={`${btnBase} ${btnCompact} flex items-center gap-1 text-[11px] border border-border hover:bg-surface-hover disabled:opacity-50`}
                          >
                            {downloadingPdf ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                            PDF Report
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Composer Bottom Area */}
      <div className="border-t border-border bg-surface-elevated/90 p-3 backdrop-blur-md space-y-2">
        {/* Suggestion Pills above textarea (scrollable) */}
        {messages.length > 0 && !isRunning && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
            <span className="text-[10px] uppercase font-semibold text-muted tracking-wider shrink-0 mr-1">
              Suggestions:
            </span>
            <button
              type="button"
              onClick={() => {
                setInputText('Why did the Juror accept this parameter set over iteration 1?')
                textareaRef.current?.focus()
              }}
              className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-[11px] text-muted-text hover:text-foreground hover:border-purple-500/40 shrink-0 whitespace-nowrap transition-colors"
            >
              Why did the Juror accept this set?
            </button>
            <button
              type="button"
              onClick={() => {
                setInputText('Tighten Q weights on state x1 to reduce position tracking error.')
                textareaRef.current?.focus()
              }}
              className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-[11px] text-muted-text hover:text-foreground hover:border-purple-500/40 shrink-0 whitespace-nowrap transition-colors"
            >
              Tighten Q weights on state x1
            </button>
            <button
              type="button"
              onClick={() => {
                setInputText('Test closed loop under 20% plant disturbance drift.')
                textareaRef.current?.focus()
              }}
              className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-[11px] text-muted-text hover:text-foreground hover:border-purple-500/40 shrink-0 whitespace-nowrap transition-colors"
            >
              Test under 20% disturbance drift
            </button>
          </div>
        )}

        {/* Input Text Box */}
        <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-purple-500/60 focus-within:ring-1 focus-within:ring-purple-500/30 transition-all shadow-inner">
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-text hover:bg-surface-hover hover:text-foreground transition-colors"
            title="Adjust tuning horizons and matrices"
          >
            <Sliders className="size-4" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRunning
                ? 'Optimization running; please stand by...'
                : 'Message MPC Copilot (e.g. Optimize for ball-and-beam with Np=16)...'
            }
            disabled={isRunning}
            className="flex-1 max-h-32 min-h-[36px] resize-none bg-transparent py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none"
          />

          {isRunning ? (
            <button
              type="button"
              onClick={onCancelJob}
              className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-xs hover:bg-rose-600 transition-colors"
              title="Stop optimization"
            >
              <StopCircle className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-xs hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
              title="Send message"
            >
              <ArrowUp className="size-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* Floating Parameters Drawer */}
      <MpcParameterDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        params={currentParams}
        onChangeParams={onChangeParams}
        onResetDefaults={onResetParamsDefaults}
      />
    </div>
  )
}
