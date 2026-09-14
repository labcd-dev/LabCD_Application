import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { btnBase, btnCompact } from '../lib/classes'

interface BackToCaseStudiesProps {
  to?: string
  label?: string
  className?: string
}

export function BackToCaseStudies({
  to = '/case-studies',
  label = 'Back',
  className = '',
}: BackToCaseStudiesProps) {
  return (
    <Link
      to={to}
      className={`${btnBase} ${btnCompact} w-fit shrink-0 no-underline ${className}`}
      aria-label="Back to Case Studies & Projects"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      {label}
    </Link>
  )
}
