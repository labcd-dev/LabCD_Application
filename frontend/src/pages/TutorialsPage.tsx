import { useCallback, useEffect, useState } from 'react'
import { Download, FileText, LayoutTemplate, Clapperboard } from 'lucide-react'
import { tutorialsApi } from '../api/endpoints'
import type {
  ControlDesignTemplate,
  TutorialDocument,
  TutorialDocumentSummary,
  TutorialVideo,
} from '../api/types'
import { MarkdownContent } from '../components/MarkdownContent'
import { StatusMessage } from '../components/StatusMessage'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

type TabId = 'videos' | 'docs' | 'templates'

const tabs: { id: TabId; label: string; icon: typeof Clapperboard }[] = [
  { id: 'videos', label: 'Videos', icon: Clapperboard },
  { id: 'docs', label: 'Documentation', icon: FileText },
  { id: 'templates', label: 'Control Design Templates', icon: LayoutTemplate },
]

function tabClass(active: boolean) {
  return `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? 'bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
      : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
  }`
}

export function TutorialsPage() {
  const [tab, setTab] = useState<TabId>('videos')
  const [videos, setVideos] = useState<TutorialVideo[]>([])
  const [docs, setDocs] = useState<TutorialDocumentSummary[]>([])
  const [templates, setTemplates] = useState<ControlDesignTemplate[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<TutorialDocument | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [docLoading, setDocLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextVideos, nextDocs, nextTemplates] = await Promise.all([
        tutorialsApi.listVideos(),
        tutorialsApi.listDocuments(),
        tutorialsApi.listTemplates(),
      ])
      setVideos(nextVideos)
      setDocs(nextDocs)
      setTemplates(nextTemplates)
      setActiveVideoId((prev) => prev ?? nextVideos[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tutorials')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedSlug) {
      setSelectedDoc(null)
      return
    }
    let cancelled = false
    setDocLoading(true)
    void tutorialsApi
      .getDocument(selectedSlug)
      .then((doc) => {
        if (!cancelled) setSelectedDoc(doc)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document')
          setSelectedDoc(null)
        }
      })
      .finally(() => {
        if (!cancelled) setDocLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedSlug])

  const activeVideo = videos.find((v) => v.id === activeVideoId) ?? videos[0] ?? null

  return (
    <section className={pageSection}>
      <header className="mb-4">
        <h1 className={pageTitle}>
          <span className="inline-flex items-center gap-2">
            <Clapperboard className="size-6 text-primary" aria-hidden />
            Tutorials
          </span>
        </h1>
        <p className={pageIntro}>
          Watch how-to videos, read documentation, and download Control Design Templates.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Tutorial sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tabClass(tab === id)}
            onClick={() => setTab(id)}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {loading ? (
        <p className="text-sm text-muted-text">Loading…</p>
      ) : (
        <>
          {tab === 'videos' && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className={cardPanel}>
                {activeVideo ? (
                  <>
                    <h2 className="mt-0 mb-3 text-base font-semibold text-foreground">
                      {activeVideo.title}
                    </h2>
                    <video
                      key={activeVideo.id}
                      className="aspect-video w-full rounded-xl bg-black object-contain"
                      src={activeVideo.file_url}
                      controls
                      playsInline
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-text">No tutorial videos available yet.</p>
                )}
              </div>
              <aside className={cardPanel}>
                <h2 className="mt-0 mb-3 text-sm font-semibold text-foreground">Playlist</h2>
                {videos.length === 0 ? (
                  <p className="text-sm text-muted-text">Nothing here yet.</p>
                ) : (
                  <ul className="m-0 list-none space-y-1 p-0">
                    {videos.map((video) => (
                      <li key={video.id}>
                        <button
                          type="button"
                          className={`${btnBase} ${btnCompact} w-full justify-start ${
                            video.id === activeVideo?.id ? 'text-primary' : ''
                          }`}
                          onClick={() => setActiveVideoId(video.id)}
                        >
                          {video.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            </div>
          )}

          {tab === 'docs' && (
            <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className={cardPanel}>
                <h2 className="mt-0 mb-3 text-sm font-semibold text-foreground">Documents</h2>
                {docs.length === 0 ? (
                  <p className="text-sm text-muted-text">No documentation yet.</p>
                ) : (
                  <ul className="m-0 list-none space-y-1 p-0">
                    {docs.map((doc) => (
                      <li key={doc.id}>
                        <button
                          type="button"
                          className={`${btnBase} ${btnCompact} w-full justify-start ${
                            selectedSlug === doc.slug ? 'text-primary' : ''
                          }`}
                          onClick={() => setSelectedSlug(doc.slug)}
                        >
                          {doc.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
              <div className={cardPanel}>
                {!selectedSlug ? (
                  <p className="text-sm text-muted-text">Select a document to read.</p>
                ) : docLoading ? (
                  <p className="text-sm text-muted-text">Loading document…</p>
                ) : selectedDoc ? (
                  <>
                    <h2 className="mt-0 mb-4 text-lg font-semibold text-foreground">
                      {selectedDoc.title}
                    </h2>
                    <MarkdownContent content={selectedDoc.body_markdown || '*Empty document.*'} />
                  </>
                ) : (
                  <p className="text-sm text-muted-text">Document not found.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'templates' && (
            <div className={cardPanel}>
              {templates.length === 0 ? (
                <p className="text-sm text-muted-text">No Control Design Templates uploaded yet.</p>
              ) : (
                <ul className="m-0 list-none space-y-3 p-0">
                  {templates.map((template) => (
                    <li
                      key={template.id}
                      className="flex flex-col gap-3 rounded-xl border border-border-subtle p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <h2 className="m-0 text-base font-semibold text-foreground">
                          {template.title}
                        </h2>
                        {template.description ? (
                          <p className="mt-1 mb-0 text-sm text-muted-text">{template.description}</p>
                        ) : null}
                        <p className="mt-1 mb-0 text-xs text-muted">
                          {template.original_filename}
                        </p>
                      </div>
                      <a
                        className={`${btnPrimary} ${btnBase} shrink-0`}
                        href={template.file_url}
                        download={template.original_filename}
                      >
                        <Download className="size-4" aria-hidden />
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
