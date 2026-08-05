export interface JobResponse {
  job_id: string
  module: string
  status: string
}

export interface JobStatusResponse {
  job_id: string
  module: string
  status: string
  metadata: Record<string, unknown>
  error?: string
}

export interface UploadResponse {
  file_name: string
  file_type: string
  file_content: string
}

export interface MediaUploadResponse {
  url: string
}

export interface ModelsResponse {
  llm_models: string[]
  rag_models: string[]
}

export interface RegularizeResponse {
  file_content: string
  change_applied: boolean
  human_intervention: boolean
}

export interface StandardizeResponse {
  file_content: string
}

export interface RecommenderHandoffResponse {
  file_content: string
  chosen_controller: string
  trimming_params: string[]
  states_inputs: string[]
}

export interface TrimmerArtifactsResponse {
  result: Record<string, unknown>
  config: Record<string, unknown>
  pdf_file?: string
  safe_system_name: string
  output_dir: string
  time_response_file?: string
}

export interface TrimmerTimeResponseResponse {
  filename: string
  message: string
}

export interface CaseStudiesResponse {
  python: string[]
  matlab: string[]
  ga_json: string[]
  mulo: string[]
  mulo_objectives: Record<string, string>
}

export interface ArtifactResponse {
  job_id: string
  artifacts: Record<string, unknown>
}

export interface RagStatusResponse {
  next_step: 'comparison' | 'review'
  error_message: string
}

export interface MuloDesignerStateResponse {
  job_id: string
  controller_index: number
  controller_designed: boolean
  total_loops: number
  loop_name: string
  is_complete: boolean
  equation: string
  controller_structure: Record<string, unknown>[]
  case_study: Record<string, unknown>
  run_config: Record<string, unknown>
  final_state: Record<string, unknown>
  modified_code: string
  modified_controller_structure: Record<string, unknown>[]
  pid_gains: { Kp: number; Ki: number; Kd: number }
  pid_gain_bounds: { Kp: number; Ki: number; Kd: number }
}

export interface MuloSimulateResponse {
  signal_type: string
  time: number[]
  actual: number[]
  reference: number[]
  y_label: string
  unit: string
  code: string
  amplitude?: number
}

export interface SiloSimTrace {
  metrics: Record<string, number | boolean | null>
  trajectory: number[]
  control_signals: number[]
  errors?: number[]
}

export interface SiloSimulateResponse {
  controller_type: string
  optimal_gains: Record<string, number>
  manual_gains: Record<string, number>
  param_bounds: Record<string, [number, number]>
  target: number
  dt: number
  max_time: number
  time: number[]
  optimal: SiloSimTrace
  manual: SiloSimTrace | null
}

export type PipelineType = 'siloDesign' | 'muloDesign' | null

export interface StreamEvent {
  type: string
  mode?: string
  content?: unknown
  step?: string
  job_id?: string
  status?: string
  error?: string
  summary?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AuthUser {
  id: number
  email: string
  display_name: string | null
  avatar_url: string | null
  theme: ThemeMode
  is_admin: boolean
  is_active: boolean
  plan_id: number | null
  plan_name: string | null
  actions: string[]
  created_at: string
  profile_survey_completed?: boolean
  feedback_survey_completed?: boolean
  feedback_survey_completed_silo?: boolean
  feedback_survey_completed_mulo?: boolean
  tutorial_dont_show_again?: boolean
}

export interface UserProfileSurveyDetail {
  university: string | null
  degree: string | null
  major: string | null
  matlab_experience: string | null
  control_design_experience: string | null
  completed_at: string | null
}

export interface UserFeedbackSurveyDetail {
  pipeline_type: FeedbackPipelineType
  satisfaction: number
  ease_of_use: number
  product_value: number
  confidence: number
  reuse_intention: number
  willingness_to_pay: number
  main_problems: string
  created_at: string
}

export interface LoginHistoryEntry {
  id: number
  email: string
  success: boolean
  ip_address: string | null
  user_agent: string | null
  failure_reason: string | null
  created_at: string
}

export interface AdminUserDetail {
  user: AuthUser
  allowed_models: string[]
  profile_survey: UserProfileSurveyDetail | null
  feedback_surveys: UserFeedbackSurveyDetail[]
  projects: ProjectSummary[]
  errors: ErrorEvent[]
  login_history: LoginHistoryEntry[]
}

export type ExperienceLevel = 'None' | 'Beginner' | 'Intermediate' | 'Advanced'
export type DegreeLevel = "Bachelor's" | "Master's" | 'PhD' | 'Other'
export type FeedbackPipelineType = 'siloDesign' | 'muloDesign'
export type MajorField =
  | 'Electrical Engineering'
  | 'Mechanical Engineering'
  | 'Chemical Engineering'
  | 'Aerospace Engineering'
  | 'Computer Science'
  | 'Control Engineering'
  | 'Mechatronics'
  | 'Other'

export interface SurveySettings {
  enabled: boolean
}

export interface TutorialVideo {
  id: number
  title: string
  file_url: string
  sort_order: number
  created_at: string
}

export interface SurveyStatus {
  enabled: boolean
  needs_profile_survey: boolean
  feedback_completed: boolean
  feedback_completed_silo: boolean
  feedback_completed_mulo: boolean
  show_tutorial: boolean
  videos: TutorialVideo[]
}

export interface ProfileSurveyRequest {
  university: string
  degree: DegreeLevel
  major: MajorField
  matlab_experience: ExperienceLevel
  control_design_experience: ExperienceLevel
}

export interface FeedbackSurveyRequest {
  pipeline_type: FeedbackPipelineType
  satisfaction: number
  ease_of_use: number
  product_value: number
  confidence: number
  reuse_intention: number
  willingness_to_pay: number
  main_problems: string
}

export interface ProfileSurveyResponseRow {
  user_id: number
  email: string
  university: string | null
  degree: string | null
  major: string | null
  matlab_experience: string | null
  control_design_experience: string | null
  completed_at: string | null
}

export interface FeedbackSurveyResponseRow {
  user_id: number
  email: string
  pipeline_type: FeedbackPipelineType
  satisfaction: number
  ease_of_use: number
  product_value: number
  confidence: number
  reuse_intention: number
  willingness_to_pay: number
  main_problems: string
  created_at: string
}

export interface SurveyResponses {
  profile: ProfileSurveyResponseRow[]
  feedback: FeedbackSurveyResponseRow[]
}

export interface ActionInfo {
  code: string
  description: string
}

export interface PlanInfo {
  id: number
  name: string
  description: string
  price: number
  is_active: boolean
  actions: string[]
  models: string[]
  created_at: string
}

export interface DefaultPlanInfo {
  plan_id: number | null
  plan: PlanInfo | null
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

export type ProjectPipelineType = 'siloDesign' | 'muloDesign'
export type ProjectStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ProjectSummary {
  id: number
  user_id: number
  owner_email?: string | null
  title: string
  pipeline_type: ProjectPipelineType
  status: ProjectStatus
  file_name: string
  file_type: string
  file_url?: string | null
  llm_model: string
  has_results: boolean
  job_id?: string | null
  created_at: string
  updated_at: string
}

export interface ProjectDetail extends ProjectSummary {
  file_content: string
  control_objective?: string | null
  results?: Record<string, unknown> | null
}

export interface MemoryMetrics {
  used_bytes: number
  total_bytes: number
  percent: number
}

export interface DiskMetrics {
  used_bytes: number
  total_bytes: number
  percent: number
}

export interface NetworkMetrics {
  bytes_sent: number
  bytes_recv: number
  sent_rate_bps: number
  recv_rate_bps: number
}

export interface ApiMetrics {
  avg_latency_ms: number
  p50_latency_ms: number
  p95_latency_ms: number
  error_rate_percent: number
  requests_in_window: number
}

export interface MonitoringSnapshot {
  collected_at: string
  uptime_seconds: number
  cpu_percent: number
  memory: MemoryMetrics
  disk: DiskMetrics
  network: NetworkMetrics
  api: ApiMetrics
}

export interface MonitoringResponse {
  current: MonitoringSnapshot
  history: MonitoringSnapshot[]
}

export interface ErrorTrackingSettings {
  enabled: boolean
  frontend: boolean
  backend: boolean
  api: boolean
}

export type ErrorEventSource = 'frontend' | 'backend' | 'api'

export interface ErrorEvent {
  id: number
  source: ErrorEventSource | string
  message: string
  stack_trace: string | null
  path: string | null
  method: string | null
  status_code: number | null
  user_id: number | null
  user_agent: string | null
  page_url: string | null
  extra: Record<string, unknown> | null
  created_at: string | null
}

export interface SiteBrand {
  brand_name: string
  tagline: string
  logo_url: string
  primary_color: string
  secondary_color: string
  sign_in_url: string
  access_platform_url: string
  page_title: string
}

export interface NavMenuItem {
  id: number
  location: string
  label: string
  href: string
  sort_order: number
  is_external: boolean
}

export interface LandingPayload {
  brand: SiteBrand
  menus: Record<string, NavMenuItem[]>
  landing: Record<string, unknown>
}

export interface BlogPostListItem {
  id: number
  title: string
  slug: string
  excerpt: string
  cover_image_url: string | null
  status: string
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface BlogPost extends BlogPostListItem {
  body_markdown: string
  author_id: number | null
}

export type BugReportStatus = 'open' | 'fixed'

export interface BugReport {
  id: number
  user_id: number | null
  user_email: string | null
  description: string
  image_url: string | null
  page_url: string | null
  status: BugReportStatus | string
  created_at: string
  fixed_at: string | null
}

export interface BugReportSettings {
  enabled: boolean
}

