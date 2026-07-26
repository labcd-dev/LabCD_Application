import { useEffect, useState } from 'react'
import EditorImport from 'react-simple-code-editor'
import type { ComponentProps, FC } from 'react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-python'
import { codePreview } from '../lib/classes'

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
}

function highlightCode(code: string, language: 'python' | 'matlab') {
  const grammar = language === 'matlab' ? languages.clike : languages.python
  const lang = language === 'matlab' ? 'clike' : 'python'
  return highlight(code, grammar, lang)
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
}: CodePreviewProps) {
  const isEditable = !readOnly && Boolean(onChange)
  const resolvedHeight = useResponsiveEditorHeight(height)

  return (
    <div
      className={`code-editor ${codePreview} overflow-auto`}
      style={{ height: resolvedHeight, minHeight: Math.min(resolvedHeight, 180) }}
    >
      <Editor
        value={value}
        onValueChange={(next) => onChange?.(next)}
        highlight={(code) => highlightCode(code, language)}
        disabled={!isEditable}
        padding={0}
        tabSize={4}
        insertSpaces
        className="code-editor__surface"
        textareaClassName="code-editor__textarea"
        preClassName="code-editor__pre"
      />
    </div>
  )
}
