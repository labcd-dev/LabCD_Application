import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import '../components/landing/landing.css'

type MarkdownContentProps = {
  content: string
  className?: string
}

/**
 * Normalize display-math delimiters before passing content to remark-math:
 * - Backend blocks use '\\[formula\\]', while remark-math uses '$$formula$$'.
 * - Existing inline display math is expanded onto its own block.
 * - Standalone single-line display math gets inner newlines for KaTeX.
 */
function preprocessMath(text: string): string {
  if (!text) return ''

  // The backend deliberately emits LaTeX with \[ ... \] delimiters. Unified's
  // remark-math parser uses $$ ... $$ for display math, so normalize the
  // backend form before passing the response to ReactMarkdown.
  let normalized = text.replace(/\\\[([\s\S]*?)\\\]/g, '\n\n$$$$\n$1\n$$$$\n\n')
  normalized = normalized.replace(/([^\n])\s*\$\$([\s\S]+?)\$\$/g, '$1\n\n$$$$\n$2\n$$$$\n\n')
  normalized = normalized.replace(/\n\$\$([^\n]+?)\$\$/g, '\n$$$$\n$1\n$$$$')
  return normalized
}

export function MarkdownContent({ content, className = 'landing-markdown' }: MarkdownContentProps) {
  const processed = preprocessMath(content)

  return (
    <div className={`${className} math-content`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
