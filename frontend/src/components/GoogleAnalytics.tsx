import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { initGoogleAnalytics, trackPageView } from '../lib/googleAnalytics'

export function GoogleAnalytics() {
  const location = useLocation()

  useEffect(() => {
    initGoogleAnalytics()
  }, [])

  useEffect(() => {
    trackPageView(`${location.pathname}${location.search}`)
  }, [location.pathname, location.search])

  return null
}
