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
import { adaptiveApi, plantArtifactApi } from '../api/endpoints'
import type {
  AdaptiveJobOptions,
  AdaptiveJobResultsResponse,
  AdaptiveJobStatusResponse,
  DiagnosisApplyPatch,
} from '../api/types'
import { AdaptiveClarifierChat } from '../components/adaptive/AdaptiveClarifierChat'
import { AdaptiveDashboard } from '../components/adaptive/AdaptiveDashboard'
import { AdaptiveTuningPriorities } from '../components/adaptive/AdaptiveTuningPriorities'
import { DesignCompletedToast } from '../components/DesignCompletedToast'
import { GradeDesignModal } from '../components/GradeDesignModal'
import { usePipeline } from '../context/PipelineContext'
import { btnBase, btnCompact, btnPrimary, fieldInput, fieldLabel } from '../lib/classes'

export function AdaptivePage() {
  const [searchParams] = useSearchParams()
  const pipeline = usePipeline()

  const [jobId, setJobId] = useState<string | null>(searchParams.get('job_id') || searchParams.get('job'))
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
  const [tuningPriorities, setTuningPriorities] = useState<Record<string, number>>({})

  // Simulation & Plant Knobs (Inherited from Plant Model Chat / Pre-Launch Artifact)
  const [simTime, setSimTime] = useState<number>(10.0)
  const [solverStep, setSolverStep] = useState<number>(0.01)
  const [x0Str, setX0Str] = useState<string>('0.0, 0.0')
  const [referenceFn, setReferenceFn] = useState<string>('sin(t)')

  const [gradeModalOpen, setGradeModalOpen] = useState(false)
  const [showCompletedToast, setShowCompletedToast] = useState(false)
  const hasPromptedGradeRef = useRef(false)
  const [diagnosisApplyUsed, setDiagnosisApplyUsed] = useState(false)

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Prepopulate from compiled artifact if available
  useEffect(() => {
    const artifactId = sessionStorage.getItem('labcd_last_artifact_id')
    if (!artifactId) return
    let active = true
    plantArtifactApi
      .getArtifact(artifactId)
      .then((art) => {
        if (!active || !art?.pre_launch) return
        if (typeof art.pre_launch.total_simulation_time === 'number') {
          setSimTime(art.pre_launch.total_simulation_time)
        }
        if (typeof art.pre_launch.solver_sample_time === 'number') {
          setSolverStep(art.pre_launch.solver_sample_time)
        }
        if (Array.isArray(art.pre_launch.initial_state) && art.pre_launch.initial_state.length > 0) {
          setX0Str(art.pre_launch.initial_state.join(', '))
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

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
          void fetchFinalResults()
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
          if (data.status === 'completed' || data.status === 'failed') {
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

  useEffect(() => {
    if (results && results.status === 'completed' && !results.design_grade && !hasPromptedGradeRef.current) {
      hasPromptedGradeRef.current = true
      setShowCompletedToast(true)
    }
  }, [results])

  const applyDiagnosisSuggestion = (patch: DiagnosisApplyPatch) => {
    // Write suggestion into form knobs only (does not start a job). Max 1 Apply enforced in dashboard.
    const field = (patch.lever || patch.field || '').toLowerCase()
    const value = patch.value
    if (value == null) return
    if (field.includes('reference') || field === 'reference') {
      setReferenceFn(String(value))
    } else if (field.includes('initial') || field === 'x0' || field.includes('x0')) {
      if (Array.isArray(value)) {
        setX0Str(value.map(String).join(', '))
      } else {
        // options sometimes encode vectors as "0,0,0,0" or "0.1,0,0,0"
        setX0Str(String(value))
      }
    } else if (field.includes('step') || field.includes('solver') || field === 'step_time') {
      const n = typeof value === 'number' ? value : parseFloat(String(value))
      if (!Number.isNaN(n) && n > 0) setSolverStep(n)
    } else if (field.includes('sim') && field.includes('time')) {
      const n = typeof value === 'number' ? value : parseFloat(String(value))
      if (!Number.isNaN(n) && n > 0) setSimTime(n)
    }
    setDiagnosisApplyUsed(true)
  }

  const handleRetryFromDiagnosis = () => {
    // Do not start a new design in this session — return to the launch form.
    // Form knobs (including any Applied suggestion) are preserved.
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    setJobId(null)
    setJob(null)
    setResults(null)
    setError(null)
    setShowCompletedToast(false)
    // Keep diagnosisApplyUsed so Apply stays consumed until the next successful Launch
    requestAnimationFrame(() => {
      const el = document.getElementById('adaptive-launch-section')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }

  const handleStartJob = async () => {
    setError(null)
    setLoading(true)
    setDiagnosisApplyUsed(false)

    const artifactId = sessionStorage.getItem('labcd_last_artifact_id')
    const x0 = x0Str.split(',').map((v) => parseFloat(v.trim()) || 0.0)

    try {
      let spec: Record<string, unknown> | null = null
      let outputNames: string[] = []

      if (artifactId) {
        // Fetch full adaptive-spec so real states/outputs reach the pipeline.
        let artSpec: Record<string, unknown> | null = null
        try {
          artSpec = await plantArtifactApi.getAdaptiveSpec(artifactId)
        } catch {
          artSpec = null
        }
        if (!artSpec || typeof artSpec !== 'object') {
          setError(
            'Could not load plant adaptive-spec for the selected artifact. ' +
              'Re-compile the plant from Plant Model Chat and try again.',
          )
          setLoading(false)
          return
        }
        const dyn = (artSpec.dynamics as Record<string, unknown> | undefined) || {}
        const states = Array.isArray(dyn.states) ? (dyn.states as string[]) : []
        const outputs = Array.isArray(dyn.outputs) ? (dyn.outputs as string[]) : []
        outputNames = outputs.length > 0 ? outputs : states
        if (outputNames.length === 0) {
          setError(
            'Plant adaptive-spec has no states/outputs. Re-compile the plant and try again.',
          )
          setLoading(false)
          return
        }
        const references = outputNames.map((out) => ({
          output: out,
          expr: referenceFn || '0',
        }))
        spec = {
          ...artSpec,
          artifact_id: artifactId,
          system_name:
            (artSpec.system_name as string) ||
            pipeline.fileName?.replace(/\.py$/, '') ||
            'adaptive_plant',
          dynamics: {
            ...dyn,
            sim_time: simTime,
            solver_step: solverStep,
            x0,
            references,
            ...(pipeline.fileContent ? { source: pipeline.fileContent } : {}),
          },
        }
      } else if (pipeline.fileContent) {
        // No artifact: refuse to invent generic states for arbitrary source.
        setError(
          'No compiled plant artifact found. Open Plant Model Chat, compile the plant, ' +
            'then launch Adaptive so the real states/outputs are used.',
        )
        setLoading(false)
        return
      } else {
        setError(
          'No plant selected. Provide a compiled plant artifact before starting Adaptive design.',
        )
        setLoading(false)
        return
      }

      const options: AdaptiveJobOptions = {
        enable_tuning: enableTuning,
        target_rms_frac: targetRms,
        max_tuning_rounds: maxRounds,
        skip_clarify: skipClarify,
        model: pipeline.model,
        description: `Adaptive design for ${pipeline.fileName || (spec.system_name as string) || 'system'}`,
        sim_time: simTime,
        solver_step: solverStep,
        x0,
        references:
          outputNames.length > 0
            ? Object.fromEntries(outputNames.map((o) => [o, referenceFn || '0']))
            : { [outputNames[0] || 'y']: referenceFn || '0' },
        tuning_objectives:
          enableTuning && Object.keys(tuningPriorities).length > 0 ? tuningPriorities : undefined,
      }

      const res = await adaptiveApi.createJob({
        system_spec: spec,
        options,
        project_id: pipeline.projectId ? String(pipeline.projectId) : undefined,
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

  return (
    <div className="relative flex min-h-screen flex-col bg-transparent text-foreground">
      {/* Atmosphere Glows */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 left-1/4 h-[420px] w-[600px] rounded-full bg-gradient-to-br from-cyan-600/12 via-teal-600/6 to-transparent blur-3xl animate-[aurora-drift_16s_ease-in-out_infinite]" />
        <div className="absolute bottom-20 right-10 h-[380px] w-[500px] rounded-full bg-gradient-to-tr from-indigo-600/8 via-cyan-800/6 to-transparent blur-3xl animate-[pulse-soft_11s_ease-in-out_infinite]" />
      </div>

      {/* Top Bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface-elevated/85 px-6 backdrop-blur-md shadow-xs">
        <div className="flex items-center gap-3 text-xs">
          <Link
            to="/case-studies"
            className="flex items-center gap-1.5 text-muted-text hover:text-foreground transition-colors font-medium"
          >
            <ArrowLeft className="size-3.5" /> Case Studies &amp; Projects
          </Link>
          <span className="text-muted/40">/</span>
          <span className="font-semibold text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5">
            <Zap className="size-3.5 text-cyan-500" />
            Adaptive Nonlinear Control
          </span>
          {pipeline.fileName && (
            <span className="rounded-md border border-border bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-muted-text">
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
              className={`${btnBase} ${btnCompact} text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border-rose-500/30 font-medium`}
            >
              <StopCircle className="size-3.5" /> Stop
            </button>
          )}

          {job && (
            <button
              type="button"
              onClick={handleReset}
              className={`${btnBase} ${btnCompact} text-foreground hover:bg-surface-hover border border-border font-medium shadow-xs`}
            >
              <RotateCcw className="size-3.5 text-muted-text" /> New Run
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area: Standardized Full-Width Grid matching MPC */}
      <main className="mx-auto flex w-full max-w-[1880px] 2xl:max-w-[2100px] flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8 xl:p-10">
        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Error in Adaptive pipeline:</span>
              {error}
            </div>
          </div>
        )}

        {/* Setup Screen when no job running */}
        {!job && (
          <div
            id="adaptive-launch-section"
            className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated p-6 sm:p-7 shadow-sm"
          >
            {/* Top gradient highlight beam */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-500/70 to-transparent" />

            {/* Header with Title & Launch Button */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
              <div className="max-w-xl">
                <div className="flex items-center gap-2.5 text-cyan-600 dark:text-cyan-400">
                  <Sparkles className="size-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    AgentAdaptive Control Suite
                  </span>
                </div>
                <h1 className="mt-1 text-xl font-bold text-foreground">
                  Sliding Mode &amp; Backstepping Controller Design
                </h1>
                <p className="mt-1 text-xs text-muted-text leading-relaxed">
                  Synthesizes robust nonlinear control laws with radial basis function (RBF) neural
                  networks for unmodeled dynamics and disturbances. Guaranteed stability via constructive Lyapunov functions.
                </p>
              </div>

              <button
                type="button"
                onClick={handleStartJob}
                disabled={loading}
                className={`${btnBase} ${btnPrimary} flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 text-white font-semibold border-none shadow-[0_0_20px_rgba(6,182,212,0.35)]`}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Starting Agent Pipeline...
                  </>
                ) : (
                  <>
                    <Play className="size-4" /> Start Adaptive Tuning
                  </>
                )}
              </button>
            </div>

            <div className="mt-6 space-y-6">
              {/* 1. Desired Reference Trajectory */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400 block mb-2">
                  1. Desired Reference Trajectory
                </label>
                <div className="rounded-xl border border-border bg-surface-muted/30 p-4 space-y-3">
                  <div>
                    <label className={fieldLabel}>Reference Trajectory xd(t)</label>
                    <input
                      type="text"
                      value={referenceFn}
                      onChange={(e) => setReferenceFn(e.target.value)}
                      placeholder="sin(t)"
                      className={fieldInput}
                    />
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-muted-text font-mono">Quick Signals:</span>
                      {[
                        { label: 'sin(t)', val: 'sin(t)' },
                        { label: 'cos(0.5·t)', val: 'cos(0.5*t)' },
                        { label: '1.0 (Step)', val: '1.0' },
                        { label: 'tanh(t)', val: 'tanh(t)' },
                      ].map((s) => (
                        <button
                          key={s.val}
                          type="button"
                          onClick={() => setReferenceFn(s.val)}
                          className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[10px] text-muted-text hover:text-cyan-500 hover:border-cyan-500/40 transition-colors"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pre-Launch Simulation Horizon Confirmation */}
                  <div className="pt-2 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-muted-text">
                    <span className="flex items-center gap-1.5 text-cyan-600 dark:text-cyan-400 font-semibold">
                      <CheckCircle2 className="size-3.5 text-cyan-500" />
                      Pre-Launch Simulation Setup:
                    </span>
                    <div className="flex items-center gap-3">
                      <span>Horizon: <b className="text-foreground">{simTime}s</b></span>
                      <span>dt: <b className="text-foreground">{solverStep}s</b></span>
                      <span>x₀: [<b className="text-foreground">{x0Str}</b>]</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Clarification & Parameter Tuning Strategy */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400 block mb-2">
                  2. Clarification &amp; Adaptive Tuning Strategy
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-border bg-surface-muted/30 p-4">
                  <div>
                    <label className={fieldLabel}>Enable Iterative Parameter Tuning</label>
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        type="button"
                        onClick={() => setEnableTuning(!enableTuning)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-500/40 ${
                          enableTuning
                            ? 'bg-cyan-500 border-cyan-500'
                            : 'border-border-input bg-surface hover:border-cyan-500/40 dark:bg-white/10 dark:border-white/20'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-sm ring-1 ring-black/5 transition duration-200 ease-in-out ${
                            enableTuning ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span className="text-xs font-semibold text-foreground dark:text-slate-100">
                        {enableTuning ? 'Active (Lyapunov Tuner Agent)' : 'Single Synthesis Run'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className={fieldLabel}>Skip Clarification Dialogue</label>
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        type="button"
                        onClick={() => setSkipClarify(!skipClarify)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-500/40 ${
                          skipClarify
                            ? 'bg-cyan-500 border-cyan-500'
                            : 'border-border-input bg-surface hover:border-cyan-500/40 dark:bg-white/10 dark:border-white/20'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-sm ring-1 ring-black/5 transition duration-200 ease-in-out ${
                            skipClarify ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span className="text-xs font-semibold text-foreground dark:text-slate-100">
                        {skipClarify ? 'Direct Run (Conservative Defaults)' : 'Interactive Dialogue'}
                      </span>
                    </div>
                  </div>

                  {enableTuning && (
                    <>
                      <div className="pt-2 border-t border-border">
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
                      <div className="pt-2 border-t border-border">
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
              </div>

              {/* 3. State-of-the-Art Adaptive Tuning Priorities */}
              {enableTuning && (
                <div className="animate-in fade-in-50 duration-200">
                  <label className="text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400 block mb-2">
                    3. Objective Prioritization (1 to 5)
                  </label>
                  <AdaptiveTuningPriorities
                    weights={tuningPriorities}
                    onChange={setTuningPriorities}
                    disabled={loading}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Clarifier Mode when questions pending */}
        {job && job.status === 'clarifying' && job.clarify_pending && (
          <AdaptiveClarifierChat
            job={job}
            onSubmitAnswer={handleClarifySubmit}
            submitting={submitting}
          />
        )}

        {/* Active Job View: Adaptive Dashboard (Standardized with MPC) */}
        {job && (!job.clarify_pending || job.status !== 'clarifying') && (
          <AdaptiveDashboard
            job={job}
            results={results}
            onRetryFromDiagnosis={handleRetryFromDiagnosis}
            onApplyDiagnosisSuggestion={applyDiagnosisSuggestion}
            diagnosisApplyUsed={diagnosisApplyUsed}
            currentDiagnosisInputs={{
              reference: referenceFn,
              x0: x0Str,
              solverStep,
              simTime,
            }}
            onDownloadReport={async () => {
              if (jobId) {
                try {
                  await adaptiveApi.downloadReportPdf(jobId)
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : 'Failed to download PDF report',
                  )
                }
              }
            }}
          />
        )}
      </main>

      {showCompletedToast && results && !results.design_grade && (
        <DesignCompletedToast
          moduleLabel="Adaptive Law"
          score={results.score}
          success={results.success}
          onGradeClick={() => setGradeModalOpen(true)}
          onDismiss={() => setShowCompletedToast(false)}
        />
      )}

      {jobId && results && (
        <GradeDesignModal
          open={gradeModalOpen}
          moduleType="adaptive"
          jobId={jobId}
          score={results.score}
          success={results.success}
          initialRating={results.design_grade?.rating}
          initialComment={results.design_grade?.comment}
          onClose={() => setGradeModalOpen(false)}
          onSubmitted={(rating, comment) => {
            setResults((prev) =>
              prev
                ? {
                    ...prev,
                    design_grade: { rating, comment, created_at: new Date().toISOString() },
                  }
                : prev,
            )
          }}
        />
      )}
    </div>
  )
}
