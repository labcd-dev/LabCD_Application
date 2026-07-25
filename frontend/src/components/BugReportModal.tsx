import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Bug, Check, Loader2 } from 'lucide-react'
import { bugReportsApi } from '../api/endpoints'
import { StatusMessage } from './StatusMessage'
import { btnBase, btnPrimary, btnWide, fieldInput, fieldLabel } from '../lib/classes'

interface BugReportModalProps {
  open: boolean
  onClose: () => void
}

export function BugReportModal({ open, onClose }: BugReportModalProps) {
  const [description, setDescription] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const closeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    setDescription('')
    setImage(null)
    setPreviewUrl(null)
    setError(null)
    setSaving(false)
    setSubmitted(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    return () => {
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [open])

  useEffect(() => {
    if (!image) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(image)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  if (!open) return null

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setImage(file)
    setError(null)
  }

  const clearImage = () => {
    setImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const text = description.trim()
    if (!text) {
      setError('Please describe the bug.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await bugReportsApi.create({
        description: text,
        page_url: window.location.href,
        image,
      })
      setSubmitted(true)
      setDescription('')
      clearImage()
      closeTimerRef.current = window.setTimeout(() => onClose(), 1400)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit bug report')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="admin-fade-in absolute inset-0 bg-foreground/45 backdrop-blur-[2px]"
        aria-label="Close bug report"
        onClick={onClose}
        disabled={saving || submitted}
      />
      <div
        className="admin-slide-in relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
      >
        {submitted ? (
          <div className="bug-report-success flex flex-col items-center justify-center py-10 text-center" role="status">
            <div className="bug-report-success__ring mb-4 flex size-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--app-primary)_16%,transparent)] text-primary">
              <Check className="bug-report-success__check size-8" strokeWidth={2.5} aria-hidden />
            </div>
            <h2 id="bug-report-title" className="m-0 text-xl font-semibold text-foreground">
              Report submitted
            </h2>
            <p className="mt-2 text-sm text-muted-text">Thanks — we will look into it.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-muted text-foreground">
                <Bug className="size-5" aria-hidden />
              </div>
              <div>
                <h2 id="bug-report-title" className="m-0 text-xl font-semibold text-foreground">
                  Report a bug
                </h2>
                <p className="mt-2 text-sm text-muted-text">
                  Describe what went wrong. A screenshot helps, but is optional.
                </p>
              </div>
            </div>

            <form className="mt-5" onSubmit={(e) => void handleSubmit(e)}>
              <label className={fieldLabel}>
                <span>Description</span>
                <textarea
                  className={`${fieldInput} min-h-[120px] resize-y`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={8000}
                  required
                  disabled={saving}
                  placeholder="What happened? What did you expect?"
                />
              </label>

              <label className={fieldLabel}>
                <span>Screenshot (optional)</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className={fieldInput}
                  onChange={handleImageChange}
                  disabled={saving}
                />
              </label>

              {previewUrl && (
                <div className="mb-4 overflow-hidden rounded-xl border border-border">
                  <img
                    src={previewUrl}
                    alt="Screenshot preview"
                    className="max-h-48 w-full object-contain bg-surface-muted"
                  />
                  <button
                    type="button"
                    className={`${btnBase} m-2`}
                    onClick={clearImage}
                    disabled={saving}
                  >
                    Remove image
                  </button>
                </div>
              )}

              {error && <StatusMessage type="error" message={error} />}

              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className={`${btnBase} ${btnWide} sm:mt-4`}
                  onClick={onClose}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${btnPrimary} ${btnWide} ${saving ? 'bug-report-submit--busy' : ''}`}
                  disabled={saving}
                >
                  {saving ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Submitting…
                    </span>
                  ) : (
                    'Submit report'
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
