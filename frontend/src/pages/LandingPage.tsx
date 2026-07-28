import { useEffect, useState, type CSSProperties } from 'react'
import { Navigate } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { siteApi } from '../api/endpoints'
import type { LandingPayload } from '../api/types'
import { useAuth } from '../context/AuthContext'
import { FALLBACK_LANDING } from '../lib/landingDefaults'
import { LogoMark } from '../components/landing/LogoMark'
import { PendulumVisual } from '../components/landing/PendulumVisual'
import {
  BrandLogo,
  CheckMark,
  LandingLink,
  renderFooterMenu,
  renderMenu,
  WeakCheckMark,
} from '../components/landing/landingUtils'
import { useMouseGlow } from '../components/landing/useMouseGlow'
import '../components/landing/landing.css'

type SectionRecord = Record<string, unknown>

function section<T extends SectionRecord>(landing: Record<string, unknown>, key: string): T {
  return (landing[key] as T | undefined) ?? ({} as T)
}

export function LandingPage() {
  const { user, loading } = useAuth()
  const [payload, setPayload] = useState<LandingPayload>(FALLBACK_LANDING)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  useMouseGlow()

  useEffect(() => {
    document.title = payload.brand.page_title
  }, [payload.brand.page_title])

  useEffect(() => {
    siteApi
      .getLanding()
      .then(setPayload)
      .catch(() => setPayload(FALLBACK_LANDING))
  }, [])

  if (!loading && user) {
    return <Navigate to="/studio" replace />
  }

  const { brand, menus, landing } = payload
  const hero = section<SectionRecord>(landing, 'hero')
  const trust = section<{ title?: string; cards?: { emoji: string; title: string }[] }>(landing, 'trust')
  const features = section<{ title?: string; subtitle?: string; items?: { title: string; description: string }[] }>(
    landing,
    'features',
  )
  const workflow = section<{ title?: string; subtitle?: string; steps?: { title: string; description: string }[] }>(
    landing,
    'workflow',
  )
  const diff = section<{
    title?: string
    subtitle?: string
    labcd_column?: string
    traditional_column?: string
    rows?: { feature: string; labcd: boolean; traditional: boolean }[]
  }>(landing, 'differentiation')
  const demo = section<{ title?: string; subtitle?: string; video_url?: string; caption?: string }>(landing, 'demo')
  const testimonials = section<{
    title?: string
    subtitle?: string
    items?: { quote: string; author: string; role: string; rating: number }[]
  }>(landing, 'testimonials')
  const finalCta = section<SectionRecord>(landing, 'final_cta')
  const footer = section<{
    description?: string
    copyright?: string
    column_titles?: Record<string, string>
  }>(landing, 'footer')

  const style = {
    '--brand-primary': brand.primary_color,
    '--brand-secondary': brand.secondary_color,
  } as CSSProperties

  return (
    <div className="landing-root bg-white text-white" style={style}>
      <div
        id="mouse-glow"
        className="pointer-events-none fixed left-0 top-0 z-[60] hidden h-72 w-72 rounded-full blur-3xl mix-blend-screen md:block"
        style={{ backgroundColor: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)' }}
      />
      <div
        id="mouse-dot"
        className="pointer-events-none fixed left-0 top-0 z-[61] hidden h-2 w-2 rounded-full shadow-[0_0_18px_rgba(34,211,238,0.55)] md:block"
        style={{ backgroundColor: 'color-mix(in srgb, var(--brand-primary) 70%, transparent)' }}
      />

      <header className="sticky top-0 z-50 relative w-full overflow-hidden border-b border-white/[0.07] bg-[#030716]">
        <nav className="relative z-10 mx-auto flex min-h-[76px] max-w-[1280px] items-center justify-between px-6 max-lg:px-5 max-md:min-h-[66px]">
          <LandingLink href="/" className="flex shrink-0 items-center gap-3 text-white no-underline">
            {brand.logo_url ? <BrandLogo brand={brand} /> : <LogoMark />}
            <span className="text-[24px] font-extrabold tracking-[-0.6px] text-white max-md:text-xl">
              {brand.brand_name}
              <p className="text-sm font-medium max-md:hidden" style={{ color: 'color-mix(in srgb, var(--brand-primary) 80%, white)' }}>
                {brand.tagline}
              </p>
            </span>
          </LandingLink>
          <ul className="mx-auto flex items-center gap-8 px-8 max-lg:gap-5 max-lg:px-5 max-md:hidden">
            {renderMenu(menus.header)}
          </ul>
          <div className="flex shrink-0 items-center gap-5 max-md:hidden">
            <LandingLink href={brand.sign_in_url} external className="text-[15px] font-medium text-white/65 transition hover:text-white">
              Sign In
            </LandingLink>
            <LandingLink
              href={brand.access_platform_url}
              external
              className="inline-flex h-11 items-center justify-center whitespace-nowrap rounded-lg px-5 text-[15px] font-bold text-slate-950 shadow-[0_10px_24px_rgba(38,103,255,0.18)] transition duration-300 hover:-translate-y-0.5 landing-brand-gradient"
            >
              Access Platform
            </LandingLink>
          </div>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-lg border border-white/15 text-white transition hover:bg-white/10 md:hidden"
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </nav>
        {mobileNavOpen && (
          <div
            className="border-t border-white/10 bg-[#030716] px-5 py-4 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          >
            <ul className="m-0 flex list-none flex-col gap-1 p-0 [&>li>a]:block [&>li>a]:rounded-lg [&>li>a]:px-3 [&>li>a]:py-3">
              {renderMenu(menus.header)}
            </ul>
            <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4">
              <LandingLink
                href={brand.sign_in_url}
                external
                className="rounded-lg px-3 py-3 text-center text-[15px] font-medium text-white/75 transition hover:text-white"
              >
                Sign In
              </LandingLink>
              <LandingLink
                href={brand.access_platform_url}
                external
                className="inline-flex h-11 items-center justify-center rounded-lg px-5 text-[15px] font-bold text-slate-950 landing-brand-gradient"
              >
                Access Platform
              </LandingLink>
            </div>
          </div>
        )}
      </header>

      <section className="relative overflow-hidden bg-[#07101f] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:36px_36px]">
        <div className="relative z-10 mx-auto flex max-w-[1440px] flex-col items-center px-6 pb-20 pt-16 text-center sm:px-8 md:pt-20 lg:px-10">
          <div
            className="mb-8 inline-flex items-center gap-2 rounded-full border px-5 py-2 text-sm font-semibold shadow-[0_0_30px_rgba(34,211,238,0.18)]"
            style={{
              borderColor: 'color-mix(in srgb, var(--brand-primary) 20%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)',
              color: 'color-mix(in srgb, var(--brand-primary) 80%, white)',
            }}
          >
            <span>{String(hero.label_emoji ?? '🚀')}</span>
            <span>{String(hero.label ?? '')}</span>
          </div>
          <h1 className="max-w-5xl text-4xl font-extrabold leading-tight tracking-[-0.03em] text-white sm:text-5xl md:text-6xl lg:text-[72px]">
            {String(hero.heading_before ?? '')}{' '}
            <span className="landing-brand-text">{String(hero.heading_highlight_1 ?? '')}</span>
            <br />
            <span className="landing-brand-text-secondary">{String(hero.heading_highlight_2 ?? '')}</span>
          </h1>
          <p className="mt-8 max-w-4xl text-lg leading-8 text-white/75 sm:text-xl md:text-[22px]">
            {String(hero.description ?? '')}
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <LandingLink
              href={String(hero.primary_cta_url ?? brand.access_platform_url)}
              external={String(hero.primary_cta_url ?? '').startsWith('http')}
              className="inline-flex min-h-[56px] items-center justify-center rounded-xl px-8 text-base font-bold text-slate-950 shadow-[0_18px_45px_rgba(37,99,235,0.35)] transition hover:-translate-y-0.5 landing-brand-gradient"
            >
              {String(hero.primary_cta_label ?? 'Try Now')} <span className="ml-2 text-lg">→</span>
            </LandingLink>
            <LandingLink
              href={String(hero.secondary_cta_url ?? '#demo')}
              external={String(hero.secondary_cta_url ?? '').startsWith('http')}
              className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-8 text-base font-semibold backdrop-blur-sm transition hover:bg-white/10 landing-brand-text"
            >
              {String(hero.secondary_cta_label ?? 'Watch Demo')}
            </LandingLink>
          </div>
          <PendulumVisual caption={String(hero.visual_caption ?? '')} />
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#070d1b] px-6 py-20 sm:px-8 lg:px-10">
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <div className="mb-12 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-white/55 sm:text-base md:text-lg">
              {trust.title}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {(trust.cards ?? []).map((card) => (
              <div
                key={card.title}
                className="group flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-white/5 bg-white/[0.045] px-6 py-7 transition hover:-translate-y-1 hover:bg-white/[0.07]"
              >
                <div className="mb-4 text-4xl transition group-hover:scale-110">{card.emoji}</div>
                <h3 className="text-lg font-medium text-white/65 sm:text-xl">{card.title}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="relative overflow-hidden bg-[#050b18] px-6 py-24 sm:px-8 lg:px-10">
        <div className="relative z-10 mx-auto max-w-[1200px]">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <h2 className="text-4xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl lg:text-[54px]">
              {features.title}
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/60 sm:text-xl">{features.subtitle}</p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {(features.items ?? []).map((item) => (
              <article
                key={item.title}
                className="group relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.045] p-7 transition duration-300 hover:-translate-y-1 hover:bg-white/[0.07]"
              >
                <h3 className="text-xl font-bold text-white">{item.title}</h3>
                <p className="mt-4 text-base leading-7 text-white/58">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="relative overflow-hidden bg-[#050b18] px-6 py-24 sm:px-8 lg:px-10">
        <div className="relative z-10 mx-auto max-w-[900px]">
          <div className="mx-auto mb-16 max-w-3xl text-center">
            <h2 className="text-4xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl lg:text-[54px]">
              {workflow.title}
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/60 sm:text-xl">{workflow.subtitle}</p>
          </div>
          <div className="relative rounded-2xl border border-white/5 bg-white/[0.04] p-7 sm:p-8 lg:p-10">
            {(workflow.steps ?? []).map((step, index) => (
              <div key={step.title} className={`relative flex gap-6 ${index < (workflow.steps?.length ?? 0) - 1 ? 'pb-14' : ''}`}>
                {index < (workflow.steps?.length ?? 0) - 1 && (
                  <div className="absolute left-6 top-14 h-[calc(100%-3.5rem)] w-px bg-[color-mix(in_srgb,var(--brand-primary)_25%,transparent)]" />
                )}
                <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[#06111f] landing-brand-gradient">
                  {index + 1}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white sm:text-2xl">{step.title}</h3>
                  <p className="mt-3 text-base leading-7 text-white/58">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="differentiation" className="relative overflow-hidden bg-[#050b18] px-6 py-24 sm:px-8 lg:px-10">
        <div className="relative z-10 mx-auto max-w-[1120px]">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <h2 className="text-4xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl lg:text-[54px]">
              {diff.title}
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/55 sm:text-xl">{diff.subtitle}</p>
          </div>
          <div className="hidden overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.035] md:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-white/8 bg-white/[0.025]">
                  <th className="w-[50%] px-7 py-5 text-sm font-bold text-white/85">Feature</th>
                  <th className="w-[25%] px-7 py-5 text-center text-sm font-bold landing-brand-text">
                    {diff.labcd_column ?? 'LabCD'}
                  </th>
                  <th className="w-[25%] px-7 py-5 text-center text-sm font-bold text-white/65">
                    {diff.traditional_column ?? 'Traditional Approach'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {(diff.rows ?? []).map((row) => (
                  <tr key={row.feature} className="transition hover:bg-white/[0.025]">
                    <td className="px-7 py-5 text-base font-semibold text-white/80">{row.feature}</td>
                    <td className="px-7 py-5 text-center">
                      <CheckMark value={row.labcd} />
                    </td>
                    <td className="px-7 py-5 text-center">
                      <WeakCheckMark value={row.traditional} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="demo" className="relative overflow-hidden bg-[#050b18] px-6 py-24 sm:px-8 lg:px-10">
        <div className="relative z-10 mx-auto max-w-[980px]">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <h2 className="text-4xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl lg:text-[54px]">
              {demo.title}
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/55 sm:text-xl">{demo.subtitle}</p>
          </div>
          <div className="relative mx-auto overflow-hidden rounded-3xl border border-white/10 bg-[#111c2c]/90 p-4 sm:p-6">
            <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-[#101a2a]">
              {demo.video_url ? (
                <iframe
                  title="Demo video"
                  src={demo.video_url}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full landing-brand-gradient text-[#06111f]">
                    ▶
                  </div>
                </div>
              )}
            </div>
            <p className="mt-6 text-center text-sm font-medium text-white/45 sm:text-base">{demo.caption}</p>
          </div>
        </div>
      </section>

      <section id="testimonials" className="relative overflow-hidden bg-[#050b18] px-6 py-24 sm:px-8 lg:px-10">
        <div className="relative z-10 mx-auto max-w-[1120px]">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <h2 className="text-4xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl lg:text-[54px]">
              {testimonials.title}
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/55 sm:text-xl">{testimonials.subtitle}</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {(testimonials.items ?? []).map((item) => (
              <article key={item.author} className="rounded-2xl border border-white/10 bg-white/[0.035] p-7">
                <div className="mb-6 flex items-center gap-1 landing-brand-text">
                  {Array.from({ length: item.rating ?? 5 }).map((_, i) => (
                    <span key={i}>★</span>
                  ))}
                </div>
                <blockquote className="text-base font-medium italic leading-7 text-white/78">"{item.quote}"</blockquote>
                <div className="mt-10">
                  <h3 className="text-base font-bold text-white">{item.author}</h3>
                  <p className="mt-1 text-sm leading-6 text-white/50">{item.role}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="final-cta" className="relative overflow-hidden bg-[#050b18] px-6 py-24 sm:px-8 lg:px-10">
        <div className="relative z-10 mx-auto max-w-[1120px] text-center">
          <h2 className="mx-auto max-w-4xl text-4xl font-extrabold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl lg:text-[58px]">
            {String(finalCta.heading ?? '')}
            <span className="block">{String(finalCta.heading_line2 ?? '')}</span>
          </h2>
          <p className="mx-auto mt-7 max-w-3xl text-lg font-medium leading-8 text-white/70 sm:text-xl">
            {String(finalCta.subtitle ?? '')}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <LandingLink
              href={String(finalCta.primary_cta_url ?? '/login')}
              className="inline-flex h-14 w-full items-center justify-center rounded-lg px-10 text-base font-extrabold text-[#06111f] sm:w-auto landing-brand-gradient"
            >
              {String(finalCta.primary_cta_label ?? 'Get Started Free')}
            </LandingLink>
            <LandingLink
              href={String(finalCta.secondary_cta_url ?? '#demo')}
              className="inline-flex h-14 w-full items-center justify-center rounded-lg border border-white/10 px-10 text-base font-extrabold landing-brand-text sm:w-auto"
            >
              {String(finalCta.secondary_cta_label ?? 'Schedule Demo')}
            </LandingLink>
          </div>
          <p className="mt-8 text-sm font-medium text-white/38 sm:text-base">
            {String(finalCta.helper_text ?? '')}
          </p>
        </div>
      </section>

      <footer className="relative overflow-hidden border-t border-white/[0.06] bg-[#030817] px-6 py-16 sm:px-8 lg:px-10">
        <div className="relative z-10 mx-auto max-w-[1280px]">
          <div className="grid gap-12 border-b border-white/[0.06] pb-14 sm:grid-cols-2 lg:grid-cols-5 lg:gap-10">
            <div className="lg:col-span-1">
              <LandingLink href="/" className="inline-flex items-center gap-4">
                {brand.logo_url ? <BrandLogo brand={brand} /> : <LogoMark />}
                <div>
                  <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-white">{brand.brand_name}</h2>
                  <p className="text-sm font-medium" style={{ color: 'color-mix(in srgb, var(--brand-primary) 80%, white)' }}>
                    {brand.tagline}
                  </p>
                </div>
              </LandingLink>
              <p className="mt-5 max-w-[280px] text-base font-medium leading-7 text-white/55">{footer.description}</p>
            </div>
            {(['product', 'resources', 'company', 'legal'] as const).map((key) => (
              <div key={key}>
                <h3 className="text-base font-extrabold text-white">
                  {footer.column_titles?.[key] ?? key}
                </h3>
                <ul className="mt-6 space-y-4">
                  {renderFooterMenu(menus[`footer_${key}` as keyof typeof menus])}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-6 pt-9 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base font-medium text-white/50">{footer.copyright}</p>
            <div className="flex items-center gap-6">{renderFooterMenu(menus.footer_social)}</div>
          </div>
        </div>
      </footer>
    </div>
  )
}
