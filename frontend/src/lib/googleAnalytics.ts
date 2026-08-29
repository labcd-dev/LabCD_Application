const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() ?? ''

let initialized = false

export function isGoogleAnalyticsEnabled(): boolean {
  return MEASUREMENT_ID.length > 0
}

export function initGoogleAnalytics(): void {
  if (!isGoogleAnalyticsEnabled() || initialized) return
  initialized = true

  window.dataLayer = window.dataLayer ?? []
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args)
  }

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(script)

  window.gtag('js', new Date())
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false })
}

export function trackPageView(pagePath: string): void {
  if (!isGoogleAnalyticsEnabled() || !initialized) return

  window.gtag?.('event', 'page_view', {
    page_path: pagePath,
  })
}
