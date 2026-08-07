import { apiFetch, artifactUrl, AUTH_TIMEOUT_MS, getAuthToken, projectArtifactUrl } from './client'
import type {
  ActionInfo,
  ArtifactResponse,
  AdminUserDetail,
  AuthUser,
  CaseStudiesResponse,
  DefaultPlanInfo,
  ErrorEvent,
  ErrorTrackingSettings,
  FeedbackSurveyRequest,
  FeedbackSurveyResponseRow,
  JobResponse,
  JobStatusResponse,
  ModelsResponse,
  MonitoringResponse,
  MuloDesignerStateResponse,
  MuloSimulateResponse,
  PlanInfo,
  ProfileSurveyRequest,
  ProjectDetail,
  ProjectSummary,
  RagStatusResponse,
  RecommenderHandoffResponse,
  RegularizeResponse,
  RoleInfo,
  SiloSimulateResponse,
  StandardizeResponse,
  SurveyResponses,
  SurveySettings,
  SurveyStatus,
  TokenResponse,
  TrimmerArtifactsResponse,
  TutorialVideo,
  UploadResponse,
  MediaUploadResponse,
  SiteBrand,
  NavMenuItem,
  LandingPayload,
  BlogPost,
  BlogPostListItem,
  BugReport,
  BugReportSettings,
  AuthSessionInfo,
  MessageResponse,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

function buildQuery(params?: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams()
  if (!params) return ''
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const suffix = query.toString()
  return suffix ? `?${suffix}` : ''
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function downloadAdminCsv(
  path: string,
  params?: Record<string, string | number | undefined | null>,
): Promise<Blob> {
  const token = getAuthToken()
  const suffix = buildQuery(params)
  const response = await fetch(`${API_BASE}${path}${suffix}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    throw new Error('Failed to download CSV')
  }
  return response.blob()
}

export const authApi = {
  login: (body: { email: string; password: string }) =>
    apiFetch<TokenResponse>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      AUTH_TIMEOUT_MS,
    ),
  register: (body: { email: string; password: string }) =>
    apiFetch<MessageResponse>(
      '/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      AUTH_TIMEOUT_MS,
    ),
  verifyEmail: (body: { token: string }) =>
    apiFetch<MessageResponse>(
      '/auth/verify-email',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      AUTH_TIMEOUT_MS,
    ),
  resendVerification: (body: { email: string }) =>
    apiFetch<MessageResponse>(
      '/auth/resend-verification',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      AUTH_TIMEOUT_MS,
    ),
  forgotPassword: (body: { email: string }) =>
    apiFetch<MessageResponse>(
      '/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      AUTH_TIMEOUT_MS,
    ),
  resetPassword: (body: { token: string; new_password: string }) =>
    apiFetch<MessageResponse>(
      '/auth/reset-password',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      AUTH_TIMEOUT_MS,
    ),
  logout: () =>
    apiFetch<void>('/auth/logout', { method: 'POST' }, AUTH_TIMEOUT_MS),
  listSessions: () => apiFetch<AuthSessionInfo[]>('/auth/sessions'),
  revokeSession: (sessionId: number) =>
    apiFetch<void>(`/auth/sessions/${sessionId}`, { method: 'DELETE' }),
  me: () => apiFetch<AuthUser>('/auth/me', {}, AUTH_TIMEOUT_MS),
  updateProfile: (body: {
    display_name?: string | null
    email?: string
    theme?: AuthUser['theme']
    current_password?: string
  }) =>
    apiFetch<AuthUser>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  changePassword: (body: { current_password: string; new_password: string }) =>
    apiFetch<void>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadAvatar: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<AuthUser>('/auth/me/avatar', { method: 'POST', body: form })
  },
  removeAvatar: () => apiFetch<AuthUser>('/auth/me/avatar', { method: 'DELETE' }),
}

export const adminApi = {
  getMonitoring: () => apiFetch<MonitoringResponse>('/admin/monitoring'),
  listActions: () => apiFetch<ActionInfo[]>('/admin/actions'),
  listPlans: (params?: { active_only?: boolean }) => {
    const query = new URLSearchParams()
    if (params?.active_only) query.set('active_only', 'true')
    const suffix = query.toString() ? `?${query}` : ''
    return apiFetch<PlanInfo[]>(`/admin/plans${suffix}`)
  },
  createPlan: (body: {
    name: string
    description?: string
    price?: number
    actions?: string[]
    models?: string[]
    is_active?: boolean
  }) =>
    apiFetch<PlanInfo>('/admin/plans', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updatePlan: (
    planId: number,
    body: {
      name?: string
      description?: string
      price?: number
      actions?: string[]
      models?: string[]
      is_active?: boolean
    },
  ) =>
    apiFetch<PlanInfo>(`/admin/plans/${planId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deletePlan: (planId: number) =>
    apiFetch<void>(`/admin/plans/${planId}`, { method: 'DELETE' }),
  listRoles: (params?: { active_only?: boolean }) => {
    const query = new URLSearchParams()
    if (params?.active_only) query.set('active_only', 'true')
    const suffix = query.toString() ? `?${query}` : ''
    return apiFetch<RoleInfo[]>(`/admin/roles${suffix}`)
  },
  createRole: (body: {
    name: string
    description?: string
    actions?: string[]
    is_active?: boolean
  }) =>
    apiFetch<RoleInfo>('/admin/roles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateRole: (
    roleId: number,
    body: {
      name?: string
      description?: string
      actions?: string[]
      is_active?: boolean
    },
  ) =>
    apiFetch<RoleInfo>(`/admin/roles/${roleId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteRole: (roleId: number) =>
    apiFetch<void>(`/admin/roles/${roleId}`, { method: 'DELETE' }),
  getDefaultPlan: () => apiFetch<DefaultPlanInfo>('/admin/settings/default-plan'),
  setDefaultPlan: (planId: number) =>
    apiFetch<DefaultPlanInfo>('/admin/settings/default-plan', {
      method: 'PUT',
      body: JSON.stringify({ plan_id: planId }),
    }),
  listUsers: () => apiFetch<AuthUser[]>('/admin/users'),
  getUser: (userId: number) => apiFetch<AdminUserDetail>(`/admin/users/${userId}`),
  revokeUserSession: (userId: number, sessionId: number) =>
    apiFetch<void>(`/admin/users/${userId}/sessions/${sessionId}`, { method: 'DELETE' }),
  createUser: (body: {
    email: string
    password: string
    role_id?: number | null
    plan_id?: number | null
  }) =>
    apiFetch<AuthUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateUser: (
    userId: number,
    body: {
      is_active?: boolean
      role_id?: number | null
      password?: string
      plan_id?: number | null
    },
  ) =>
    apiFetch<AuthUser>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteUser: (userId: number) =>
    apiFetch<void>(`/admin/users/${userId}`, { method: 'DELETE' }),
  listProjects: (params?: { user_id?: number; pipeline_type?: string }) => {
    const query = new URLSearchParams()
    if (params?.user_id != null) query.set('user_id', String(params.user_id))
    if (params?.pipeline_type) query.set('pipeline_type', params.pipeline_type)
    const suffix = query.toString() ? `?${query}` : ''
    return apiFetch<ProjectSummary[]>(`/admin/projects${suffix}`)
  },
  getProject: (projectId: number) =>
    apiFetch<ProjectDetail>(`/admin/projects/${projectId}`),
  downloadProjectArtifact: (projectId: number, filename: string) =>
    projectArtifactUrl(projectId, filename, 'admin'),
  updateProject: (
    projectId: number,
    body: { title?: string; status?: string },
  ) =>
    apiFetch<ProjectDetail>(`/admin/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteProject: (projectId: number) =>
    apiFetch<void>(`/admin/projects/${projectId}`, { method: 'DELETE' }),
  getErrorTrackingSettings: () =>
    apiFetch<ErrorTrackingSettings>('/admin/errors/settings'),
  updateErrorTrackingSettings: (body: Partial<ErrorTrackingSettings>) =>
    apiFetch<ErrorTrackingSettings>('/admin/errors/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listErrors: (params?: {
    user_id?: number
    source?: string
    status_code?: number
    q?: string
    limit?: number
  }) =>
    apiFetch<ErrorEvent[]>(
      `/admin/errors${buildQuery({
        user_id: params?.user_id,
        source: params?.source,
        status_code: params?.status_code,
        q: params?.q,
        limit: params?.limit,
      })}`,
    ),
  downloadErrorsCsv: (params?: {
    user_id?: number
    source?: string
    status_code?: number
    q?: string
    limit?: number
  }) =>
    downloadAdminCsv('/admin/errors/export.csv', {
      user_id: params?.user_id,
      source: params?.source,
      status_code: params?.status_code,
      q: params?.q,
      limit: params?.limit,
    }),
  downloadUsersCsv: () => downloadAdminCsv('/admin/users/export.csv'),
  downloadPlansCsv: () => downloadAdminCsv('/admin/plans/export.csv'),
  downloadProjectsCsv: (params?: { user_id?: number; pipeline_type?: string }) =>
    downloadAdminCsv('/admin/projects/export.csv', {
      user_id: params?.user_id,
      pipeline_type: params?.pipeline_type,
    }),
  downloadProjectsProfilingCsv: (params?: { user_id?: number; pipeline_type?: string }) =>
    downloadAdminCsv('/admin/projects/profiling/export.csv', {
      user_id: params?.user_id,
      pipeline_type: params?.pipeline_type,
    }),
  downloadMonitoringCsv: () => downloadAdminCsv('/admin/monitoring/export.csv'),
  downloadOverviewCsv: () => downloadAdminCsv('/admin/overview/export.xlsx'),
  downloadProfileSurveyCsv: () => downloadAdminCsv('/admin/survey/responses/profile/export.csv'),
  downloadFeedbackSurveyCsv: () => downloadAdminCsv('/admin/survey/responses/feedback/export.csv'),
  getSurveySettings: () => apiFetch<SurveySettings>('/admin/survey/settings'),
  updateSurveySettings: (body: Partial<SurveySettings>) =>
    apiFetch<SurveySettings>('/admin/survey/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listSurveyResponses: () => apiFetch<SurveyResponses>('/admin/survey/responses'),
  listTutorialVideos: () => apiFetch<TutorialVideo[]>('/admin/tutorial-videos'),
  uploadTutorialVideo: (title: string, file: File) => {
    const form = new FormData()
    form.append('title', title)
    form.append('file', file)
    return apiFetch<TutorialVideo>('/admin/tutorial-videos', {
      method: 'POST',
      body: form,
    })
  },
  updateTutorialVideo: (
    videoId: number,
    body: { title?: string; sort_order?: number },
  ) =>
    apiFetch<TutorialVideo>(`/admin/tutorial-videos/${videoId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteTutorialVideo: (videoId: number) =>
    apiFetch<void>(`/admin/tutorial-videos/${videoId}`, { method: 'DELETE' }),
}

export const surveyApi = {
  status: () => apiFetch<SurveyStatus>('/survey/status', {}, AUTH_TIMEOUT_MS),
  submitProfile: (body: ProfileSurveyRequest) =>
    apiFetch<AuthUser>('/survey/profile', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  submitFeedback: (body: FeedbackSurveyRequest) =>
    apiFetch<FeedbackSurveyResponseRow>('/survey/feedback', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dismissTutorial: (action: 'remind_later' | 'dont_show_again') =>
    apiFetch<SurveyStatus>('/survey/tutorial/dismiss', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
}

export const projectsApi = {
  list: () => apiFetch<ProjectSummary[]>('/projects'),
  get: (projectId: number) => apiFetch<ProjectDetail>(`/projects/${projectId}`),
  create: (body: {
    title?: string
    pipeline_type: 'siloDesign' | 'muloDesign'
    file_name?: string
    file_type?: string
    file_content?: string
    llm_model?: string
    control_objective?: string
  }) =>
    apiFetch<ProjectDetail>('/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (
    projectId: number,
    body: {
      title?: string
      status?: string
      control_objective?: string
      file_name?: string
      file_type?: string
      file_content?: string
      job_id?: string
      results?: Record<string, unknown>
    },
  ) =>
    apiFetch<ProjectDetail>(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  downloadArtifact: (projectId: number, filename: string) =>
    projectArtifactUrl(projectId, filename, 'user'),

  simulateSilo: (
    projectId: number,
    body: { gains: Record<string, number>; scenario?: Record<string, unknown> },
  ) =>
    apiFetch<SiloSimulateResponse>(`/projects/${projectId}/silo/simulate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export const healthApi = {
  check: () => apiFetch<{ status: string }>('/health'),
  models: () => apiFetch<ModelsResponse>('/models'),
}

export const uploadApi = {
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<UploadResponse>('/upload', { method: 'POST', body: form })
  },
}

export const bugReportsApi = {
  status: () => apiFetch<BugReportSettings>('/bug-reports/status'),
  create: (body: { description: string; page_url?: string; image?: File | null }) => {
    const form = new FormData()
    form.append('description', body.description)
    if (body.page_url) form.append('page_url', body.page_url)
    if (body.image) form.append('image', body.image)
    return apiFetch<BugReport>('/bug-reports', { method: 'POST', body: form })
  },
  getSettings: () => apiFetch<BugReportSettings>('/admin/bug-reports/settings'),
  updateSettings: (body: Partial<BugReportSettings>) =>
    apiFetch<BugReportSettings>('/admin/bug-reports/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listAdmin: (params?: { status?: 'open' | 'fixed' | 'all' }) =>
    apiFetch<BugReport[]>(
      `/admin/bug-reports${buildQuery({ status: params?.status })}`,
    ),
  getAdmin: (reportId: number) => apiFetch<BugReport>(`/admin/bug-reports/${reportId}`),
  updateStatus: (reportId: number, status: 'open' | 'fixed') =>
    apiFetch<BugReport>(`/admin/bug-reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  downloadCsv: (params?: { status?: 'open' | 'fixed' | 'all' }) =>
    downloadAdminCsv('/admin/bug-reports/export.csv', {
      status: params?.status,
    }),
}

export const regularizerApi = {
  regularize: (body: {
    file_content: string
    file_name?: string
    file_type?: string
    model?: string
  }) =>
    apiFetch<RegularizeResponse>('/regularize', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  standardize: (body: {
    file_content: string
    model?: string
    silo_pipeline?: boolean
  }) =>
    apiFetch<StandardizeResponse>('/regularize/standardize', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export const recommenderApi = {
  start: (body: {
    file_content: string
    file_name: string
    model?: string
    step?: string
    user_prompt?: string
  }) =>
    apiFetch<JobResponse>('/recommender/start', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  state: (jobId: string) =>
    apiFetch<Record<string, unknown>>(`/recommender/${jobId}/state`),

  ragDecision: (jobId: string, body: { flags: string[]; model?: string }) =>
    apiFetch<JobResponse>(`/recommender/${jobId}/rag-decision`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  ragStatus: (jobId: string) =>
    apiFetch<RagStatusResponse>(`/recommender/${jobId}/rag-status`),

  handoff: (jobId: string, body: { chosen_controller?: string | null }) =>
    apiFetch<RecommenderHandoffResponse>(`/recommender/${jobId}/handoff`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export const trimmerApi = {
  start: (body: {
    file_content: string
    file_name: string
    model?: string
    trimming_params?: Record<string, unknown>
    states_inputs?: string[]
    project_id?: number | null
    recommender_job_id?: string | null
  }) =>
    apiFetch<JobResponse>('/trimmer/start', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  input: (jobId: string, body: { key: string; prompt: string; answer: string }) =>
    apiFetch<JobResponse>(`/trimmer/${jobId}/input`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  artifacts: (jobId: string) =>
    apiFetch<TrimmerArtifactsResponse>(`/trimmer/${jobId}/artifacts`),

  timeResponse: (jobId: string) =>
    apiFetch<{ filename: string; message: string }>(`/trimmer/${jobId}/time-response`, {
      method: 'POST',
    }),

  generatePdf: (jobId: string, body?: { recommender_job_id?: string | null }) =>
    apiFetch<{ filename: string; message: string }>(`/trimmer/${jobId}/pdf`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
}

export const siloApi = {
  start: (body: {
    config: Record<string, unknown>
    control_objective?: string
    project_id?: number | null
  }) =>
    apiFetch<JobResponse>('/silo/start', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  monitor: (jobId: string) =>
    apiFetch<Record<string, unknown>>(`/silo/${jobId}/monitor`),

  simulate: (
    jobId: string,
    body: { gains: Record<string, number>; scenario?: Record<string, unknown> },
  ) =>
    apiFetch<SiloSimulateResponse>(`/silo/${jobId}/simulate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export const muloApi = {
  init: (body: {
    run_config: Record<string, unknown>
    controller_structure: Record<string, unknown>[]
    system_identification: Record<string, unknown>
    trimming_result: Record<string, unknown>
    equation: string
    project_id?: number | null
    file_name?: string
    file_type?: string
  }) =>
    apiFetch<JobResponse>('/mulo/init', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  start: (body: {
    run_config: Record<string, unknown>
    controller_structure: Record<string, unknown>[]
    system_identification: Record<string, unknown>
    trimming_result: Record<string, unknown>
    equation: string
    project_id?: number | null
    file_name?: string
    file_type?: string
  }) =>
    apiFetch<JobResponse>('/mulo/start', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  configure: (
    jobId: string,
    body: { case_study: Record<string, unknown>; controller_structure: Record<string, unknown>[] },
  ) =>
    apiFetch<JobResponse>(`/mulo/${jobId}/configure`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  run: (jobId: string) =>
    apiFetch<JobResponse>(`/mulo/${jobId}/run`, {
      method: 'POST',
    }),

  continue: (
    jobId: string,
    body: { equation: string; controller_structure: Record<string, unknown>[] },
  ) =>
    apiFetch<JobResponse>(`/mulo/${jobId}/continue`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  state: (jobId: string) => apiFetch<MuloDesignerStateResponse>(`/mulo/${jobId}/state`),

  simulate: (
    jobId: string,
    body: {
      kp: number
      ki: number
      kd: number
      signal_type: string
      amplitude?: number
    },
  ) =>
    apiFetch<MuloSimulateResponse>(`/mulo/${jobId}/simulate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  scratchpad: (
    jobId: string,
    body: { modified_code: string; modified_controller_structure: Record<string, unknown>[] },
  ) =>
    apiFetch<JobResponse>(`/mulo/${jobId}/scratchpad`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  plotData: (jobId: string) =>
    apiFetch<Record<string, unknown>>(`/mulo/${jobId}/plot-data`),
}

export const jobsApi = {
  status: (jobId: string) => apiFetch<JobStatusResponse>(`/jobs/${jobId}`),
  cancel: (jobId: string) =>
    apiFetch<JobStatusResponse>(`/jobs/${jobId}/cancel`, { method: 'POST' }),
  results: (jobId: string) => apiFetch<ArtifactResponse>(`/jobs/${jobId}/results`),
  downloadArtifact: artifactUrl,
}

export const caseStudiesApi = {
  list: () => apiFetch<CaseStudiesResponse>('/case-studies'),
  mulo: (name: string) =>
    apiFetch<Record<string, unknown>>(`/case-studies/mulo/${encodeURIComponent(name)}`),
}

export const siteApi = {
  getLanding: () => apiFetch<LandingPayload>('/site/landing'),
}

export const blogApi = {
  list: () => apiFetch<BlogPostListItem[]>('/blog'),
  get: (slug: string) => apiFetch<BlogPost>(`/blog/${encodeURIComponent(slug)}`),
}

export const adminSiteApi = {
  getBrand: () => apiFetch<SiteBrand>('/admin/site/brand'),
  updateBrand: (body: SiteBrand) =>
    apiFetch<SiteBrand>('/admin/site/brand', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getLanding: () => apiFetch<Record<string, unknown>>('/admin/site/landing'),
  updateLanding: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/admin/site/landing', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  listMenus: (location?: string) =>
    apiFetch<NavMenuItem[]>(`/admin/site/menus${buildQuery({ location })}`),
  createMenu: (body: Omit<NavMenuItem, 'id'>) =>
    apiFetch<NavMenuItem>('/admin/site/menus', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateMenu: (menuId: number, body: Partial<Omit<NavMenuItem, 'id'>>) =>
    apiFetch<NavMenuItem>(`/admin/site/menus/${menuId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteMenu: (menuId: number) =>
    apiFetch<void>(`/admin/site/menus/${menuId}`, { method: 'DELETE' }),
}

export const adminMediaApi = {
  upload: (file: File, prefix = 'image') => {
    const form = new FormData()
    form.append('file', file)
    form.append('prefix', prefix)
    return apiFetch<MediaUploadResponse>('/admin/media', { method: 'POST', body: form })
  },
}

export const adminBlogApi = {
  list: () => apiFetch<BlogPostListItem[]>('/admin/blog'),
  get: (postId: number) => apiFetch<BlogPost>(`/admin/blog/${postId}`),
  create: (body: {
    title: string
    slug?: string | null
    excerpt?: string
    body_markdown?: string
    cover_image_url?: string | null
    status?: string
  }) =>
    apiFetch<BlogPost>('/admin/blog', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (
    postId: number,
    body: {
      title?: string
      slug?: string
      excerpt?: string
      body_markdown?: string
      cover_image_url?: string | null
      status?: string
    },
  ) =>
    apiFetch<BlogPost>(`/admin/blog/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  delete: (postId: number) =>
    apiFetch<void>(`/admin/blog/${postId}`, { method: 'DELETE' }),
}
