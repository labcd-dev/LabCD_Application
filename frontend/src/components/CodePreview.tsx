import { useEffect, useMemo, useState } from 'react'
import type { ComponentProps, CSSProperties, FC } from 'react'
import EditorImport from 'react-simple-code-editor'
import { highlight, languages } from 'prismjs'
import { codePreview } from '../lib/classes'
import { highlightSource } from '../lib/prismHighlight'

type EditorComponent = FC<ComponentProps<typeof EditorImport>>

// CJS package: Vite may leave the real component nested under `.default`.
const Editor = (
  (EditorImport as unknown as { default?: EditorComponent }).default ?? EditorImport
) as EditorComponent

interface CodePreviewProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  height?: number
  language?: 'python' | 'matlab'
  /** Show a narrow gutter of 1-based line numbers (default true). */
  showLineNumbers?: boolean
  className?: string
}

function highlightCode(code: string, language: 'python' | 'matlab') {
  if (language === 'matlab') {
    return highlight(code, languages.clike, 'clike')
  }
  return highlightSource(code, 'python')
}

function useResponsiveEditorHeight(height: number) {
  const [resolved, setResolved] = useState(height)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const update = () => {
      setResolved(mq.matches ? Math.min(height, 260) : height)
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [height])

  return resolved
}

export function CodePreview({
  value,
  onChange,
  readOnly = false,
  height = 400,
  language = 'python',
  showLineNumbers = true,
  className = '',
}: CodePreviewProps) {
  const isEditable = !readOnly && Boolean(onChange)
  const resolvedHeight = useResponsiveEditorHeight(height)

  const lineNumbers = useMemo(() => {
    const n = value ? value.split('\n').length : 1
    return Array.from({ length: Math.max(n, 1) }, (_, i) => i + 1)
  }, [value])

  const gutterWidthCh = Math.max(2, String(lineNumbers.length).length)

  const editorPadding = { top: 12, right: 14, bottom: 12, left: 14 }

  const editorStyle: CSSProperties = {
    minHeight: '100%',
  }

  return (
    <div
      className={`code-editor ${showLineNumbers ? 'code-editor--lined' : ''} ${codePreview} ${className}`.trim()}
      style={{ height: resolvedHeight, minHeight: Math.min(resolvedHeight, 180) }}
    >
      <div className="code-editor__scroll">
        {showLineNumbers && (
          <div
            className="code-editor__gutter"
            aria-hidden="true"
            style={{ ['--gutter-ch' as string]: gutterWidthCh } as CSSProperties}
          >
            {lineNumbers.map((n) => (
              <span key={n} className="code-editor__lineno">
                {n}
              </span>
            ))}
          </div>
        )}
        <div className="code-editor__body">
          <Editor
            value={value}
            onValueChange={(next) => onChange?.(next)}
            highlight={(code) => highlightCode(code, language)}
            disabled={!isEditable}
            padding={editorPadding}
            tabSize={4}
            insertSpaces
            className="code-editor__surface"
            textareaClassName="code-editor__textarea"
            preClassName="code-editor__pre"
            style={editorStyle}
          />
        </div>
      </div>
    </div>
  )
}
