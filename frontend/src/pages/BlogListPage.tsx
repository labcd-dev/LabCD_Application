import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { blogApi } from '../api/endpoints'
import type { BlogPostListItem } from '../api/types'
import { LandingLink } from '../components/landing/landingUtils'
import { formatDate } from '../lib/formatDateTime'
import '../components/landing/landing.css'

export function BlogListPage() {
  const [posts, setPosts] = useState<BlogPostListItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    blogApi
      .list()
      .then(setPosts)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load blog'))
  }, [])

  return (
    <div className="landing-root min-h-screen bg-[#050b18] text-white">
      <header className="border-b border-white/10 bg-[#030716] px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link to="/" className="text-sm font-medium text-white/70 hover:text-white">
            ← Back to home
          </Link>
          <h1 className="text-xl font-bold">LabCD Blog</h1>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-12">
        {error && <p className="text-red-300">{error}</p>}
        <div className="grid gap-6 md:grid-cols-2">
          {posts.map((post) => (
            <article key={post.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              {post.cover_image_url && (
                <img src={post.cover_image_url} alt="" className="mb-4 h-40 w-full rounded-xl object-cover" />
              )}
              <h2 className="text-2xl font-bold">
                <LandingLink href={`/blog/${post.slug}`} className="hover:underline">
                  {post.title}
                </LandingLink>
              </h2>
              {post.published_at && (
                <p className="mt-2 text-sm text-white/45">
                  {formatDate(post.published_at)}
                </p>
              )}
              <p className="mt-4 text-white/65">{post.excerpt}</p>
            </article>
          ))}
        </div>
        {posts.length === 0 && !error && (
          <p className="text-center text-white/50">No published articles yet.</p>
        )}
      </main>
    </div>
  )
}
