import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Compass,
  Play,
  RotateCcw,
  StopCircle,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Gauge,
} from 'lucide-react'
import { mpcApi } from '../api/endpoints'
import type {
  MPCDiagnosticsResponse,
  MPCJobOptions,
  MPCJobResultsResponse,
  MPCJobStatusResponse,
} from '../api/types'
import { MpcDashboard } from '../components/mpc/MpcDashboard'
import { usePipeline } from '../context/PipelineContext'
import { btnBase, btnCompact, btnPrimary } from '../lib/classes'

export function MpcPage() {
  const [searchParams] = useSearchParams()
  const pipeline = usePipeline()

  const [jobId, setJobId] = useState<string | null>(searchParams.get('job_id'))
  const [job, setJob] = useState<MPCJobStatusResponse | null>(null)
  const [results, setResults] = useState<MPCJobResultsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Setup tabs
  const [setupTab, setSetupTab] = useState<'system' | 'scenario' | 'tuning'>('system')

  // Diagnostics pre-flight state
  const [testingDynamics, setTestingDynamics] = useState(false)
  const [diagnostics, setDiagnostics] = useState<MPCDiagnosticsResponse | null>(null)

  // 1. System Tab Options
  const [dynamicsMode, setDynamicsMode] = useState<'preset' | 'artifact' | 'custom'>(() => {
    return sessionStorage.getItem('labcd_last_artifact_id') ? 'artifact' : 'preset'
  })
  const [selectedPluginId, setSelectedPluginId] = useState('example_pendulum')
  const [customPluginSource, setCustomPluginSource] = useState(`"""Custom MPC Dynamics Plugin"""
def create_config() -> "SystemConfig":
    return SystemConfig(
        n_states=2,
        n_inputs=1,
        params={"m": 1.0, "k": 2.0},
        state_names=["position", "velocity"],
        input_names=["force"],
        default_initial_state=np.array([1.0, 0.0]),
        default_target=np.array([0.0, 0.0]),
        state_bounds=(np.array([-5.0, -10.0]), np.array([5.0, 10.0])),
        input_bounds=(np.array([-10.0]), np.array([10.0])),
    )

class CustomOscillator(BaseDynamics):
    def dynamics(self, x: "np.ndarray", u: "np.ndarray") -> "np.ndarray":
        pos, vel = x[0], x[1]
        accel = (u[0] - self.params["k"] * pos) / self.params["m"]
        return np.array([vel, accel])

    def get_equilibrium_input(self) -> "np.ndarray":
        return np.zeros(self.n_inputs)
`)

  // 2. Scenario Tab Options
  const [trajectoryMode, setTrajectoryMode] = useState<'reg' | 'sin' | 'pulse'>('reg')
  const [trajectoryAmplitude, setTrajectoryAmplitude] = useState(0.5)
  const [trajectoryFrequency, setTrajectoryFrequency] = useState(0.5)
  const [trajectoryPulseStart, setTrajectoryPulseStart] = useState(0.2)
  const [trajectoryPulseEnd, setTrajectoryPulseEnd] = useState(0.7)
  const [noiseStd, setNoiseStd] = useState(0.0)
  const [scenarioLevel, setScenarioLevel] = useState<1 | 2 | 3>(1)

  // 3. Tuning & Constraints Tab Options
  const [np, setNp] = useState(12)
  const [nc, setNc] = useState(4)
  const [dtMpc, setDtMpc] = useState(0.02)
  const [simTime, setSimTime] = useState(3.0)
  const [maxIterations, setMaxIterations] = useState(15)
  const [explorationIntensity, setExplorationIntensity] = useState(50)
  const [userGuidance, setUserGuidance] = useState('')
  const [qWeightsInput, setQWeightsInput] = useState<string>('10.0, 1.0, 10.0, 1.0')
  const [rWeightsInput, setRWeightsInput] = useState<string>('0.1')

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live SVG Preview of trajectory reference wave
  const trajectorySvgPath = useMemo(() => {
    const W = 360
    const H = 90
    const pointsCount = 80
    const coords: Array<{ x: number; y: number }> = []

    for (let i = 0; i < pointsCount; i++) {
      const frac = i / (pointsCount - 1)
      const x = frac * W
      let yNorm = 0.5

      if (trajectoryMode === 'reg') {
        yNorm = 0.5
      } else if (trajectoryMode === 'sin') {
        yNorm = 0.5 - 0.35 * Math.sin(frac * Math.PI * 4 * trajectoryFrequency) * trajectoryAmplitude
      } else if (trajectoryMode === 'pulse') {
        if (frac >= trajectoryPulseStart && frac <= trajectoryPulseEnd) {
          yNorm = 0.5 - 0.35 * trajectoryAmplitude
        } else {
          yNorm = 0.5
        }
      }

      const y = yNorm * H
      coords.push({ x, y })
    }

    return coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ')
  }, [trajectoryMode, trajectoryAmplitude, trajectoryFrequency, trajectoryPulseStart, trajectoryPulseEnd])

  useEffect(() => {
    if (!jobId) return

    let isSubscribed = true

    const fetchFinalResults = async () => {
      try {
        const res = await mpcApi.getResults(jobId)
        if (isSubscribed) setResults(res)
      } catch (err) {
        console.error('Failed to get final mpc results:', err)
      }
    }

    const poll = async () => {
      try {
        const currentJob = await mpcApi.getJob(jobId)
        if (!isSubscribed) return
        setJob(currentJob)

        if (currentJob.status === 'completed') {
          void fetchFinalResults()
          if (pollTimerRef.current) clearInterval(pollTimerRef.current)
        } else if (currentJob.status === 'failed' || currentJob.status === 'cancelled') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current)
        }
      } catch (err) {
        console.error('Failed to poll mpc job:', err)
      }
    }

    const unsubscribeStream = mpcApi.streamEvents(
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

  // Pre-flight "Test Dynamics" execution
  const handleTestDynamics = async () => {
    setTestingDynamics(true)
    setError(null)
    const artifactId = sessionStorage.getItem('labcd_last_artifact_id')
    let dynamicsPayload: { plugin_id?: string; source?: string } = {}

    if (dynamicsMode === 'preset') {
      dynamicsPayload = { plugin_id: selectedPluginId }
    } else if (dynamicsMode === 'artifact') {
      if (artifactId) {
        dynamicsPayload = { plugin_id: artifactId }
      } else if (pipeline.fileContent) {
        dynamicsPayload = { source: pipeline.fileContent }
      } else {
        dynamicsPayload = { plugin_id: 'example_pendulum' }
      }
    } else {
      dynamicsPayload = { source: customPluginSource }
    }

    try {
      const res = await mpcApi.testDynamics({
        dynamics: dynamicsPayload,
        dt: dtMpc,
        sim_time: 2.0,
      })
      if (res.error) {
        setError(res.error)
      } else {
        setDiagnostics(res)
        // Auto-seed Q & R and suggested dt
        if (res.suggested_dt) {
          setDtMpc(res.suggested_dt)
        }
        if (res.bryson_q && res.bryson_q.length) {
          setQWeightsInput(res.bryson_q.map((v) => v.toFixed(3)).join(', '))
        }
        if (res.bryson_r && res.bryson_r.length) {
          setRWeightsInput(res.bryson_r.map((v) => v.toFixed(3)).join(', '))
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Diagnostics probe failed')
    } finally {
      setTestingDynamics(false)
    }
  }

  const handleStartJob = async () => {
    setError(null)
    setLoading(true)

    const artifactId = sessionStorage.getItem('labcd_last_artifact_id')
    let dynamicsPayload: { plugin_id?: string; source?: string } = {}

    if (dynamicsMode === 'preset') {
      dynamicsPayload = { plugin_id: selectedPluginId }
    } else if (dynamicsMode === 'artifact') {
      if (artifactId) {
        dynamicsPayload = { plugin_id: artifactId }
      } else if (pipeline.fileContent) {
        dynamicsPayload = { source: pipeline.fileContent }
      } else {
        dynamicsPayload = { plugin_id: 'example_pendulum' }
      }
    } else {
      dynamicsPayload = { source: customPluginSource }
    }

    const parsedQ = qWeightsInput
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n))
    const parsedR = rWeightsInput
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n))

    const options: MPCJobOptions = {
      max_iterations: maxIterations,
      prediction_horizon: np,
      control_horizon: nc,
      dt_mpc: dtMpc,
      simulation_time: simTime,
      ui_scenario_level: scenarioLevel,
      user_guidance: userGuidance,
      exploration_intensity: explorationIntensity,
      trajectory_mode: trajectoryMode,
      trajectory_amplitude: trajectoryAmplitude,
      trajectory_frequency: trajectoryFrequency,
      trajectory_pulse_start: trajectoryPulseStart,
      trajectory_pulse_end: trajectoryPulseEnd,
      noise_std: noiseStd,
      q_weights: parsedQ.length ? parsedQ : [10.0, 1.0],
      r_weights: parsedR.length ? parsedR : [0.1],
      model: pipeline.model,
      system_name:
        dynamicsMode === 'preset'
          ? 'Inverted Pendulum Cart-Pole'
          : pipeline.fileName?.replace('.py', '') || 'mpc_system',
    }

    try {
      const res = await mpcApi.createJob({
        dynamics: dynamicsPayload,
        options,
      })
      setJobId(res.job_id)
      setJob({
        job_id: res.job_id,
        status: res.status,
        stage: res.stage,
        message: res.message,
        iteration: 0,
        max_iterations: maxIterations,
        progress: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      setResults(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to launch MPC job'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!jobId) return
    try {
      const updated = await mpcApi.cancel(jobId)
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
    <div className="relative flex min-h-screen flex-col bg-transparent text-[#eef2f8]">
      {/* Studio Atmosphere Glows */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 right-1/4 h-[420px] w-[600px] rounded-full bg-gradient-to-br from-purple-600/12 via-indigo-600/6 to-transparent blur-3xl animate-[aurora-drift_16s_ease-in-out_infinite]" />
        <div className="absolute bottom-20 left-10 h-[380px] w-[500px] rounded-full bg-gradient-to-tr from-cyan-600/8 via-purple-800/6 to-transparent blur-3xl animate-[pulse-soft_11s_ease-in-out_infinite]" />
      </div>

      {/* Top Bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/10 bg-[#0a0d12]/85 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3 text-xs">
          <Link
            to="/studio"
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Studio
          </Link>
          <span className="text-slate-600">/</span>
          <span className="font-semibold text-purple-400 flex items-center gap-1.5">
            <Compass className="size-3.5 text-purple-400" />
            Agentic MPC Studio
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
                  : 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  job.status === 'completed'
                    ? 'bg-emerald-400'
                    : job.status === 'failed'
                    ? 'bg-rose-400'
                    : 'bg-purple-400 animate-pulse'
                }`}
              />
              {job.status.toUpperCase()} (Iter {job.iteration}/{job.max_iterations || maxIterations})
            </span>
          )}

          {job && job.status === 'running' && (
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
              <RotateCcw className="size-3.5" /> Reconfigure
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto flex w-full max-w-[1880px] 2xl:max-w-[2100px] flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8 xl:p-10">
        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Error in MPC pipeline:</span>
              {error}
            </div>
          </div>
        )}

        {/* Setup Screen when no job running */}
        {!job && (
          <div className="card-alive relative overflow-hidden rounded-2xl border border-white/10 bg-[#11161d]/90 p-7 shadow-2xl backdrop-blur-md">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-purple-500/80 to-transparent" />
            
            {/* Title Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
              <div>
                <div className="flex items-center gap-2.5 text-purple-400">
                  <Compass className="size-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Full-Scope Autonomous MPC Tuning Studio
                  </span>
                </div>
                <h1 className="mt-1 text-xl font-bold text-white">
                  Model Predictive Control Optimization Suite
                </h1>
                <p className="mt-1 text-xs text-slate-300">
                  Configure plant dynamics, trajectory tracking scenarios, and initial constraints before launching the multi-agent optimization loop.
                </p>
              </div>

              {/* Launch Button */}
              <button
                type="button"
                onClick={handleStartJob}
                disabled={loading}
                className={`${btnPrimary} flex items-center gap-2 text-xs shadow-[0_0_20px_rgba(168,85,247,0.35)]`}
              >
                {loading ? (
                  <>
                    <Cpu className="size-4 animate-spin" /> Initializing Agents...
                  </>
                ) : (
                  <>
                    <Play className="size-4" /> Start Autonomous Tuning
                  </>
                )}
              </button>
            </div>

            {/* 3 Streamlit-Style Tabs */}
            <div className="mt-6 flex border-b border-white/10 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setSetupTab('system')}
                className={`border-b-2 px-5 py-3 transition-all ${
                  setupTab === 'system'
                    ? 'border-purple-400 text-purple-300 font-bold bg-white/[0.02]'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                1 · System &amp; Diagnostics
              </button>
              <button
                type="button"
                onClick={() => setSetupTab('scenario')}
                className={`border-b-2 px-5 py-3 transition-all ${
                  setupTab === 'scenario'
                    ? 'border-purple-400 text-purple-300 font-bold bg-white/[0.02]'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                2 · Scenario &amp; Trajectory
              </button>
              <button
                type="button"
                onClick={() => setSetupTab('tuning')}
                className={`border-b-2 px-5 py-3 transition-all ${
                  setupTab === 'tuning'
                    ? 'border-purple-400 text-purple-300 font-bold bg-white/[0.02]'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                3 · Tuning &amp; Constraints
              </button>
            </div>

            {/* TAB 1: SYSTEM & PRE-FLIGHT DIAGNOSTICS */}
            {setupTab === 'system' && (
              <div className="mt-6 space-y-6">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-purple-300 block mb-2">
                    Dynamics Model Origin
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setDynamicsMode('preset')
                        setSelectedPluginId('example_pendulum')
                      }}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        dynamicsMode === 'preset'
                          ? 'border-purple-400/80 bg-purple-500/15 ring-1 ring-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-bold text-white mb-1">Preset Benchmark</div>
                      <div className="text-[11.5px] text-slate-400">
                        example_pendulum (Inverted Cart-Pole, 4-state nonlinear)
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDynamicsMode('artifact')}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        dynamicsMode === 'artifact'
                          ? 'border-purple-400/80 bg-purple-500/15 ring-1 ring-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-bold text-white mb-1">Synthesizer Artifact</div>
                      <div className="text-[11.5px] text-slate-400">
                        {sessionStorage.getItem('labcd_last_artifact_id')
                          ? `Artifact: ${sessionStorage.getItem('labcd_last_artifact_id')}`
                          : 'Linked from Plant Synthesizer'}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDynamicsMode('custom')}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        dynamicsMode === 'custom'
                          ? 'border-purple-400/80 bg-purple-500/15 ring-1 ring-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-bold text-white mb-1">Custom Plugin (.py)</div>
                      <div className="text-[11.5px] text-slate-400">
                        Custom BaseDynamics class and SystemConfig function
                      </div>
                    </button>
                  </div>

                  {dynamicsMode === 'custom' && (
                    <div className="mt-3 rounded-xl border border-white/10 bg-[#0a0d12] p-3.5">
                      <textarea
                        rows={7}
                        value={customPluginSource}
                        onChange={(e) => setCustomPluginSource(e.target.value)}
                        className="w-full font-mono text-xs text-purple-200 bg-transparent border-none outline-none resize-y"
                      />
                    </div>
                  )}
                </div>

                {/* Pre-flight Dynamics Diagnostics Panel */}
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Gauge className="size-4 text-cyan-400" />
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                          Pre-Flight Dynamics Diagnostics &amp; Bryson Seed Estimation
                        </h4>
                      </div>
                      <p className="text-[11.5px] text-slate-300 mt-1">
                        Runs open-loop step response probe, checks linearized eigenvalues, verifies controllability rank, and calculates Bryson seed weights Q and R.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleTestDynamics}
                      disabled={testingDynamics}
                      className={`${btnBase} ${btnCompact} border-cyan-500/40 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 flex items-center gap-1.5 text-xs font-semibold`}
                    >
                      {testingDynamics ? (
                        <>
                          <Cpu className="size-3.5 animate-spin" /> Probing Dynamics...
                        </>
                      ) : (
                        <>
                          <Zap className="size-3.5 text-cyan-400" /> Test Dynamics &amp; Bryson Probe
                        </>
                      )}
                    </button>
                  </div>

                  {/* Diagnostics Results Cards */}
                  {diagnostics && (
                    <div className="space-y-4 pt-2 border-t border-cyan-500/20">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                        <div className="rounded-lg border border-white/10 bg-[#0a0d12] p-3">
                          <span className="text-[10.5px] text-slate-400 block mb-1">Open-Loop Stability</span>
                          <span
                            className={`font-bold flex items-center gap-1 text-sm ${
                              diagnostics.is_stable ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {diagnostics.is_stable ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                            {diagnostics.is_stable ? 'Stable' : 'Unstable Mode'}
                          </span>
                        </div>

                        <div className="rounded-lg border border-white/10 bg-[#0a0d12] p-3">
                          <span className="text-[10.5px] text-slate-400 block mb-1">Controllability</span>
                          <span className="font-bold text-emerald-400 text-sm flex items-center gap-1">
                            <CheckCircle2 className="size-3.5" />
                            Rank {diagnostics.controllability_rank} / {diagnostics.n_states}
                          </span>
                        </div>

                        <div className="rounded-lg border border-white/10 bg-[#0a0d12] p-3">
                          <span className="text-[10.5px] text-slate-400 block mb-1">Suggested Sample Time</span>
                          <span className="font-bold text-cyan-300 text-sm">
                            dt = {diagnostics.suggested_dt.toFixed(4)}s
                          </span>
                        </div>

                        <div className="rounded-lg border border-white/10 bg-[#0a0d12] p-3">
                          <span className="text-[10.5px] text-slate-400 block mb-1">Eigenvalues Count</span>
                          <span className="font-bold text-purple-300 text-sm">
                            {diagnostics.eigenvalues.length} poles
                          </span>
                        </div>
                      </div>

                      {/* Open-Loop Step Response Probe Trajectory Chart */}
                      {diagnostics.probe_trajectory?.t && diagnostics.probe_trajectory.t.length > 0 && (
                        <div className="rounded-lg border border-white/10 bg-[#0a0d12] p-3.5">
                          <div className="flex items-center justify-between mb-2 text-xs">
                            <span className="font-semibold text-white">
                              Open-Loop Step-Response Probe Trajectory (Characteristic Range for Bryson's Rule)
                            </span>
                            <span className="text-[10.5px] text-slate-400 font-mono">
                              Probe Window: 2.0s · RK4 Integration
                            </span>
                          </div>

                          <div className="h-32 w-full">
                            <svg viewBox="0 0 600 120" className="size-full overflow-visible">
                              <line x1="20" y1="20" x2="580" y2="20" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                              <line x1="20" y1="60" x2="580" y2="60" stroke="rgba(255,255,255,0.08)" />
                              <line x1="20" y1="100" x2="580" y2="100" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

                              {diagnostics.state_names.map((name, i) => {
                                const vals = diagnostics.probe_trajectory.x?.[name] || []
                                if (!vals.length) return null
                                const color = ['#38bdf8', '#a855f7', '#34d399', '#f59e0b'][i % 4]

                                const min = Math.min(...vals)
                                const max = Math.max(...vals)
                                const range = max - min || 1.0

                                const d = vals
                                  .map((v, idx) => {
                                    const x = 20 + (idx / (vals.length - 1)) * 560
                                    const y = 100 - ((v - min) / range) * 80
                                    return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
                                  })
                                  .join(' ')

                                return (
                                  <path
                                    key={name}
                                    d={d}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                  />
                                )
                              })}
                            </svg>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-4 text-[10.5px] font-mono text-slate-400">
                            {diagnostics.state_names.map((name, i) => (
                              <div key={name} className="flex items-center gap-1.5">
                                <span
                                  className="size-2 rounded-full"
                                  style={{
                                    backgroundColor: ['#38bdf8', '#a855f7', '#34d399', '#f59e0b'][i % 4],
                                  }}
                                />
                                <span>{name}: range={diagnostics.probe_trajectory.ranges?.[name] ?? '--'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Notes list */}
                      <div className="rounded-lg bg-black/40 p-3 text-[11px] font-mono text-slate-300 space-y-1">
                        {diagnostics.notes.map((note, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <span className="text-cyan-400">&gt;</span>
                            <span>{note}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: SCENARIO & TRAJECTORY */}
            {setupTab === 'scenario' && (
              <div className="mt-6 space-y-6">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-purple-300 block mb-2">
                    Reference Trajectory Tracking Pattern
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setTrajectoryMode('reg')}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        trajectoryMode === 'reg'
                          ? 'border-purple-400/80 bg-purple-500/15 ring-1 ring-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-bold text-white mb-1">Regulation (Fixed Setpoint)</div>
                      <div className="text-[11.5px] text-slate-400">
                        Stabilize states to origin / trim equilibrium. Overshoot &amp; Settling time certified.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTrajectoryMode('sin')}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        trajectoryMode === 'sin'
                          ? 'border-purple-400/80 bg-purple-500/15 ring-1 ring-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-bold text-white mb-1">Sinusoidal Wave</div>
                      <div className="text-[11.5px] text-slate-400">
                        Continuous harmonic path tracking with velocity derivative matching.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTrajectoryMode('pulse')}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        trajectoryMode === 'pulse'
                          ? 'border-purple-400/80 bg-purple-500/15 ring-1 ring-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-bold text-white mb-1">Step Pulse Wave</div>
                      <div className="text-[11.5px] text-slate-400">
                        Discrete displacement pulses with abrupt rising and falling edges.
                      </div>
                    </button>
                  </div>
                </div>

                {/* Trajectory Knobs & SVG Wave Preview */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 space-y-3 text-xs font-mono">
                    <span className="font-bold text-white block uppercase tracking-wide">
                      Trajectory Parameters
                    </span>

                    {trajectoryMode !== 'reg' && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-slate-400">
                          <span>Amplitude</span>
                          <span className="text-purple-300 font-bold">{trajectoryAmplitude.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0.1}
                          max={2.0}
                          step={0.05}
                          value={trajectoryAmplitude}
                          onChange={(e) => setTrajectoryAmplitude(Number(e.target.value))}
                          className="w-full accent-purple-500"
                        />
                      </div>
                    )}

                    {trajectoryMode === 'sin' && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-slate-400">
                          <span>Frequency (Hz)</span>
                          <span className="text-purple-300 font-bold">{trajectoryFrequency.toFixed(2)} Hz</span>
                        </div>
                        <input
                          type="range"
                          min={0.1}
                          max={2.0}
                          step={0.05}
                          value={trajectoryFrequency}
                          onChange={(e) => setTrajectoryFrequency(Number(e.target.value))}
                          className="w-full accent-purple-500"
                        />
                      </div>
                    )}

                    {trajectoryMode === 'pulse' && (
                      <>
                        <div className="space-y-1">
                          <div className="flex justify-between text-slate-400">
                            <span>Pulse Start (% time)</span>
                            <span className="text-purple-300 font-bold">{Math.round(trajectoryPulseStart * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0.05}
                            max={0.5}
                            step={0.05}
                            value={trajectoryPulseStart}
                            onChange={(e) => setTrajectoryPulseStart(Number(e.target.value))}
                            className="w-full accent-purple-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-slate-400">
                            <span>Pulse End (% time)</span>
                            <span className="text-purple-300 font-bold">{Math.round(trajectoryPulseEnd * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0.5}
                            max={0.95}
                            step={0.05}
                            value={trajectoryPulseEnd}
                            onChange={(e) => setTrajectoryPulseEnd(Number(e.target.value))}
                            className="w-full accent-purple-500"
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-1 pt-2 border-t border-white/5">
                      <div className="flex justify-between text-slate-400">
                        <span>Sensor Measurement Noise (&sigma;)</span>
                        <span className="text-cyan-300 font-bold">{noiseStd.toFixed(3)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.0}
                        max={0.1}
                        step={0.005}
                        value={noiseStd}
                        onChange={(e) => setNoiseStd(Number(e.target.value))}
                        className="w-full accent-cyan-500"
                      />
                    </div>
                  </div>

                  {/* SVG Preview Card */}
                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold text-white block uppercase tracking-wide">
                        Live Reference Profile Preview
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Simulated tracking target over {simTime}s duration
                      </span>
                    </div>

                    <div className="h-24 w-full my-2 relative">
                      <svg viewBox="0 0 360 90" className="size-full overflow-visible">
                        <line x1="0" y1="45" x2="360" y2="45" stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
                        <path
                          d={trajectorySvgPath}
                          fill="none"
                          stroke="#a855f7"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>

                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>t = 0.0s</span>
                      <span>Target Waveform</span>
                      <span>t = {simTime}s</span>
                    </div>
                  </div>
                </div>

                {/* Scenario Uncertainty Level */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-purple-300 block mb-2">
                    Plant Uncertainty &amp; Disturbance Injection
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setScenarioLevel(1)}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        scenarioLevel === 1
                          ? 'border-purple-400/80 bg-purple-500/15 ring-1 ring-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white">Level 1 · Nominal</span>
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300">Clean</span>
                      </div>
                      <p className="text-[11.5px] text-slate-400">
                        Exact model dynamics without parameter drift or disturbance steps.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScenarioLevel(2)}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        scenarioLevel === 2
                          ? 'border-purple-400/80 bg-purple-500/15 ring-1 ring-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white">Level 2 · Parameter Drift</span>
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-mono text-amber-300">&plusmn;20%</span>
                      </div>
                      <p className="text-[11.5px] text-slate-400">
                        Uncertain mass, inertia, and joint friction variations.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScenarioLevel(3)}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        scenarioLevel === 3
                          ? 'border-purple-400/80 bg-purple-500/15 ring-1 ring-purple-400/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-white">Level 3 · Force Step</span>
                        <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-mono text-rose-300">Disturbance</span>
                      </div>
                      <p className="text-[11.5px] text-slate-400">
                        External torque and wind-gust impulses injected during closed loop.
                      </p>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: TUNING & CONSTRAINTS */}
            {setupTab === 'tuning' && (
              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Prediction Horizon (Np)</span>
                      <span className="text-white font-bold">{np}</span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={50}
                      value={np}
                      onChange={(e) => setNp(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Control Horizon (Nc)</span>
                      <span className="text-white font-bold">{nc}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={nc}
                      onChange={(e) => setNc(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Sample Time (dt)</span>
                      <span className="text-white font-bold">{dtMpc.toFixed(4)}s</span>
                    </div>
                    <input
                      type="range"
                      min={0.002}
                      max={0.05}
                      step={0.002}
                      value={dtMpc}
                      onChange={(e) => setDtMpc(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Max Agent Iterations</span>
                      <span className="text-white font-bold">{maxIterations}</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={50}
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Simulation Time (T_sim)</span>
                      <span className="text-white font-bold">{simTime}s</span>
                    </div>
                    <input
                      type="range"
                      min={1.0}
                      max={10.0}
                      step={0.5}
                      value={simTime}
                      onChange={(e) => setSimTime(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Exploration Intensity</span>
                      <span className="text-white font-bold">{explorationIntensity}%</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={explorationIntensity}
                      onChange={(e) => setExplorationIntensity(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>
                </div>

                {/* Weight Inputs with Bryson Seed Autofill */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-purple-300">Initial State Weights Q (Diagonal)</span>
                      <span className="text-[10px] text-slate-400 font-mono">Comma-separated</span>
                    </div>
                    <input
                      type="text"
                      value={qWeightsInput}
                      onChange={(e) => setQWeightsInput(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-purple-200 outline-none focus:border-purple-400"
                    />
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-cyan-300">Initial Actuator Penalties R (Diagonal)</span>
                      <span className="text-[10px] text-slate-400 font-mono">Comma-separated</span>
                    </div>
                    <input
                      type="text"
                      value={rWeightsInput}
                      onChange={(e) => setRWeightsInput(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-cyan-200 outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>

                {/* Guidance input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-purple-300 block">
                    User Directive / LLM Guidance Prompt (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Prioritize aggressive pole stabilization over cart settling time; penalize actuator chatter"
                    value={userGuidance}
                    onChange={(e) => setUserGuidance(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-400"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Active Job View: Full Studio Dashboard */}
        {job && (
          <MpcDashboard
            job={job}
            results={results}
            onDownloadReport={() => {
              if (jobId) {
                window.open(mpcApi.getReportPdfUrl(jobId), '_blank')
              }
            }}
          />
        )}
      </main>
    </div>
  )
}
