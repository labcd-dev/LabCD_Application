import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  StopCircle,
  Zap,
} from 'lucide-react'
import { adaptiveApi } from '../api/endpoints'
import type {
  AdaptiveJobOptions,
  AdaptiveJobResultsResponse,
  AdaptiveJobStatusResponse,
} from '../api/types'
import { AdaptiveClarifierChat } from '../components/adaptive/AdaptiveClarifierChat'
import { AdaptiveDashboard } from '../components/adaptive/AdaptiveDashboard'
import { usePipeline } from '../context/PipelineContext'
import { btnBase, btnCompact, btnPrimary, fieldInput, fieldLabel } from '../lib/classes'

export function AdaptivePage() {
  const [searchParams] = useSearchParams()
  const pipeline = usePipeline()

  const [jobId, setJobId] = useState<string | null>(searchParams.get('job_id'))
  const [job, setJob] = useState<AdaptiveJobStatusResponse | null>(null)
  const [results, setResults] = useState<AdaptiveJobResultsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Options state for new run
  const [enableTuning, setEnableTuning] = useState(false)
  const [targetRms, setTargetRms] = useState(0.02)
  const [maxRounds, setMaxRounds] = useState(4)
  const [skipClarify, setSkipClarify] = useState(false)

  // Simulation & Plant Knobs (React Parity with Notebook)
  const [simTime, setSimTime] = useState(10.0)
  const [solverStep, setSolverStep] = useState(0.01)
  const [x0Str, setX0Str] = useState('0.0')
  const [referenceFn, setReferenceFn] = useState('sin(t)')
  const [plantMode, setPlantMode] = useState<'preset' | 'artifact' | 'custom'>(() => {
    return sessionStorage.getItem('labcd_last_artifact_id') ? 'artifact' : 'preset'
  })

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Start polling when jobId is set and job is not terminal
  useEffect(() => {
    if (!jobId) return

    let isSubscribed = true

    const fetchFinalResults = async () => {
      try {
        const res = await adaptiveApi.getResults(jobId)
        if (isSubscribed) setResults(res)
      } catch (err) {
        console.error('Failed to get final adaptive results:', err)
      }
    }

    const poll = async () => {
      try {
        const currentJob = await adaptiveApi.getJob(jobId)
        if (!isSubscribed) return
        setJob(currentJob)

        if (currentJob.status === 'completed') {
          void fetchFinalResults()
          if (pollTimerRef.current) clearInterval(pollTimerRef.current)
        } else if (currentJob.status === 'failed' || currentJob.status === 'cancelled') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current)
        }
      } catch (err) {
        console.error('Failed to poll adaptive job:', err)
      }
    }

    const unsubscribeStream = adaptiveApi.streamEvents(
      jobId,
      (event, data) => {
        if (!isSubscribed) return
        if (event === 'progress') {
          setJob((prev) => (prev ? { ...prev, progress: [...prev.progress, data] } : prev))
        } else if (event === 'status') {
          setJob((prev) => (prev ? { ...prev, ...data } : prev))
          if (data.status === 'completed') {
            void fetchFinalResults()
          }
        } else if (event === 'done') {
          void fetchFinalResults()
        }
      },
      () => {
        if (!pollTimerRef.current) {
          poll()
          pollTimerRef.current = setInterval(poll, 1500)
        }
      }
    )

    poll()
    pollTimerRef.current = setInterval(poll, 1500)

    return () => {
      isSubscribed = false
      unsubscribeStream()
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [jobId])

  const handleStartJob = async () => {
    setError(null)
    setLoading(true)

    // Retrieve last artifact or build default spec
    const artifactId = sessionStorage.getItem('labcd_last_artifact_id')
    const x0 = x0Str.split(',').map((v) => parseFloat(v.trim()) || 0.0)
    const simKnobs = {
      sim_time: simTime,
      solver_step: solverStep,
      x0,
      references: { x: referenceFn },
    }

    let spec: Record<string, unknown> | null = null

    if (plantMode === 'preset') {
      spec = {
        system_name: 'smoke_integrator',
        dynamics: {
          system_name: 'smoke_integrator',
          states: ['x'],
          state_meanings: ['integrator state'],
          inputs: ['u'],
          outputs: ['x'],
          state_equations: ['u'],
          parameters: {},
          system_type: 'SISO',
          assumptions: ['unit integrator for benchmark demo'],
        },
        simulation: simKnobs,
      }
    } else if (plantMode === 'artifact' && artifactId) {
      spec = {
        artifact_id: artifactId,
        system_name: pipeline.fileName || 'adaptive_plant',
        simulation: simKnobs,
      }
    } else {
      spec = {
        system_name: pipeline.fileName?.replace('.py', '') || 'adaptive_system',
        dynamics: { states: ['x1', 'x2'], inputs: ['u'] },
        simulation: simKnobs,
      }
    }

    const options: AdaptiveJobOptions = {
      enable_tuning: enableTuning,
      target_rms_frac: targetRms,
      max_tuning_rounds: maxRounds,
      skip_clarify: skipClarify,
      model: pipeline.model,
      description: `Adaptive design for ${pipeline.fileName || 'system'}`,
      sim_time: simTime,
      solver_step: solverStep,
      x0,
      references: { x: referenceFn },
    }

    try {
      const res = await adaptiveApi.createJob({
        system_spec: spec,
        options,
      })
      setJobId(res.job_id)
      setJob({
        job_id: res.job_id,
        status: res.status,
        stage: res.stage,
        message: res.message,
        round: 0,
        clarify_pending: res.status === 'clarifying',
        progress: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      setResults(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to launch adaptive job'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleClarifySubmit = async (answer: string, forceFinish = false) => {
    if (!jobId) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await adaptiveApi.clarify(jobId, { answer, force_finish: forceFinish })
      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: res.status,
              stage: res.stage,
              last_clarifier_reply: res.reply,
              round: res.round,
              clarify_pending: res.status === 'clarifying',
            }
          : null
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit clarification'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = async () => {
    if (!jobId) return
    try {
      const updated = await adaptiveApi.cancel(jobId)
      setJob(updated)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel job')
    }
  }

  const handleReset = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    setJobId(null)
    setJob(null)
    setResults(null)
    setError(null)
  }

  // Stages for visual flow strip
  const flowStages = [
    { id: 'clarify', label: 'Clarifier' },
    { id: 'design', label: 'Designer' },
    { id: 'build', label: 'Simulate' },
    { id: 'tune', label: 'Tuner' },
    { id: 'done', label: 'Completed' },
  ]

  const currentStageIndex = () => {
    if (!job) return -1
    if (job.status === 'completed') return 4
    if (job.stage === 'tune') return 3
    if (job.stage === 'build') return 2
    if (job.stage === 'design') return 1
    if (job.stage === 'clarify' || job.status === 'clarifying') return 0
    return 0
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-transparent text-[#eef2f8]">
      {/* Studio Atmosphere Glows */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/4 h-[420px] w-[600px] rounded-full bg-gradient-to-br from-cyan-600/12 via-teal-600/6 to-transparent blur-3xl animate-[aurora-drift_16s_ease-in-out_infinite]" />
        <div className="absolute bottom-20 right-10 h-[380px] w-[500px] rounded-full bg-gradient-to-tr from-indigo-600/8 via-cyan-800/6 to-transparent blur-3xl animate-[pulse-soft_11s_ease-in-out_infinite]" />
      </div>

      {/* Top Bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/10 bg-[#0a0d12]/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3 text-xs">
          <Link
            to="/studio"
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Studio
          </Link>
          <span className="text-slate-600">/</span>
          <span className="font-semibold text-cyan-400 flex items-center gap-1.5">
            <Zap className="size-3.5 text-cyan-400" />
            Adaptive Nonlinear Studio
          </span>
          {pipeline.fileName && (
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-300">
              {pipeline.fileName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {job && (
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                job.status === 'completed'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : job.status === 'failed' || job.status === 'cancelled'
                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  job.status === 'completed'
                    ? 'bg-emerald-400'
                    : job.status === 'failed'
                    ? 'bg-rose-400'
                    : 'bg-cyan-400 animate-pulse'
                }`}
              />
              {job.status.toUpperCase()}
            </span>
          )}

          {job && job.status !== 'completed' && job.status !== 'failed' && (
            <button
              type="button"
              onClick={handleCancel}
              className={`${btnBase} ${btnCompact} text-rose-300 hover:bg-rose-500/10 border-rose-500/30`}
            >
              <StopCircle className="size-3.5" /> Stop
            </button>
          )}

          {job && (
            <button
              type="button"
              onClick={handleReset}
              className={`${btnBase} ${btnCompact} text-slate-300 hover:text-white`}
            >
              <RotateCcw className="size-3.5" /> New Run
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto flex w-full max-w-[1880px] 2xl:max-w-[2100px] flex-1 flex-col lg:flex-row gap-6 p-4 sm:p-6 lg:p-8 xl:p-10">
        {/* Left Column: Stage View */}
        <div className="flex-1 min-w-0 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Error in Adaptive pipeline:</span>
                {error}
              </div>
            </div>
          )}

          {/* If no active job: Setup & Launch Card */}
          {!job && (
            <div className="card-alive relative overflow-hidden rounded-2xl border border-white/10 bg-[#11161d]/90 backdrop-blur-md p-7 shadow-2xl">
              {/* Top gradient highlight beam */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent" />
              <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-cyan-500/10 blur-3xl" />
              <div className="max-w-xl">
                <div className="flex items-center gap-2.5 text-cyan-400">
                  <Sparkles className="size-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    AgentAdaptive Control Suite
                  </span>
                </div>
                <h1 className="mt-2 text-xl font-bold text-white">
                  Sliding Mode & Backstepping Controller Design
                </h1>
                <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                  Synthesizes robust nonlinear control laws with radial basis function (RBF) neural
                  networks for unmodeled friction, parametric drift, and external disturbances.
                  Guaranteed stability via constructive Lyapunov functions.
                </p>
              </div>

              <div className="mt-6 border-t border-white/10 pt-6 space-y-6">
              {/* Plant Model Selection */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-cyan-300 block mb-2">
                  1. Plant Model Dynamics
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPlantMode('preset')}
                    className={`rounded-xl border p-3.5 text-left transition-all ${
                      plantMode === 'preset'
                        ? 'border-cyan-400/80 bg-cyan-500/15 ring-1 ring-cyan-400/50 shadow-[0_0_20px_rgba(6,182,212,0.22)]'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/20 text-slate-400'
                    }`}
                  >
                    <div className="text-xs font-bold text-white mb-1">Preset Benchmark</div>
                    <div className="text-[11.5px] text-slate-400 leading-snug">
                      smoke_integrator (Unit integrator SISO dx/dt = u)
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPlantMode('artifact')}
                    className={`rounded-xl border p-3.5 text-left transition-all ${
                      plantMode === 'artifact'
                        ? 'border-cyan-400/80 bg-cyan-500/15 ring-1 ring-cyan-400/50 shadow-[0_0_20px_rgba(6,182,212,0.22)]'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/20 text-slate-400'
                    }`}
                  >
                    <div className="text-xs font-bold text-white mb-1">Synthesizer Artifact</div>
                    <div className="text-[11.5px] text-slate-400 leading-snug">
                      {sessionStorage.getItem('labcd_last_artifact_id')
                        ? `Loaded: ${sessionStorage.getItem('labcd_last_artifact_id')}`
                        : 'Auto-compiled from Plant Synthesizer'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPlantMode('custom')}
                    className={`rounded-xl border p-3.5 text-left transition-all ${
                      plantMode === 'custom'
                        ? 'border-cyan-400/80 bg-cyan-500/15 ring-1 ring-cyan-400/50 shadow-[0_0_20px_rgba(6,182,212,0.22)]'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/20 text-slate-400'
                    }`}
                  >
                    <div className="text-xs font-bold text-white mb-1">Custom Dynamics</div>
                    <div className="text-[11.5px] text-slate-400 leading-snug">
                      User-specified state-space vectors
                    </div>
                  </button>
                </div>
              </div>

              {/* Simulation & Reference Knobs */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-cyan-300 block mb-2">
                  2. Simulation &amp; Desired Trajectory Targets
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className={fieldLabel}>Sim Time (s)</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      value={simTime}
                      onChange={(e) => setSimTime(parseFloat(e.target.value) || 10)}
                      className={fieldInput}
                    />
                    <span className="text-[10.5px] text-slate-500 font-mono">Duration</span>
                  </div>

                  <div>
                    <label className={fieldLabel}>Solver Step (s)</label>
                    <input
                      type="number"
                      step="0.005"
                      min="0.001"
                      max="0.1"
                      value={solverStep}
                      onChange={(e) => setSolverStep(parseFloat(e.target.value) || 0.01)}
                      className={fieldInput}
                    />
                    <span className="text-[10.5px] text-slate-500 font-mono">Integration dt</span>
                  </div>

                  <div>
                    <label className={fieldLabel}>Initial State x₀</label>
                    <input
                      type="text"
                      value={x0Str}
                      onChange={(e) => setX0Str(e.target.value)}
                      placeholder="0.0"
                      className={fieldInput}
                    />
                    <span className="text-[10.5px] text-slate-500 font-mono">Comma-separated</span>
                  </div>

                  <div>
                    <label className={fieldLabel}>Reference xd(t)</label>
                    <input
                      type="text"
                      value={referenceFn}
                      onChange={(e) => setReferenceFn(e.target.value)}
                      placeholder="sin(t)"
                      className={fieldInput}
                    />
                    <span className="text-[10.5px] text-slate-500 font-mono">e.g. sin(t), 1.0</span>
                  </div>
                </div>
              </div>

              <label className="text-xs font-bold uppercase tracking-wider text-cyan-300 block">
                3. Clarification &amp; Adaptive Tuning Options
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-white/5 pt-4">
                <div>
                  <label className={fieldLabel}>Enable Iterative Parameter Tuning</label>
                  <div className="flex items-center gap-3 mt-1.5">
                    <button
                      type="button"
                      onClick={() => setEnableTuning(!enableTuning)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                        enableTuning ? 'bg-cyan-500' : 'bg-white/10'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          enableTuning ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-slate-300">
                      {enableTuning ? 'Active (Tuner Agent)' : 'Single Derivation'}
                    </span>
                  </div>
                </div>

                <div>
                  <label className={fieldLabel}>Skip Clarification Q&A</label>
                  <div className="flex items-center gap-3 mt-1.5">
                    <button
                      type="button"
                      onClick={() => setSkipClarify(!skipClarify)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                        skipClarify ? 'bg-cyan-500' : 'bg-white/10'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          skipClarify ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-slate-300">
                      {skipClarify ? 'Use Conservative Defaults' : 'Interactive Dialogue'}
                    </span>
                  </div>
                </div>

                {enableTuning && (
                  <>
                    <div>
                      <label className={fieldLabel}>Target Tracking RMS Fraction</label>
                      <input
                        type="number"
                        step="0.005"
                        min="0.001"
                        max="0.5"
                        value={targetRms}
                        onChange={(e) => setTargetRms(parseFloat(e.target.value) || 0.02)}
                        className={fieldInput}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Max Tuning Iterations</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={maxRounds}
                        onChange={(e) => setMaxRounds(parseInt(e.target.value) || 4)}
                        className={fieldInput}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={handleStartJob}
                  disabled={loading}
                  className={`${btnBase} ${btnPrimary} flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 text-black font-semibold border-none shadow-lg shadow-cyan-500/20`}
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Starting Agent Pipeline...
                    </>
                  ) : (
                    <>
                      <Play className="size-4" /> Start Adaptive Design Studio
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Clarifier Mode */}
          {job && job.status === 'clarifying' && (
            <AdaptiveClarifierChat
              job={job}
              onSubmitAnswer={handleClarifySubmit}
              submitting={submitting}
            />
          )}

          {/* Running / Progress Mode */}
          {job && (job.status === 'designing' || job.status === 'building' || job.status === 'tuning') && (
            <div className="rounded-2xl border border-white/10 bg-[#11161d] p-8 text-center shadow-xl">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Loader2 className="size-7 animate-spin" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">
                {job.stage === 'tune'
                  ? 'Tuning Controller Parameters...'
                  : job.stage === 'build'
                  ? 'Simulating Derived Control Law...'
                  : 'Synthesizing Control Law (Designer Agent)...'}
              </h3>
              <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
                {job.message || 'Integrating differential equations with Lyapunov stability verification.'}
              </p>
            </div>
          )}

          {/* Results Mode */}
          {job && job.status === 'completed' && results && (
            <AdaptiveDashboard results={results} />
          )}
        </div>

        {/* Right Column: Pipeline Status & Activity Strip */}
        <div className="w-full lg:w-84 xl:w-96 shrink-0 space-y-5">
          {/* Flow Strip */}
          <div className="rounded-2xl border border-white/10 bg-[#11161d] p-5 shadow-xl">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Pipeline Stages
            </span>
            <div className="mt-4 space-y-3">
              {flowStages.map((stage, idx) => {
                const active = currentStageIndex() === idx
                const completed = currentStageIndex() > idx
                return (
                  <div
                    key={stage.id}
                    className={`flex items-center justify-between rounded-xl border p-3 text-xs transition-all ${
                      active
                        ? 'border-cyan-400/50 bg-cyan-500/10 text-white font-semibold'
                        : completed
                        ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                        : 'border-white/5 bg-white/5 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex size-6 items-center justify-center rounded-lg text-xs ${
                          completed
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : active
                            ? 'bg-cyan-500/20 text-cyan-400'
                            : 'bg-white/5 text-slate-500'
                        }`}
                      >
                        {completed ? <CheckCircle2 className="size-3.5" /> : idx + 1}
                      </span>
                      <span>{stage.label}</span>
                    </div>
                    {active && <span className="size-2 rounded-full bg-cyan-400 animate-ping" />}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live Activity Feed */}
          {job && job.progress && job.progress.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#11161d] p-5 shadow-xl">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Agent Events
              </span>
              <div className="mt-3 max-h-64 overflow-y-auto space-y-2 pr-1 text-xs">
                {job.progress.map((ev, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-white/5 bg-[#0a0d12] p-2.5 text-[11.5px] leading-relaxed text-slate-300"
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono mb-1">
                      <span className="text-cyan-400 font-semibold uppercase">{ev.stage || 'info'}</span>
                      <span>{ev.ts ? new Date(ev.ts * 1000).toLocaleTimeString() : ''}</span>
                    </div>
                    <div>{ev.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
