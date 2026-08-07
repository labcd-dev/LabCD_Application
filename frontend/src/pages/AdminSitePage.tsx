import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminSiteApi } from '../api/endpoints'
import type { NavMenuItem, SiteBrand } from '../api/types'
import { ImageUploadField } from '../components/ImageUploadField'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import {
  btnBase,
  btnPrimary,
  cardPanel,
  fieldInput,
  fieldLabel,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

const MENU_LOCATIONS = [
  { value: 'header', label: 'Header' },
  { value: 'footer_product', label: 'Footer — Product' },
  { value: 'footer_resources', label: 'Footer — Resources' },
  { value: 'footer_company', label: 'Footer — Company' },
  { value: 'footer_legal', label: 'Footer — Legal' },
  { value: 'footer_social', label: 'Footer — Social' },
] as const

type Tab = 'brand' | 'menus' | 'landing'

function TextField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
}) {
  return (
    <div>
      <label className={fieldLabel}>{label}</label>
      {multiline ? (
        <textarea className={`${fieldInput} min-h-24`} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={fieldInput} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

function toHexColor(value: string, fallback = '#000000'): string {
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return fallback
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const pickerValue = toHexColor(value)

  return (
    <div>
      <label className={fieldLabel}>{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-border-input bg-surface-elevated p-1 shadow-sm"
          aria-label={`${label} picker`}
        />
        <input
          className={fieldInput}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

export function AdminSitePage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:site')
  const [tab, setTab] = useState<Tab>('brand')
  const [brand, setBrand] = useState<SiteBrand | null>(null)
  const [landing, setLanding] = useState<Record<string, unknown>>({})
  const [menus, setMenus] = useState<NavMenuItem[]>([])
  const [menuLocation, setMenuLocation] = useState<string>('header')
  const [newMenu, setNewMenu] = useState({ label: '', href: '', is_external: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextBrand, nextLanding, nextMenus] = await Promise.all([
        adminSiteApi.getBrand(),
        adminSiteApi.getLanding(),
        adminSiteApi.listMenus(),
      ])
      setBrand(nextBrand)
      setLanding(nextLanding)
      setMenus(nextMenus)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load site settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  const filteredMenus = menus.filter((m) => m.location === menuLocation)
  const menuPagination = useClientPagination(filteredMenus, { resetKey: menuLocation })

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const saveBrand = async (event: FormEvent) => {
    event.preventDefault()
    if (!brand) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      setBrand(await adminSiteApi.updateBrand(brand))
      setMessage('Branding saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save branding')
    } finally {
      setSaving(false)
    }
  }

  const saveLanding = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      setLanding(await adminSiteApi.updateLanding(landing))
      setMessage('Landing content saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save landing content')
    } finally {
      setSaving(false)
    }
  }

  const addMenu = async (event: FormEvent) => {
    event.preventDefault()
    if (!newMenu.label.trim() || !newMenu.href.trim()) return
    setSaving(true)
    setError(null)
    try {
      await adminSiteApi.createMenu({
        location: menuLocation,
        label: newMenu.label.trim(),
        href: newMenu.href.trim(),
        sort_order: menus.filter((m) => m.location === menuLocation).length,
        is_external: newMenu.is_external,
      })
      setNewMenu({ label: '', href: '', is_external: false })
      setMenus(await adminSiteApi.listMenus())
      setMessage('Menu item added.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add menu item')
    } finally {
      setSaving(false)
    }
  }

  const updateMenuItem = async (item: NavMenuItem, patch: Partial<NavMenuItem>) => {
    setSaving(true)
    setError(null)
    try {
      await adminSiteApi.updateMenu(item.id, patch)
      setMenus(await adminSiteApi.listMenus())
      setMessage('Menu item updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update menu item')
    } finally {
      setSaving(false)
    }
  }

  const deleteMenuItem = async (itemId: number) => {
    if (!window.confirm('Delete this menu item?')) return
    setSaving(true)
    setError(null)
    try {
      await adminSiteApi.deleteMenu(itemId)
      setMenus(await adminSiteApi.listMenus())
      setMessage('Menu item deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete menu item')
    } finally {
      setSaving(false)
    }
  }

  const patchSection = (key: string, patch: Record<string, unknown>) => {
    setLanding((prev) => ({
      ...prev,
      [key]: { ...(prev[key] as Record<string, unknown> | undefined), ...patch },
    }))
  }

  const hero = (landing.hero as Record<string, string> | undefined) ?? {}
  const trust = (landing.trust as { title?: string; cards?: { emoji: string; title: string }[] } | undefined) ?? {}
  const features = (landing.features as { title?: string; subtitle?: string; items?: { title: string; description: string }[] } | undefined) ?? {}
  const demo = (landing.demo as Record<string, string> | undefined) ?? {}
  const finalCta = (landing.final_cta as Record<string, string> | undefined) ?? {}
  const footer = (landing.footer as { description?: string; copyright?: string } | undefined) ?? {}

  return (
    <section className={pageSection}>
      <header className="mb-6">
        <h1 className={pageTitle}>Site CMS</h1>
        <p className={pageIntro}>Manage landing page branding, navigation menus, and section content.</p>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {(['brand', 'menus', 'landing'] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`${btnBase} ${tab === item ? 'bg-[color-mix(in_srgb,var(--app-primary)_14%,transparent)] text-primary' : ''}`}
            onClick={() => setTab(item)}
          >
            {item === 'brand' ? 'Branding' : item === 'menus' ? 'Menus' : 'Landing content'}
          </button>
        ))}
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      {loading || !brand ? (
        <p className="text-muted-text">Loading…</p>
      ) : tab === 'brand' ? (
        <form onSubmit={saveBrand} className={`${cardPanel} w-full space-y-4`}>
          <TextField label="Brand name" value={brand.brand_name} onChange={(v) => setBrand({ ...brand, brand_name: v })} />
          <TextField label="Tagline" value={brand.tagline} onChange={(v) => setBrand({ ...brand, tagline: v })} />
          <TextField label="Page title" value={brand.page_title} onChange={(v) => setBrand({ ...brand, page_title: v })} />
          <ImageUploadField
            label="Logo"
            value={brand.logo_url}
            onChange={(url) => setBrand({ ...brand, logo_url: url })}
            prefix="logo"
            previewClassName="h-16 w-auto max-w-[220px] object-contain"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Primary color" value={brand.primary_color} onChange={(v) => setBrand({ ...brand, primary_color: v })} />
            <ColorField label="Secondary color" value={brand.secondary_color} onChange={(v) => setBrand({ ...brand, secondary_color: v })} />
          </div>
          <TextField label="Sign in URL" value={brand.sign_in_url} onChange={(v) => setBrand({ ...brand, sign_in_url: v })} />
          <TextField label="Access platform URL" value={brand.access_platform_url} onChange={(v) => setBrand({ ...brand, access_platform_url: v })} />
          <button type="submit" className={`${btnPrimary} ${btnBase}`} disabled={saving}>
            {saving ? 'Saving…' : 'Save branding'}
          </button>
        </form>
      ) : tab === 'menus' ? (
        <div className="space-y-6">
          <div className={`${cardPanel} space-y-4`}>
            <label className={fieldLabel} htmlFor="menu-location">
              Menu location
            </label>
            <select id="menu-location" className={fieldInput} value={menuLocation} onChange={(e) => setMenuLocation(e.target.value)}>
              {MENU_LOCATIONS.map((loc) => (
                <option key={loc.value} value={loc.value}>
                  {loc.label}
                </option>
              ))}
            </select>
            <form onSubmit={addMenu} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
              <input className={fieldInput} placeholder="Label" value={newMenu.label} onChange={(e) => setNewMenu({ ...newMenu, label: e.target.value })} />
              <input className={fieldInput} placeholder="Href" value={newMenu.href} onChange={(e) => setNewMenu({ ...newMenu, href: e.target.value })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newMenu.is_external} onChange={(e) => setNewMenu({ ...newMenu, is_external: e.target.checked })} />
                External
              </label>
              <button type="submit" className={`${btnPrimary} ${btnBase}`} disabled={saving}>
                Add
              </button>
            </form>
          </div>
          <div className={`${cardPanel} space-y-3`}>
            {menuPagination.pageItems.map((item) => (
              <div key={item.id} className="grid gap-2 rounded-lg border border-border-subtle p-3 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
                <input className={fieldInput} value={item.label} onChange={(e) => void updateMenuItem(item, { label: e.target.value })} />
                <input className={fieldInput} value={item.href} onChange={(e) => void updateMenuItem(item, { href: e.target.value })} />
                <input className={fieldInput} type="number" value={item.sort_order} onChange={(e) => void updateMenuItem(item, { sort_order: Number(e.target.value) })} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={item.is_external} onChange={(e) => void updateMenuItem(item, { is_external: e.target.checked })} />
                  External
                </label>
                <button type="button" className={btnBase} onClick={() => void deleteMenuItem(item.id)}>
                  Delete
                </button>
              </div>
            ))}
            {filteredMenus.length === 0 && <p className="text-muted-text">No items in this menu.</p>}
            <AdminPagination
              page={menuPagination.page}
              totalPages={menuPagination.totalPages}
              total={menuPagination.total}
              from={menuPagination.from}
              to={menuPagination.to}
              onPageChange={menuPagination.setPage}
            />
          </div>
        </div>
      ) : (
        <form onSubmit={saveLanding} className="space-y-6">
          <div className={`${cardPanel} space-y-4`}>
            <h2 className="text-lg font-semibold">Hero</h2>
            <TextField label="Label" value={hero.label ?? ''} onChange={(v) => patchSection('hero', { label: v })} />
            <TextField label="Label emoji" value={hero.label_emoji ?? ''} onChange={(v) => patchSection('hero', { label_emoji: v })} />
            <TextField label="Heading (before highlight)" value={hero.heading_before ?? ''} onChange={(v) => patchSection('hero', { heading_before: v })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Highlight 1" value={hero.heading_highlight_1 ?? ''} onChange={(v) => patchSection('hero', { heading_highlight_1: v })} />
              <TextField label="Highlight 2" value={hero.heading_highlight_2 ?? ''} onChange={(v) => patchSection('hero', { heading_highlight_2: v })} />
            </div>
            <TextField label="Description" value={hero.description ?? ''} onChange={(v) => patchSection('hero', { description: v })} multiline />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Primary CTA label" value={hero.primary_cta_label ?? ''} onChange={(v) => patchSection('hero', { primary_cta_label: v })} />
              <TextField label="Primary CTA URL" value={hero.primary_cta_url ?? ''} onChange={(v) => patchSection('hero', { primary_cta_url: v })} />
              <TextField label="Secondary CTA label" value={hero.secondary_cta_label ?? ''} onChange={(v) => patchSection('hero', { secondary_cta_label: v })} />
              <TextField label="Secondary CTA URL" value={hero.secondary_cta_url ?? ''} onChange={(v) => patchSection('hero', { secondary_cta_url: v })} />
            </div>
            <TextField label="Visual caption" value={hero.visual_caption ?? ''} onChange={(v) => patchSection('hero', { visual_caption: v })} />
          </div>

          <div className={`${cardPanel} space-y-4`}>
            <h2 className="text-lg font-semibold">Trust bar</h2>
            <TextField label="Section title" value={trust.title ?? ''} onChange={(v) => patchSection('trust', { title: v })} />
            {(trust.cards ?? []).map((card, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-2">
                <TextField
                  label={`Card ${index + 1} emoji`}
                  value={card.emoji}
                  onChange={(v) => {
                    const cards = [...(trust.cards ?? [])]
                    cards[index] = { ...cards[index], emoji: v }
                    patchSection('trust', { cards })
                  }}
                />
                <TextField
                  label={`Card ${index + 1} title`}
                  value={card.title}
                  onChange={(v) => {
                    const cards = [...(trust.cards ?? [])]
                    cards[index] = { ...cards[index], title: v }
                    patchSection('trust', { cards })
                  }}
                />
              </div>
            ))}
          </div>

          <div className={`${cardPanel} space-y-4`}>
            <h2 className="text-lg font-semibold">Features</h2>
            <TextField label="Title" value={features.title ?? ''} onChange={(v) => patchSection('features', { title: v })} />
            <TextField label="Subtitle" value={features.subtitle ?? ''} onChange={(v) => patchSection('features', { subtitle: v })} multiline />
            {(features.items ?? []).map((item, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-border-subtle p-3">
                <TextField
                  label={`Feature ${index + 1} title`}
                  value={item.title}
                  onChange={(v) => {
                    const items = [...(features.items ?? [])]
                    items[index] = { ...items[index], title: v }
                    patchSection('features', { items })
                  }}
                />
                <TextField
                  label={`Feature ${index + 1} description`}
                  value={item.description}
                  onChange={(v) => {
                    const items = [...(features.items ?? [])]
                    items[index] = { ...items[index], description: v }
                    patchSection('features', { items })
                  }}
                  multiline
                />
              </div>
            ))}
          </div>

          <div className={`${cardPanel} space-y-4`}>
            <h2 className="text-lg font-semibold">Workflow</h2>
            {(() => {
              const workflow = (landing.workflow as { title?: string; subtitle?: string; steps?: { title: string; description: string }[] } | undefined) ?? {}
              return (
                <>
                  <TextField label="Title" value={workflow.title ?? ''} onChange={(v) => patchSection('workflow', { title: v })} />
                  <TextField label="Subtitle" value={workflow.subtitle ?? ''} onChange={(v) => patchSection('workflow', { subtitle: v })} multiline />
                  {(workflow.steps ?? []).map((step, index) => (
                    <div key={index} className="space-y-2 rounded-lg border border-border-subtle p-3">
                      <TextField
                        label={`Step ${index + 1} title`}
                        value={step.title}
                        onChange={(v) => {
                          const steps = [...(workflow.steps ?? [])]
                          steps[index] = { ...steps[index], title: v }
                          patchSection('workflow', { steps })
                        }}
                      />
                      <TextField
                        label={`Step ${index + 1} description`}
                        value={step.description}
                        onChange={(v) => {
                          const steps = [...(workflow.steps ?? [])]
                          steps[index] = { ...steps[index], description: v }
                          patchSection('workflow', { steps })
                        }}
                        multiline
                      />
                    </div>
                  ))}
                </>
              )
            })()}
          </div>

          <div className={`${cardPanel} space-y-4`}>
            <h2 className="text-lg font-semibold">Why LabCD comparison</h2>
            {(() => {
              const diff = (landing.differentiation as {
                title?: string
                subtitle?: string
                labcd_column?: string
                traditional_column?: string
                rows?: { feature: string; labcd: boolean; traditional: boolean }[]
              } | undefined) ?? {}
              return (
                <>
                  <TextField label="Title" value={diff.title ?? ''} onChange={(v) => patchSection('differentiation', { title: v })} />
                  <TextField label="Subtitle" value={diff.subtitle ?? ''} onChange={(v) => patchSection('differentiation', { subtitle: v })} multiline />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="LabCD column label" value={diff.labcd_column ?? ''} onChange={(v) => patchSection('differentiation', { labcd_column: v })} />
                    <TextField label="Traditional column label" value={diff.traditional_column ?? ''} onChange={(v) => patchSection('differentiation', { traditional_column: v })} />
                  </div>
                  {(diff.rows ?? []).map((row, index) => (
                    <div key={index} className="grid gap-2 rounded-lg border border-border-subtle p-3 sm:grid-cols-[1fr_auto_auto]">
                      <TextField
                        label={`Row ${index + 1} feature`}
                        value={row.feature}
                        onChange={(v) => {
                          const rows = [...(diff.rows ?? [])]
                          rows[index] = { ...rows[index], feature: v }
                          patchSection('differentiation', { rows })
                        }}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={row.labcd}
                          onChange={(e) => {
                            const rows = [...(diff.rows ?? [])]
                            rows[index] = { ...rows[index], labcd: e.target.checked }
                            patchSection('differentiation', { rows })
                          }}
                        />
                        LabCD
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={row.traditional}
                          onChange={(e) => {
                            const rows = [...(diff.rows ?? [])]
                            rows[index] = { ...rows[index], traditional: e.target.checked }
                            patchSection('differentiation', { rows })
                          }}
                        />
                        Traditional
                      </label>
                    </div>
                  ))}
                </>
              )
            })()}
          </div>

          <div className={`${cardPanel} space-y-4`}>
            <h2 className="text-lg font-semibold">Testimonials</h2>
            {(() => {
              const testimonials = (landing.testimonials as {
                title?: string
                subtitle?: string
                items?: { quote: string; author: string; role: string; rating: number }[]
              } | undefined) ?? {}
              return (
                <>
                  <TextField label="Title" value={testimonials.title ?? ''} onChange={(v) => patchSection('testimonials', { title: v })} />
                  <TextField label="Subtitle" value={testimonials.subtitle ?? ''} onChange={(v) => patchSection('testimonials', { subtitle: v })} multiline />
                  {(testimonials.items ?? []).map((item, index) => (
                    <div key={index} className="space-y-2 rounded-lg border border-border-subtle p-3">
                      <TextField
                        label={`Testimonial ${index + 1} quote`}
                        value={item.quote}
                        onChange={(v) => {
                          const items = [...(testimonials.items ?? [])]
                          items[index] = { ...items[index], quote: v }
                          patchSection('testimonials', { items })
                        }}
                        multiline
                      />
                      <TextField
                        label="Author"
                        value={item.author}
                        onChange={(v) => {
                          const items = [...(testimonials.items ?? [])]
                          items[index] = { ...items[index], author: v }
                          patchSection('testimonials', { items })
                        }}
                      />
                      <TextField
                        label="Role"
                        value={item.role}
                        onChange={(v) => {
                          const items = [...(testimonials.items ?? [])]
                          items[index] = { ...items[index], role: v }
                          patchSection('testimonials', { items })
                        }}
                      />
                    </div>
                  ))}
                </>
              )
            })()}
          </div>

          <div className={`${cardPanel} space-y-4`}>
            <h2 className="text-lg font-semibold">Demo video</h2>
            <TextField label="Title" value={demo.title ?? ''} onChange={(v) => patchSection('demo', { title: v })} />
            <TextField label="Subtitle" value={demo.subtitle ?? ''} onChange={(v) => patchSection('demo', { subtitle: v })} multiline />
            <TextField label="Video embed URL" value={demo.video_url ?? ''} onChange={(v) => patchSection('demo', { video_url: v })} />
            <TextField label="Caption" value={demo.caption ?? ''} onChange={(v) => patchSection('demo', { caption: v })} />
          </div>

          <div className={`${cardPanel} space-y-4`}>
            <h2 className="text-lg font-semibold">Final CTA</h2>
            <TextField label="Heading line 1" value={finalCta.heading ?? ''} onChange={(v) => patchSection('final_cta', { heading: v })} />
            <TextField label="Heading line 2" value={finalCta.heading_line2 ?? ''} onChange={(v) => patchSection('final_cta', { heading_line2: v })} />
            <TextField label="Subtitle" value={finalCta.subtitle ?? ''} onChange={(v) => patchSection('final_cta', { subtitle: v })} multiline />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Primary CTA label" value={finalCta.primary_cta_label ?? ''} onChange={(v) => patchSection('final_cta', { primary_cta_label: v })} />
              <TextField label="Primary CTA URL" value={finalCta.primary_cta_url ?? ''} onChange={(v) => patchSection('final_cta', { primary_cta_url: v })} />
              <TextField label="Secondary CTA label" value={finalCta.secondary_cta_label ?? ''} onChange={(v) => patchSection('final_cta', { secondary_cta_label: v })} />
              <TextField label="Secondary CTA URL" value={finalCta.secondary_cta_url ?? ''} onChange={(v) => patchSection('final_cta', { secondary_cta_url: v })} />
            </div>
            <TextField label="Helper text" value={finalCta.helper_text ?? ''} onChange={(v) => patchSection('final_cta', { helper_text: v })} />
          </div>

          <div className={`${cardPanel} space-y-4`}>
            <h2 className="text-lg font-semibold">Footer</h2>
            <TextField label="Description" value={footer.description ?? ''} onChange={(v) => patchSection('footer', { description: v })} multiline />
            <TextField label="Copyright" value={footer.copyright ?? ''} onChange={(v) => patchSection('footer', { copyright: v })} />
          </div>

          <button type="submit" className={`${btnPrimary} ${btnBase}`} disabled={saving}>
            {saving ? 'Saving…' : 'Save landing content'}
          </button>
        </form>
      )}
    </section>
  )
}
