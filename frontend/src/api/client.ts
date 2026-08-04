const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
const TOKEN_KEY = 'labcd_access_token'
/**
 * Fail before nginx's hour-long SSE proxy timeout.
 * Auth uses a shorter timeout via AUTH_TIMEOUT_MS.
 */
export const DEFAULT_TIMEOUT_MS = 120_000
export const AUTH_TIMEOUT_MS = 30_000

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
    const detail = body.detail ?? body.message ?? response.statusText
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail
        .map((item: { msg?: string }) => item?.msg)
        .filter(Boolean)
        .join('; ') || response.statusText
    }
    return response.statusText
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
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const token = getAuthToken()
  const method = (options.method ?? 'GET').toUpperCase()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch (err) {
    const aborted =
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && err.name === 'AbortError')
    if (aborted) {
      const message = 'Request timed out. Please try again.'
      reportApiFailure(path, method, 408, message)
      throw new ApiError(408, message)
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }

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
