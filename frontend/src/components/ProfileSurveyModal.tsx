import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Award,
  Check,
  Cpu,
  Upload,
  X,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from 'lucide-react'
import { surveyApi } from '../api/endpoints'
import { StatusMessage } from './StatusMessage'

interface ProfileSurveyModalProps {
  onCompleted: () => void | Promise<void>
}

type ToolKey =
  | 'simulink'
  | 'gtsuite'
  | 'comsol'
  | 'amesim'
  | 'modelica'
  | 'python'
  | 'maplesim'
  | 'equations'

type ExperienceKey = 'new' | 'tuned' | 'advanced' | 'research'
type RecencyKey = 'month' | '1_6' | '6_12' | 'year_plus' | 'never'
type GoalKey =
  | 'design_plant'
  | 'explore'
  | 'benchmark'
  | 'learn'
  | 'team'
  | 'other'
type PipelineKey = 'silo' | 'mulo' | 'adaptive' | 'mpc'

interface ToolItem {
  key: ToolKey
  title: string
  sub: string
  badgeText: string
  badgeGradient: string
}

const TOOLS: ToolItem[] = [
  {
    key: 'simulink',
    title: 'MATLAB / Simulink',
    sub: 'mathworks.com',
    badgeText: 'M',
    badgeGradient: 'from-[#e87722] to-[#c45a10]',
  },
  {
    key: 'gtsuite',
    title: 'GT-SUITE',
    sub: 'gtisoft.com',
    badgeText: 'GT',
    badgeGradient: 'from-[#0ea5e9] to-[#0369a1]',
  },
  {
    key: 'comsol',
    title: 'COMSOL Multiphysics',
    sub: 'comsol.com',
    badgeText: 'C',
    badgeGradient: 'from-[#f59e0b] to-[#b45309]',
  },
  {
    key: 'amesim',
    title: 'Simcenter Amesim',
    sub: 'siemens.com',
    badgeText: 'A',
    badgeGradient: 'from-[#009999] to-[#006666]',
  },
  {
    key: 'modelica',
    title: 'Modelica / Dymola',
    sub: 'modelica.org',
    badgeText: 'Mo',
    badgeGradient: 'from-[#8b5cf6] to-[#5b21b6]',
  },
  {
    key: 'python',
    title: 'Python (SciPy / CasADi)',
    sub: 'python.org',
    badgeText: 'Py',
    badgeGradient: 'from-[#3776ab] to-[#25527a]',
  },
  {
    key: 'maplesim',
    title: 'MapleSim / Maple',
    sub: 'maplesoft.com',
    badgeText: 'Ma',
    badgeGradient: 'from-[#c41e3a] to-[#7f1d1d]',
  },
  {
    key: 'equations',
    title: 'Equations / paper models',
    sub: 'custom or hand-derived',
    badgeText: '∑',
    badgeGradient: 'from-[#64748b] to-[#334155]',
  },
]

interface ExperienceItem {
  key: ExperienceKey
  title: string
  desc: string
}

const EXPERIENCES: ExperienceItem[] = [
  {
    key: 'new',
    title: "I'm new to control design",
    desc: 'Still learning the basics of feedback and tuning.',
  },
  {
    key: 'tuned',
    title: "I've tuned controllers before",
    desc: 'PID, lead-lag, and similar classical structures.',
  },
  {
    key: 'advanced',
    title: 'I design advanced controllers',
    desc: 'Multi-loop, state-space, or nonlinear designs regularly.',
  },
  {
    key: 'research',
    title: 'I research or teach control',
    desc: 'Academic or training context is primary.',
  },
]

const RECENCY_OPTIONS: { key: RecencyKey; label: string }[] = [
  { key: 'month', label: 'Within last month' },
  { key: '1_6', label: '1–6 months' },
  { key: '6_12', label: '6–12 months' },
  { key: 'year_plus', label: 'Over a year' },
  { key: 'never', label: 'Not yet' },
]

interface GoalItem {
  key: GoalKey
  title: string
  desc: string
}

const GOALS: GoalItem[] = [
  {
    key: 'design_plant',
    title: 'Design a controller',
    desc: 'For an existing plant model I already have.',
  },
  {
    key: 'explore',
    title: 'Explore AI pipelines',
    desc: 'SILO / MULO / Adaptive / MPC with guided flow.',
  },
  {
    key: 'benchmark',
    title: 'Benchmark vs MATLAB',
    desc: 'Compare speed and quality to my current workflow.',
  },
  {
    key: 'learn',
    title: 'Learn with examples',
    desc: 'Guided case studies and ready-to-run plants.',
  },
  {
    key: 'team',
    title: 'Evaluate for my team',
    desc: 'Assess LabCD for company or lab adoption.',
  },
  {
    key: 'other',
    title: 'Something else',
    desc: 'Tell us in a short note.',
  },
]

interface PipelineItem {
  key: PipelineKey
  title: string
  desc: string
  route: string
}

const PIPELINES: PipelineItem[] = [
  {
    key: 'silo',
    title: 'SILO',
    desc: 'Single-loop design — PID and classical structures. Best if you already have a SISO plant.',
    route: '/silo',
  },
  {
    key: 'mulo',
    title: 'MULO',
    desc: 'Multi-loop architecture + cascade / GA-assisted design for coupled systems.',
    route: '/mulo',
  },
  {
    key: 'adaptive',
    title: 'Adaptive',
    desc: 'Nonlinear adaptive / sliding-mode style design with stability focus.',
    route: '/adaptive',
  },
  {
    key: 'mpc',
    title: 'MPC',
    desc: 'Model predictive control auto-tuning with constraint handling.',
    route: '/mpc',
  },
]

const LABELS = {
  tools: {
    simulink: 'MATLAB / Simulink',
    gtsuite: 'GT-SUITE',
    comsol: 'COMSOL',
    amesim: 'Amesim',
    modelica: 'Modelica / Dymola',
    python: 'Python',
    maplesim: 'MapleSim',
    equations: 'Equations / paper',
  },
  experience: {
    new: 'New to control design',
    tuned: 'Has tuned controllers',
    advanced: 'Advanced / multi-loop',
    research: 'Research / teaching',
  },
  recency: {
    month: 'last month',
    '1_6': '1–6 months',
    '6_12': '6–12 months',
    year_plus: 'over a year',
    never: 'not yet',
  },
  goals: {
    design_plant: 'Design a controller',
    explore: 'Explore AI pipelines',
    benchmark: 'Benchmark vs MATLAB',
    learn: 'Learn with examples',
    team: 'Evaluate for team',
    other: 'Something else',
  },
  pipeline: {
    silo: 'SILO',
    mulo: 'MULO',
    adaptive: 'Adaptive',
    mpc: 'MPC',
  },
} as const

export function ProfileSurveyModal({ onCompleted }: ProfileSurveyModalProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState<number>(1)
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')

  // Form State
  const [selectedTools, setSelectedTools] = useState<ToolKey[]>([])
  const [selectedExp, setSelectedExp] = useState<ExperienceKey | null>(null)
  const [selectedRecency, setSelectedRecency] = useState<RecencyKey | null>(null)
  const [selectedGoals, setSelectedGoals] = useState<GoalKey[]>([])
  const [otherText, setOtherText] = useState('')
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineKey | null>(null)

  // Status & Validation
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Navigation between steps with directional animation tracking
  const goTo = (target: number) => {
    setError(null)
    setDirection(target >= step ? 'forward' : 'backward')
    setStep(target)
  }

  const toggleTool = (key: ToolKey) => {
    setSelectedTools((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
    setError(null)
  }

  const continueTools = () => {
    if (selectedTools.length === 0) {
      setError('Select at least one option to continue.')
      return
    }
    goTo(3)
  }

  const continueExperience = () => {
    if (!selectedExp) {
      setError('Pick an experience level to continue.')
      return
    }
    goTo(4)
  }

  const toggleGoal = (key: GoalKey) => {
    setError(null)
    setSelectedGoals((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key)
      }
      if (prev.length >= 2) {
        setError('Select at most 2 goals.')
        return prev
      }
      return [...prev, key]
    })
  }

  const continueGoals = () => {
    if (selectedGoals.length === 0 || selectedGoals.length > 2) {
      setError('Select 1 or 2 goals (max 2).')
      return
    }
    goTo(5)
  }

  const continuePipeline = () => {
    if (!selectedPipeline) {
      setError('Choose a starting pipeline.')
      return
    }
    goTo(6)
  }

  // Submit flow
  const submitAnswers = async (navTarget?: string) => {
    setSaving(true)
    setError(null)
    try {
      await surveyApi.submitProfile({
        tools: selectedTools,
        experience: selectedExp,
        recency: selectedRecency,
        goals: selectedGoals,
        other_text: otherText.trim(),
        pipeline: selectedPipeline,
        completed: true,
        skipped: false,
        onboarding_answers: {
          tools: selectedTools,
          experience: selectedExp,
          recency: selectedRecency,
          goals: selectedGoals,
          other_text: otherText.trim(),
          pipeline: selectedPipeline,
          completed: true,
          skipped: false,
        },
      })
      await onCompleted()
      if (navTarget) {
        navigate(navTarget)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save answers')
      setSaving(false)
    }
  }

  const handleSkip = async () => {
    setSaving(true)
    setError(null)
    try {
      await surveyApi.submitProfile({
        completed: false,
        skipped: true,
        onboarding_answers: {
          tools: selectedTools,
          experience: selectedExp,
          recency: selectedRecency,
          goals: selectedGoals,
          other_text: otherText.trim(),
          pipeline: selectedPipeline,
          completed: false,
          skipped: true,
        },
      })
      await onCompleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip')
      setSaving(false)
    }
  }

  // Summary rendering strings
  const summaryTools =
    selectedTools.map((k) => LABELS.tools[k] || k).join(', ') || '—'

  let summaryExp = selectedExp ? LABELS.experience[selectedExp] : '—'
  if (selectedRecency) {
    summaryExp += ` · last project: ${LABELS.recency[selectedRecency] || selectedRecency.replace('_', '–')}`
  }

  let summaryGoals = selectedGoals
    .map((k) => (k === 'other' && otherText.trim() ? `Other (“${otherText.trim()}”)` : LABELS.goals[k] || k))
    .join(', ') || '—'

  const summaryPipeline = selectedPipeline
    ? LABELS.pipeline[selectedPipeline]
    : '—'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="relative w-full max-w-[540px] my-auto bg-surface-elevated border border-border rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.03)] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-2">
          <div className="flex-1 pr-2">
            <h1
              id="onboarding-title"
              className="m-0 text-lg sm:text-xl font-semibold tracking-tight text-foreground transition-colors"
            >
              {step === 1 && 'Welcome to LabCD'}
              {step === 2 && 'Tell us about your modeling stack'}
              {step === 3 && 'Your control-design experience'}
              {step === 4 && 'What do you want to get done?'}
              {step === 5 && 'Where should we start?'}
              {step === 6 && 'You’re ready'}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-text font-normal leading-relaxed">
              {step === 1 &&
                'Design controllers from your plant model in minutes — not weeks.'}
              {step === 2 &&
                'Which tools do you currently use to model dynamical systems? Select all that apply.'}
              {step === 3 &&
                'This helps us pitch explanations at the right level — no judgment either way.'}
              {step === 4 &&
                'Pick up to 2 — we’ll prioritize your first-run path.'}
              {step === 5 &&
                'You can switch anytime. Pick a default for your first session.'}
              {step === 6 &&
                'Upload a MATLAB (.m) or Python (.py) plant model to begin. We’ll regularize the code and guide you through design.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSkip()}
            disabled={saving}
            className="w-8 h-8 rounded-lg flex items-center justify-center border border-border bg-surface-muted text-muted-text hover:text-foreground hover:border-foreground/20 hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0"
            aria-label="Skip onboarding"
            title="Skip onboarding"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar dots with smooth size/color morph */}
        <div className="flex gap-1.5 items-center justify-center px-5 sm:px-6 py-2" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <span
              key={idx}
              className={`h-1.5 rounded-full transition-all duration-300 ease-out ${
                step === idx
                  ? 'w-5 bg-primary'
                  : 'w-1.5 bg-foreground/15'
              }`}
            />
          ))}
        </div>

        {/* Modal Body with Animated Step Transition */}
        <div className="px-5 sm:px-6 py-2.5 max-h-[min(65vh,520px)] overflow-y-auto overflow-x-hidden">
          <div
            key={step}
            className={
              direction === 'forward'
                ? 'onboarding-step-in-forward'
                : 'onboarding-step-in-backward'
            }
          >
            {/* STEP 1: Welcome */}
            {step === 1 && (
              <div className="flex flex-col gap-3 py-1">
                <div className="flex gap-3.5 items-start p-3.5 rounded-xl bg-surface-muted border border-border/50 text-left transition-all hover:bg-surface-hover hover:border-foreground/15">
                  <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center bg-primary/10 text-primary">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div>
                    <strong className="block text-xs sm:text-sm font-semibold text-foreground mb-0.5">
                      Upload your plant
                    </strong>
                    <span className="text-xs text-muted-text leading-relaxed">
                      MATLAB (.m) or Python (.py) dynamics — we regularize the code.
                    </span>
                  </div>
                </div>

                <div className="flex gap-3.5 items-start p-3.5 rounded-xl bg-surface-muted border border-border/50 text-left transition-all hover:bg-surface-hover hover:border-foreground/15">
                  <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center bg-primary/10 text-primary">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <strong className="block text-xs sm:text-sm font-semibold text-foreground mb-0.5">
                      AI-assisted design
                    </strong>
                    <span className="text-xs text-muted-text leading-relaxed">
                      SILO, MULO, Adaptive, or MPC pipelines with guided clarifying steps.
                    </span>
                  </div>
                </div>

                <div className="flex gap-3.5 items-start p-3.5 rounded-xl bg-surface-muted border border-border/50 text-left transition-all hover:bg-surface-hover hover:border-foreground/15">
                  <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center bg-primary/10 text-primary">
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <strong className="block text-xs sm:text-sm font-semibold text-foreground mb-0.5">
                      Score, export, iterate
                    </strong>
                    <span className="text-xs text-muted-text leading-relaxed">
                      Get a 0–100% score, success flag, and export .py / .pdf.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Modeling Tools */}
            {step === 2 && (
              <div className="py-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {TOOLS.map((tool) => {
                    const isSelected = selectedTools.includes(tool.key)
                    return (
                      <div
                        key={tool.key}
                        onClick={() => toggleTool(tool.key)}
                        className={`relative flex flex-col items-start gap-1 p-3 rounded-xl border select-none text-left cursor-pointer transition-all duration-150 hover:scale-[1.012] active:scale-[0.985] ${
                          isSelected
                            ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/25'
                            : 'bg-surface-muted border-border hover:border-foreground/20 hover:bg-surface-hover'
                        }`}
                      >
                        <span
                          className={`absolute top-2.5 right-2.5 w-4 h-4 rounded-full flex items-center justify-center border transition-all duration-200 ${
                            isSelected
                              ? 'border-primary bg-primary text-white scale-100 shadow-sm'
                              : 'border-foreground/25 bg-transparent text-transparent scale-75'
                          }`}
                        >
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white mb-1 shadow-sm bg-gradient-to-br ${tool.badgeGradient}`}
                        >
                          {tool.badgeText}
                        </div>
                        <div className="text-xs sm:text-sm font-semibold text-foreground pr-5 leading-tight">
                          {tool.title}
                        </div>
                        <div className="text-[11px] text-muted-text">{tool.sub}</div>
                      </div>
                    )
                  })}
                </div>
                {error && (
                  <p className="mt-2.5 text-xs text-[var(--app-status-warning-text)] font-medium">
                    {error}
                  </p>
                )}
              </div>
            )}

            {/* STEP 3: Experience */}
            {step === 3 && (
              <div className="py-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {EXPERIENCES.map((exp) => {
                    const isSelected = selectedExp === exp.key
                    return (
                      <div
                        key={exp.key}
                        onClick={() => {
                          setSelectedExp(exp.key)
                          setError(null)
                        }}
                        className={`relative flex flex-col items-start gap-1 p-3 rounded-xl border select-none text-left cursor-pointer transition-all duration-150 hover:scale-[1.012] active:scale-[0.985] ${
                          isSelected
                            ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/25'
                            : 'bg-surface-muted border-border hover:border-foreground/20 hover:bg-surface-hover'
                        }`}
                      >
                        <span
                          className={`absolute top-2.5 right-2.5 w-4 h-4 rounded-full flex items-center justify-center border transition-all duration-200 ${
                            isSelected
                              ? 'border-primary bg-primary text-white scale-100 shadow-sm'
                              : 'border-foreground/25 bg-transparent text-transparent scale-75'
                          }`}
                        >
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                        <div className="text-xs sm:text-sm font-semibold text-foreground pr-5 leading-tight">
                          {exp.title}
                        </div>
                        <div className="text-xs text-muted-text mt-0.5 leading-snug">
                          {exp.desc}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="text-[11px] font-semibold text-muted-text uppercase tracking-wider mt-4 mb-2">
                  Last serious project was… (optional)
                </div>
                <div className="flex flex-wrap gap-2">
                  {RECENCY_OPTIONS.map((rec) => {
                    const isSelected = selectedRecency === rec.key
                    return (
                      <button
                        key={rec.key}
                        type="button"
                        onClick={() =>
                          setSelectedRecency(isSelected ? null : rec.key)
                        }
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 hover:scale-[1.03] active:scale-[0.97] cursor-pointer ${
                          isSelected
                            ? 'bg-primary/15 border-primary/50 text-primary font-semibold ring-1 ring-primary/25'
                            : 'bg-surface-muted border-border text-muted-text hover:text-foreground hover:border-foreground/20'
                        }`}
                      >
                        {rec.label}
                      </button>
                    )
                  })}
                </div>
                {error && (
                  <p className="mt-2.5 text-xs text-[var(--app-status-warning-text)] font-medium">
                    {error}
                  </p>
                )}
              </div>
            )}

            {/* STEP 4: Job to Be Done */}
            {step === 4 && (
              <div className="py-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {GOALS.map((goal) => {
                    const isSelected = selectedGoals.includes(goal.key)
                    return (
                      <div
                        key={goal.key}
                        onClick={() => toggleGoal(goal.key)}
                        className={`relative flex flex-col items-start gap-1 p-3 rounded-xl border select-none text-left cursor-pointer transition-all duration-150 hover:scale-[1.012] active:scale-[0.985] ${
                          isSelected
                            ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/25'
                            : 'bg-surface-muted border-border hover:border-foreground/20 hover:bg-surface-hover'
                        }`}
                      >
                        <span
                          className={`absolute top-2.5 right-2.5 w-4 h-4 rounded-full flex items-center justify-center border transition-all duration-200 ${
                            isSelected
                              ? 'border-primary bg-primary text-white scale-100 shadow-sm'
                              : 'border-foreground/25 bg-transparent text-transparent scale-75'
                          }`}
                        >
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                        <div className="text-xs sm:text-sm font-semibold text-foreground pr-5 leading-tight">
                          {goal.title}
                        </div>
                        <div className="text-xs text-muted-text mt-0.5 leading-snug">
                          {goal.desc}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {selectedGoals.includes('other') && (
                  <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-150">
                    <input
                      type="text"
                      value={otherText}
                      onChange={(e) => setOtherText(e.target.value)}
                      placeholder="What are you hoping to do?"
                      maxLength={120}
                      className="w-full px-3 py-2 border border-border bg-surface-muted rounded-lg text-xs sm:text-sm text-foreground placeholder:text-muted-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                )}

                {error && (
                  <p className="mt-2.5 text-xs text-[var(--app-status-warning-text)] font-medium">
                    {error}
                  </p>
                )}
              </div>
            )}

            {/* STEP 5: Pipeline Preference */}
            {step === 5 && (
              <div className="py-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {PIPELINES.map((pipe) => {
                    const isSelected = selectedPipeline === pipe.key
                    return (
                      <div
                        key={pipe.key}
                        onClick={() => {
                          setSelectedPipeline(pipe.key)
                          setError(null)
                        }}
                        className={`relative flex flex-col items-start gap-1 p-3 rounded-xl border select-none text-left cursor-pointer transition-all duration-150 hover:scale-[1.012] active:scale-[0.985] ${
                          isSelected
                            ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/25'
                            : 'bg-surface-muted border-border hover:border-foreground/20 hover:bg-surface-hover'
                        }`}
                      >
                        <span
                          className={`absolute top-2.5 right-2.5 w-4 h-4 rounded-full flex items-center justify-center border transition-all duration-200 ${
                            isSelected
                              ? 'border-primary bg-primary text-white scale-100 shadow-sm'
                              : 'border-foreground/25 bg-transparent text-transparent scale-75'
                          }`}
                        >
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                        <div className="text-xs sm:text-sm font-semibold text-foreground pr-5 leading-tight">
                          {pipe.title}
                        </div>
                        <div className="text-xs text-muted-text mt-0.5 leading-snug">
                          {pipe.desc}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {error && (
                  <p className="mt-2.5 text-xs text-[var(--app-status-warning-text)] font-medium">
                    {error}
                  </p>
                )}
              </div>
            )}

            {/* STEP 6: Summary */}
            {step === 6 && (
              <div className="flex flex-col gap-2.5 py-1">
                <div className="flex gap-2.5 items-start p-2.5 rounded-xl bg-surface-muted border border-border/50 text-left transition-all hover:bg-surface-hover">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 bg-emerald-500/15 text-emerald-500 mt-0.5 shadow-sm">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-text uppercase font-semibold tracking-wider">
                      Modeling tools
                    </div>
                    <div className="text-xs sm:text-sm font-semibold text-foreground mt-0.5">
                      {summaryTools}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5 items-start p-2.5 rounded-xl bg-surface-muted border border-border/50 text-left transition-all hover:bg-surface-hover">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 bg-emerald-500/15 text-emerald-500 mt-0.5 shadow-sm">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-text uppercase font-semibold tracking-wider">
                      Experience
                    </div>
                    <div className="text-xs sm:text-sm font-semibold text-foreground mt-0.5">
                      {summaryExp}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5 items-start p-2.5 rounded-xl bg-surface-muted border border-border/50 text-left transition-all hover:bg-surface-hover">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 bg-emerald-500/15 text-emerald-500 mt-0.5 shadow-sm">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-text uppercase font-semibold tracking-wider">
                      Goals
                    </div>
                    <div className="text-xs sm:text-sm font-semibold text-foreground mt-0.5">
                      {summaryGoals}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5 items-start p-2.5 rounded-xl bg-surface-muted border border-border/50 text-left transition-all hover:bg-surface-hover">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 bg-emerald-500/15 text-emerald-500 mt-0.5 shadow-sm">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-text uppercase font-semibold tracking-wider">
                      Starting pipeline
                    </div>
                    <div className="text-xs sm:text-sm font-semibold text-foreground mt-0.5">
                      {summaryPipeline}
                    </div>
                  </div>
                </div>

                {error && <StatusMessage type="error" message={error} />}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 sm:px-6 py-4 border-t border-border/50 mt-2 bg-surface-muted/30">
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={saving}
                className="bg-transparent border-none text-xs text-muted-text hover:text-foreground hover:underline cursor-pointer font-inherit p-0 transition-colors"
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={() => goTo(2)}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 cursor-pointer font-medium text-xs sm:text-sm text-white bg-gradient-to-r from-primary via-indigo-500 to-[#4a63e0] shadow-[0_2px_14px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_22px_rgba(99,102,241,0.55)] hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <span>Get started</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => goTo(1)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 border border-border bg-surface-muted text-foreground text-xs sm:text-sm font-medium hover:border-foreground/20 active:scale-[0.98] cursor-pointer transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Go back</span>
              </button>
              <button
                type="button"
                onClick={continueTools}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 cursor-pointer font-medium text-xs sm:text-sm text-white bg-gradient-to-r from-primary via-indigo-500 to-[#4a63e0] shadow-[0_2px_14px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_22px_rgba(99,102,241,0.55)] hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <button
                type="button"
                onClick={() => goTo(2)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 border border-border bg-surface-muted text-foreground text-xs sm:text-sm font-medium hover:border-foreground/20 active:scale-[0.98] cursor-pointer transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Go back</span>
              </button>
              <button
                type="button"
                onClick={continueExperience}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 cursor-pointer font-medium text-xs sm:text-sm text-white bg-gradient-to-r from-primary via-indigo-500 to-[#4a63e0] shadow-[0_2px_14px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_22px_rgba(99,102,241,0.55)] hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 4 && (
            <>
              <button
                type="button"
                onClick={() => goTo(3)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 border border-border bg-surface-muted text-foreground text-xs sm:text-sm font-medium hover:border-foreground/20 active:scale-[0.98] cursor-pointer transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Go back</span>
              </button>
              <button
                type="button"
                onClick={continueGoals}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 cursor-pointer font-medium text-xs sm:text-sm text-white bg-gradient-to-r from-primary via-indigo-500 to-[#4a63e0] shadow-[0_2px_14px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_22px_rgba(99,102,241,0.55)] hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 5 && (
            <>
              <button
                type="button"
                onClick={() => goTo(4)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 border border-border bg-surface-muted text-foreground text-xs sm:text-sm font-medium hover:border-foreground/20 active:scale-[0.98] cursor-pointer transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Go back</span>
              </button>
              <button
                type="button"
                onClick={continuePipeline}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 cursor-pointer font-medium text-xs sm:text-sm text-white bg-gradient-to-r from-primary via-indigo-500 to-[#4a63e0] shadow-[0_2px_14px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_22px_rgba(99,102,241,0.55)] hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <span>Start with this</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 6 && (
            <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void submitAnswers('/tutorials')}
                disabled={saving}
                className="bg-transparent border-none text-xs text-muted-text hover:text-foreground hover:underline cursor-pointer font-inherit p-0 text-center sm:text-left transition-colors"
              >
                Show this guide again from Tutorials
              </button>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => void submitAnswers('/case-studies')}
                  disabled={saving}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 border border-border bg-surface-muted text-foreground text-xs sm:text-sm font-medium hover:border-foreground/20 active:scale-[0.98] cursor-pointer transition-all"
                >
                  Browse case studies
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const chosen = PIPELINES.find((p) => p.key === selectedPipeline)
                    void submitAnswers(chosen ? chosen.route : '/design')
                  }}
                  disabled={saving}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 cursor-pointer font-medium text-xs sm:text-sm text-white bg-gradient-to-r from-primary via-indigo-500 to-[#4a63e0] shadow-[0_2px_14px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_22px_rgba(99,102,241,0.55)] hover:brightness-110 active:scale-[0.98] transition-all"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Upload plant model</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
