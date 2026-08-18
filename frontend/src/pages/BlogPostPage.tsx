import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { blogApi } from '../api/endpoints'
import type { BlogPost } from '../api/types'
import { MarkdownContent } from '../components/MarkdownContent'
import { formatDate } from '../lib/formatDateTime'
import '../components/landing/landing.css'

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>()
  const [post, setPost] = useState<BlogPost | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    blogApi
      .get(slug)
      .then(setPost)
      .catch((err) => setError(err instanceof Error ? err.message : 'Post not found'))
  }, [slug])

  return (
    <div className="landing-root min-h-screen bg-[#050b18] text-white">
      <header className="border-b border-white/10 bg-[#030716] px-6 py-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link to="/blog" className="text-sm font-medium text-white/70 hover:text-white">
            ← All articles
          </Link>
          <Link to="/" className="text-sm font-medium text-white/70 hover:text-white">
            Home
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        {error && <p className="text-red-300">{error}</p>}
        {post && (
          <article>
            {post.cover_image_url && (
              <img src={post.cover_image_url} alt="" className="mb-8 h-56 w-full rounded-2xl object-cover" />
            )}
            <h1 className="text-4xl font-extrabold tracking-tight">{post.title}</h1>
            {post.published_at && (
              <p className="mt-3 text-sm text-white/45">
                {formatDate(post.published_at)}
              </p>
            )}
            {post.excerpt && <p className="mt-6 text-lg text-white/70">{post.excerpt}</p>}
            <div className="mt-10">
              <MarkdownContent content={post.body_markdown} />
            </div>
          </article>
        )}
      </main>
    </div>
  )
}
