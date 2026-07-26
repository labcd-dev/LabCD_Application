const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
const TOKEN_KEY = 'labcd_access_token'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return body.detail ?? body.message ?? response.statusText
  } catch {
    return response.statusText
  }
}

function reportApiFailure(path: string, method: string, status: number, message: string): void {
  if (path.startsWith('/errors')) return
  // Lazy import avoids circular dependency with errorTracking → client.
  void import('../lib/errorTracking').then(({ reportFrontendError, shouldReportFrontendErrors }) => {
    if (!shouldReportFrontendErrors()) return
    reportFrontendError({
      message: `API ${status}: ${message}`,
      path,
      method,
      status_code: status,
      page_url: window.location.href,
      extra: { type: 'api_client' },
    })
  })
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken()
  const method = (options.method ?? 'GET').toUpperCase()
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (response.status === 401 && !path.startsWith('/auth/')) {
    clearAuthToken()
  }

  if (!response.ok) {
    const message = await parseError(response)
    reportApiFailure(path, method, response.status, message)
    throw new ApiError(response.status, message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as T
}

export function artifactUrl(jobId: string, filename: string): string {
  const token = getAuthToken()
  const base = `${API_BASE}/jobs/${jobId}/artifacts/${encodeURIComponent(filename)}`
  return token ? `${base}?access_token=${encodeURIComponent(token)}` : base
}

export function projectArtifactUrl(
  projectId: number,
  filename: string,
  scope: 'user' | 'admin' = 'user',
): string {
  const token = getAuthToken()
  const prefix = scope === 'admin' ? `/admin/projects` : `/projects`
  const base = `${API_BASE}${prefix}/${projectId}/artifacts/${encodeURIComponent(filename)}`
  return token ? `${base}?access_token=${encodeURIComponent(token)}` : base
}

export function streamUrl(module: string, jobId: string): string {
  const token = getAuthToken()
  const base = `${API_BASE}/${module}/${jobId}/stream`
  return token ? `${base}?access_token=${encodeURIComponent(token)}` : base
}
