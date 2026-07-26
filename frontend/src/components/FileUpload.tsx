import { useCallback, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import { fieldLabel } from '../lib/classes'

interface FileUploadProps {
  onFileSelect: (file: File) => void
  accept?: string
  disabled?: boolean
}

export function FileUpload({
  onFileSelect,
  accept = '.py,.m',
  disabled = false,
}: FileUploadProps) {
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  const handleFile = useCallback(
    (file: File) => {
      setFileName(file.name)
      onFileSelect(file)
    },
    [onFileSelect],
  )

  return (
    <label className={`${fieldLabel} mb-0`}>
      <span>System definition file</span>
      <div
        className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors duration-150 cursor-pointer sm:px-6 sm:py-8 ${
          dragOver
            ? 'border-primary bg-[color-mix(in_srgb,var(--app-primary)_8%,transparent)]'
            : 'border-border-input bg-surface-muted hover:border-primary/60 hover:bg-surface-hover'
        } ${disabled ? 'opacity-60 cursor-not-allowed pointer-events-none' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (disabled) return
          const file = e.dataTransfer.files?.[0]
          if (file) handleFile(file)
        }}
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--app-primary)_12%,transparent)]">
          {fileName ? (
            <FileUp className="size-6 text-primary" aria-hidden />
          ) : (
            <Upload className="size-6 text-primary" aria-hidden />
          )}
        </div>
        <div>
          <p className="m-0 font-medium text-foreground">
            {fileName ? fileName : 'Drop file here or click to browse'}
          </p>
          <p className="m-0 mt-1 text-sm text-muted">Python (.py) or MATLAB (.m)</p>
        </div>
        <input
          type="file"
          accept={accept}
          disabled={disabled}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
      </div>
    </label>
  )
}
