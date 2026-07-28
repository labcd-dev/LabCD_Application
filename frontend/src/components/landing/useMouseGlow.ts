import { useEffect } from 'react'

export function useMouseGlow() {
  useEffect(() => {
    const mouseGlow = document.getElementById('mouse-glow')
    const mouseDot = document.getElementById('mouse-dot')
    if (!mouseGlow || !mouseDot) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    let mouseX = window.innerWidth / 2
    let mouseY = window.innerHeight / 2
    let glowX = mouseX
    let glowY = mouseY
    let dotX = mouseX
    let dotY = mouseY
    let frame = 0

    const placeAt = (el: HTMLElement, x: number, y: number) => {
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
    }

    placeAt(mouseGlow, glowX, glowY)
    placeAt(mouseDot, dotX, dotY)

    const onMove = (event: MouseEvent) => {
      mouseX = event.clientX
      mouseY = event.clientY
    }

    const animate = () => {
      glowX += (mouseX - glowX) * 0.08
      glowY += (mouseY - glowY) * 0.08
      dotX += (mouseX - dotX) * 0.28
      dotY += (mouseY - dotY) * 0.28
      placeAt(mouseGlow, glowX, glowY)
      placeAt(mouseDot, dotX, dotY)
      frame = requestAnimationFrame(animate)
    }

    window.addEventListener('mousemove', onMove)
    frame = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [])
}
