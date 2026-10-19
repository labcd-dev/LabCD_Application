import { ApiError } from '../api/client'

export const CREDITS_USED_UP_EVENT = 'labcd:credits-used-up'

export type CreditsUsedUpDetail = {
  message?: string | null
}

/** True when the API hard-gated a credit-consuming action (HTTP 402). */
export function isInsufficientCreditsError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 402
}

/**
 * Message for inline error banners. Returns null for credit exhaustion so the
 * global CreditsUsedUpModal can own that UX without a duplicate banner.
 */
export function formatCaughtError(err: unknown, fallback: string): string | null {
  if (isInsufficientCreditsError(err)) return null
  return err instanceof Error ? err.message : fallback
}

/** Open the credits-used-up modal from any UI (chip, proactive checks, etc.). */
export function notifyCreditsUsedUp(message?: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<CreditsUsedUpDetail>(CREDITS_USED_UP_EVENT, {
      detail: { message: message ?? null },
    }),
  )
}
