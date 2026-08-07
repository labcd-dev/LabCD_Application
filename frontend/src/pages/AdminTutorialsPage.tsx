import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Clapperboard, RefreshCw, Trash2, Upload } from 'lucide-react'
import { adminTutorialsApi } from '../api/endpoints'
import type {
  ControlDesignTemplate,
  TutorialDocument,
  TutorialVideo,
} from '../api/types'
import { AdminPagination } from '../components/admin/AdminPagination'
import { MarkdownContent } from '../components/MarkdownContent'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldInput,
  fieldLabel,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

type SectionId = 'videos' | 'docs' | 'templates'

function sectionTabClass(active: boolean) {
  return `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? 'bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)] text-primary'
      : 'text-muted-text hover:text-foreground hover:bg-surface-hover'
  }`
}

export function AdminTutorialsPage() {
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:tutorials')
  const [section, setSection] = useState<SectionId>('videos')
  const [videos, setVideos] = useState<TutorialVideo[]>([])
  const [documents, setDocuments] = useState<TutorialDocument[]>([])
  const [templates, setTemplates] = useState<ControlDesignTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [uploadTitle, setUploadTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const videoFileRef = useRef<HTMLInputElement>(null)

  const [docEditingId, setDocEditingId] = useState<number | null>(null)
  const [docTitle, setDocTitle] = useState('')
  const [docSlug, setDocSlug] = useState('')
  const [docBody, setDocBody] = useState('')
  const [docSaving, setDocSaving] = useState(false)

  const [templateTitle, setTemplateTitle] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [templateUploading, setTemplateUploading] = useState(false)
  const templateFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextVideos, nextDocs, nextTemplates] = await Promise.all([
        adminTutorialsApi.listVideos(),
        adminTutorialsApi.listDocuments(),
        adminTutorialsApi.listTemplates(),
      ])
      setVideos(nextVideos)
      setDocuments(nextDocs)
      setTemplates(nextTemplates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tutorials admin')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  const videoPagination = useClientPagination(videos)
  const docPagination = useClientPagination(documents)
  const templatePagination = useClientPagination(templates)

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const resetDocForm = () => {
    setDocEditingId(null)
    setDocTitle('')
    setDocSlug('')
    setDocBody('')
  }

  const startEditDoc = (doc: TutorialDocument) => {
    setDocEditingId(doc.id)
    setDocTitle(doc.title)
    setDocSlug(doc.slug)
    setDocBody(doc.body_markdown)
    setSection('docs')
  }

  const handleUploadVideo = async (event: FormEvent) => {
    event.preventDefault()
    const file = videoFileRef.current?.files?.[0]
    if (!file) {
      setError('Choose a video file to upload.')
      return
    }
    if (!uploadTitle.trim()) {
      setError('Enter a title for the video.')
      return
    }
    setUploading(true)
    setError(null)
    setMessage(null)
    try {
      await adminTutorialsApi.uploadVideo(uploadTitle.trim(), file)
      setUploadTitle('')
      if (videoFileRef.current) videoFileRef.current.value = ''
      setMessage('Tutorial video uploaded.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload video')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteVideo = async (video: TutorialVideo) => {
    if (!window.confirm(`Delete tutorial video “${video.title}”?`)) return
    setError(null)
    try {
      await adminTutorialsApi.deleteVideo(video.id)
      setMessage('Video deleted.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete video')
    }
  }

  const handleTitleBlur = async (video: TutorialVideo, title: string) => {
    const trimmed = title.trim()
    if (!trimmed || trimmed === video.title) return
    try {
      await adminTutorialsApi.updateVideo(video.id, { title: trimmed })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update title')
    }
  }

  const handleSaveDocument = async (event: FormEvent) => {
    event.preventDefault()
    if (!docTitle.trim()) {
      setError('Enter a document title.')
      return
    }
    setDocSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (docEditingId == null) {
        await adminTutorialsApi.createDocument({
          title: docTitle.trim(),
          slug: docSlug.trim() || null,
          body_markdown: docBody,
        })
        setMessage('Document created.')
      } else {
        await adminTutorialsApi.updateDocument(docEditingId, {
          title: docTitle.trim(),
          slug: docSlug.trim(),
          body_markdown: docBody,
        })
        setMessage('Document saved.')
      }
      resetDocForm()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save document')
    } finally {
      setDocSaving(false)
    }
  }

  const handleDeleteDocument = async (doc: TutorialDocument) => {
    if (!window.confirm(`Delete document “${doc.title}”?`)) return
    setError(null)
    try {
      await adminTutorialsApi.deleteDocument(doc.id)
      if (docEditingId === doc.id) resetDocForm()
      setMessage('Document deleted.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document')
    }
  }

  const handleUploadTemplate = async (event: FormEvent) => {
    event.preventDefault()
    const file = templateFileRef.current?.files?.[0]
    if (!file) {
      setError('Choose a template file to upload.')
      return
    }
    if (!templateTitle.trim()) {
      setError('Enter a title for the template.')
      return
    }
    setTemplateUploading(true)
    setError(null)
    setMessage(null)
    try {
      await adminTutorialsApi.uploadTemplate(
        templateTitle.trim(),
        templateDescription.trim(),
        file,
      )
      setTemplateTitle('')
      setTemplateDescription('')
      if (templateFileRef.current) templateFileRef.current.value = ''
      setMessage('Control Design Template uploaded.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload template')
    } finally {
      setTemplateUploading(false)
    }
  }

  const handleDeleteTemplate = async (template: ControlDesignTemplate) => {
    if (!window.confirm(`Delete template “${template.title}”?`)) return
    setError(null)
    try {
      await adminTutorialsApi.deleteTemplate(template.id)
      setMessage('Template deleted.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template')
    }
  }

  const handleTemplateTitleBlur = async (template: ControlDesignTemplate, title: string) => {
    const trimmed = title.trim()
    if (!trimmed || trimmed === template.title) return
    try {
      await adminTutorialsApi.updateTemplate(template.id, { title: trimmed })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update template')
    }
  }

  return (
    <section className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>
            <span className="inline-flex items-center gap-2">
              <Clapperboard className="size-6 text-primary" aria-hidden />
              Tutorials
            </span>
          </h1>
          <p className={pageIntro}>
            Manage how-to videos, markdown documentation, and Control Design Templates.
          </p>
        </div>
        <button
          type="button"
          className={`${btnBase} ${btnCompact}`}
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Admin tutorial sections">
        <button
          type="button"
          role="tab"
          aria-selected={section === 'videos'}
          className={sectionTabClass(section === 'videos')}
          onClick={() => setSection('videos')}
        >
          Videos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'docs'}
          className={sectionTabClass(section === 'docs')}
          onClick={() => setSection('docs')}
        >
          Documentation
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'templates'}
          className={sectionTabClass(section === 'templates')}
          onClick={() => setSection('templates')}
        >
          Templates
        </button>
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      {section === 'videos' && (
        <div className={cardPanel}>
          <h2 className="mt-0 text-base font-semibold text-foreground">Tutorial videos</h2>
          <p className="mb-4 text-sm text-muted-text">
            Uploaded clips appear in onboarding and on the Tutorials page (MP4, WebM, or MOV, up to
            100 MB).
          </p>

          <form
            className="mb-6 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
            onSubmit={(e) => void handleUploadVideo(e)}
          >
            <label className={`${fieldLabel} mb-0`}>
              <span>Title</span>
              <input
                className={fieldInput}
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                maxLength={200}
                placeholder="How LabCD works"
              />
            </label>
            <label className={`${fieldLabel} mb-0`}>
              <span>File</span>
              <input
                ref={videoFileRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                className={fieldInput}
              />
            </label>
            <div className="flex items-end">
              <button type="submit" className={btnPrimary} disabled={uploading}>
                <Upload className="size-4" />
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </form>

          {videos.length === 0 ? (
            <p className="text-sm text-muted-text">No tutorial videos yet.</p>
          ) : (
            <div className="space-y-3">
              <ul className="m-0 list-none space-y-3 p-0">
                {videoPagination.pageItems.map((video, index) => (
                  <li
                    key={video.id}
                    className="flex flex-col gap-3 rounded-xl border border-border-subtle p-3 sm:flex-row sm:items-center"
                  >
                    <span className="text-xs font-medium text-muted">
                      {videoPagination.from + index}
                    </span>
                    <input
                      className={`${fieldInput} flex-1`}
                      defaultValue={video.title}
                      onBlur={(e) => void handleTitleBlur(video, e.target.value)}
                      aria-label={`Title for video ${video.id}`}
                    />
                    <video
                      className="h-16 w-28 shrink-0 rounded-md bg-black object-cover"
                      src={video.file_url}
                      muted
                      playsInline
                    />
                    <button
                      type="button"
                      className={`${btnBase} ${btnCompact} text-[var(--app-status-error-text)]`}
                      onClick={() => void handleDeleteVideo(video)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
              <AdminPagination
                page={videoPagination.page}
                totalPages={videoPagination.totalPages}
                total={videoPagination.total}
                from={videoPagination.from}
                to={videoPagination.to}
                onPageChange={videoPagination.setPage}
              />
            </div>
          )}
        </div>
      )}

      {section === 'docs' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={`${cardPanel} space-y-4`}>
            <h2 className="mt-0 text-base font-semibold text-foreground">
              {docEditingId == null ? 'New document' : 'Edit document'}
            </h2>
            <form className="space-y-4" onSubmit={(e) => void handleSaveDocument(e)}>
              <label className={fieldLabel}>
                <span>Title</span>
                <input
                  className={fieldInput}
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  maxLength={300}
                  required
                />
              </label>
              <label className={fieldLabel}>
                <span>Slug</span>
                <input
                  className={fieldInput}
                  value={docSlug}
                  onChange={(e) => setDocSlug(e.target.value)}
                  placeholder="auto-generated if empty"
                  maxLength={320}
                />
              </label>
              <label className={fieldLabel}>
                <span>Body (Markdown)</span>
                <textarea
                  className={`${fieldInput} min-h-[280px] font-mono text-sm`}
                  value={docBody}
                  onChange={(e) => setDocBody(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={btnPrimary} disabled={docSaving}>
                  {docSaving ? 'Saving…' : docEditingId == null ? 'Create document' : 'Save'}
                </button>
                {docEditingId != null && (
                  <button type="button" className={`${btnBase} ${btnCompact}`} onClick={resetDocForm}>
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Preview</h3>
              <div className="rounded-xl border border-border bg-surface-muted p-4">
                <MarkdownContent content={docBody || '*Nothing to preview yet.*'} />
              </div>
            </div>
          </div>

          <div className={cardPanel}>
            <h2 className="mt-0 text-base font-semibold text-foreground">Documents</h2>
            {documents.length === 0 ? (
              <p className="text-sm text-muted-text">No documents yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                <ul className="m-0 list-none space-y-2 p-0">
                  {docPagination.pageItems.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex flex-col gap-2 rounded-xl border border-border-subtle p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="m-0 font-medium text-foreground">{doc.title}</p>
                        <p className="m-0 text-xs text-muted">{doc.slug}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={`${btnBase} ${btnCompact}`}
                          onClick={() => startEditDoc(doc)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`${btnBase} ${btnCompact} text-[var(--app-status-error-text)]`}
                          onClick={() => void handleDeleteDocument(doc)}
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <AdminPagination
                  page={docPagination.page}
                  totalPages={docPagination.totalPages}
                  total={docPagination.total}
                  from={docPagination.from}
                  to={docPagination.to}
                  onPageChange={docPagination.setPage}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {section === 'templates' && (
        <div className={cardPanel}>
          <h2 className="mt-0 text-base font-semibold text-foreground">Control Design Templates</h2>
          <p className="mb-4 text-sm text-muted-text">
            Upload downloadable templates (.xlsx, .xls, .csv, .json, .mat, .m, .py, .zip, .pdf, .slx,
            .mdl; up to 50 MB).
          </p>

          <form className="mb-6 grid gap-3" onSubmit={(e) => void handleUploadTemplate(e)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`${fieldLabel} mb-0`}>
                <span>Title</span>
                <input
                  className={fieldInput}
                  value={templateTitle}
                  onChange={(e) => setTemplateTitle(e.target.value)}
                  maxLength={200}
                  placeholder="PID tuning worksheet"
                />
              </label>
              <label className={`${fieldLabel} mb-0`}>
                <span>File</span>
                <input
                  ref={templateFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.json,.mat,.m,.py,.zip,.pdf,.slx,.mdl,text/x-python,text/x-matlab"
                  className={fieldInput}
                />
              </label>
            </div>
            <label className={`${fieldLabel} mb-0`}>
              <span>Description</span>
              <textarea
                className={`${fieldInput} min-h-20`}
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                maxLength={4000}
                placeholder="Optional notes for users"
              />
            </label>
            <div>
              <button type="submit" className={btnPrimary} disabled={templateUploading}>
                <Upload className="size-4" />
                {templateUploading ? 'Uploading…' : 'Upload template'}
              </button>
            </div>
          </form>

          {templates.length === 0 ? (
            <p className="text-sm text-muted-text">No templates yet.</p>
          ) : (
            <div className="space-y-3">
              <ul className="m-0 list-none space-y-3 p-0">
                {templatePagination.pageItems.map((template) => (
                  <li
                    key={template.id}
                    className="flex flex-col gap-3 rounded-xl border border-border-subtle p-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <input
                        className={fieldInput}
                        defaultValue={template.title}
                        onBlur={(e) => void handleTemplateTitleBlur(template, e.target.value)}
                        aria-label={`Title for template ${template.id}`}
                      />
                      <p className="m-0 text-xs text-muted">{template.original_filename}</p>
                      {template.description ? (
                        <p className="m-0 text-sm text-muted-text">{template.description}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={`${btnBase} ${btnCompact} text-[var(--app-status-error-text)]`}
                      onClick={() => void handleDeleteTemplate(template)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
              <AdminPagination
                page={templatePagination.page}
                totalPages={templatePagination.totalPages}
                total={templatePagination.total}
                from={templatePagination.from}
                to={templatePagination.to}
                onPageChange={templatePagination.setPage}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
