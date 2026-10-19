import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { CreditsUsedUpModal } from '../components/CreditsUsedUpModal'
import { creditsApi } from '../api/endpoints'
import {
  CREDITS_USED_UP_EVENT,
  notifyCreditsUsedUp,
  type CreditsUsedUpDetail,
} from '../lib/creditsGate'

interface CreditsGateContextValue {
  openCreditsUsedUp: (message?: string | null) => void
}

const CreditsGateContext = createContext<CreditsGateContextValue | null>(null)

export function CreditsGateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [resetAt, setResetAt] = useState<string | null>(null)

  const show = useCallback((detailMessage?: string | null) => {
    setMessage(detailMessage ?? null)
    setResetAt(null)
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    const onEvent = (event: Event) => {
      const custom = event as CustomEvent<CreditsUsedUpDetail>
      show(custom.detail?.message)
    }
    window.addEventListener(CREDITS_USED_UP_EVENT, onEvent)
    return () => window.removeEventListener(CREDITS_USED_UP_EVENT, onEvent)
  }, [show])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void creditsApi
      .getDashboard()
      .then((data) => {
        if (cancelled) return
        setResetAt(data.daily_reset_at || null)
        setMessage((prev) => prev || data.used_up_message || null)
      })
      .catch(() => {
        /* modal still works from the 402 message alone */
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const value = useMemo(
    () => ({
      openCreditsUsedUp: (detailMessage?: string | null) => {
        notifyCreditsUsedUp(detailMessage)
      },
    }),
    [],
  )

  return (
    <CreditsGateContext.Provider value={value}>
      {children}
      <CreditsUsedUpModal
        open={open}
        message={message}
        resetAt={resetAt}
        onClose={close}
      />
    </CreditsGateContext.Provider>
  )
}

export function useCreditsGate(): CreditsGateContextValue {
  const ctx = useContext(CreditsGateContext)
  if (!ctx) {
    return {
      openCreditsUsedUp: notifyCreditsUsedUp,
    }
  }
  return ctx
}
