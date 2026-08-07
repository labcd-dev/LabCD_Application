import { Navigate, Link, useNavigate, useParams } from 'react-router-dom'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminBlogApi } from '../api/endpoints'
import { ImageUploadField } from '../components/ImageUploadField'
import { MarkdownContent } from '../components/MarkdownContent'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
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

export function AdminBlogEditorPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const { hasAction } = useAuth()
  const canManage = hasAction('admin:blog')
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [body, setBody] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isNew || !id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const post = await adminBlogApi.get(Number(id))
      setTitle(post.title)
      setSlug(post.slug)
      setExcerpt(post.excerpt)
      setBody(post.body_markdown)
      setCoverUrl(post.cover_image_url ?? '')
      setStatus(post.status === 'published' ? 'published' : 'draft')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load post')
    } finally {
      setLoading(false)
    }
  }, [id, isNew])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  if (!canManage) {
    return <Navigate to="/admin" replace />
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (isNew) {
        const created = await adminBlogApi.create({
          title: title.trim(),
          slug: slug.trim() || null,
          excerpt,
          body_markdown: body,
          cover_image_url: coverUrl.trim() || null,
          status,
        })
        setMessage('Article created.')
        navigate(`/admin/blog/${created.id}`, { replace: true })
      } else if (id) {
        await adminBlogApi.update(Number(id), {
          title: title.trim(),
          slug: slug.trim(),
          excerpt,
          body_markdown: body,
          cover_image_url: coverUrl.trim() || null,
          status,
        })
        setMessage('Article saved.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save article')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={pageSection}>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={pageTitle}>{isNew ? 'New article' : 'Edit article'}</h1>
          <p className={pageIntro}>Write Markdown content for the public blog.</p>
        </div>
        <Link to="/admin/blog" className={btnBase}>
          Back to list
        </Link>
      </header>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}
      {loading ? (
        <p className="text-muted-text">Loading…</p>
      ) : (
        <form onSubmit={handleSubmit} className="grid w-full gap-6 lg:grid-cols-2">
          <div className={`${cardPanel} space-y-4`}>
            <div>
              <label className={fieldLabel} htmlFor="title">
                Title
              </label>
              <input id="title" className={fieldInput} value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="slug">
                Slug
              </label>
              <input id="slug" className={fieldInput} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated if empty" />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="excerpt">
                Excerpt
              </label>
              <textarea id="excerpt" className={`${fieldInput} min-h-24`} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
            </div>
            <ImageUploadField
              label="Cover image"
              value={coverUrl}
              onChange={setCoverUrl}
              prefix="cover"
              previewClassName="h-24 w-full max-w-xs object-cover"
            />
            <div>
              <label className={fieldLabel} htmlFor="status">
                Status
              </label>
              <select id="status" className={fieldInput} value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
            <button type="submit" className={`${btnPrimary} ${btnBase}`} disabled={saving}>
              {saving ? 'Saving…' : 'Save article'}
            </button>
          </div>
          <div className={`${cardPanel} space-y-4`}>
            <div>
              <label className={fieldLabel} htmlFor="body">
                Body (Markdown)
              </label>
              <textarea id="body" className={`${fieldInput} min-h-[420px] font-mono text-sm`} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-foreground">Preview</h2>
              <div className="landing-root rounded-xl border border-border bg-[#050b18] p-4">
                <MarkdownContent content={body || '*Nothing to preview yet.*'} />
              </div>
            </div>
          </div>
        </form>
      )}
    </section>
  )
}
