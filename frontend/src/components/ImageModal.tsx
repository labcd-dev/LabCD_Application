import { useEffect } from 'react'
import { X, ExternalLink, Download } from 'lucide-react'

export interface ImageModalProps {
  open: boolean
  imageUrl: string | null
  title?: string
  subtitle?: string
  onClose: () => void
}

export function ImageModal({
  open,
  imageUrl,
  title = 'Image Preview',
  subtitle,
  onClose,
}: ImageModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || !imageUrl) return null

  return (
    <div
      className="fixed inset-0 z-[500] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Top action bar */}
      <div className="mb-3 flex w-full max-w-5xl items-center justify-between px-1 text-white">
        <div className="min-w-0 pr-4">
          <h3 className="truncate text-sm font-semibold tracking-wide text-white/95">{title}</h3>
          {subtitle && <p className="truncate text-xs text-white/60">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={imageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            title="Open original in new tab"
            aria-label="Open original in new tab"
          >
            <ExternalLink className="size-4" />
          </a>
          <a
            href={imageUrl}
            download
            className="inline-flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            title="Download image"
            aria-label="Download image"
          >
            <Download className="size-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            title="Close (Esc)"
            aria-label="Close modal"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* Image container */}
      <div
        className="relative flex max-h-[85vh] max-w-5xl items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/80 p-2 shadow-[0_25px_70px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt={title}
          className="max-h-[80vh] w-auto max-w-full rounded-xl object-contain select-none"
        />
      </div>
    </div>
  )
}
