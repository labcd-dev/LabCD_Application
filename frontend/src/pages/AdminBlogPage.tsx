import { Link, Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { adminBlogApi } from '../api/endpoints'
import type { BlogPostListItem } from '../api/types'
import { StatusMessage } from '../components/StatusMessage'
import { AdminPagination } from '../components/admin/AdminPagination'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import { btnBase, btnPrimary, pageIntro, pageSection, pageTitle } from '../lib/classes'

export function AdminBlogPage() {
  const { user: currentUser } = useAuth()
  const [posts, setPosts] = useState<BlogPostListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPosts(await adminBlogApi.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load blog posts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!currentUser?.is_admin) return
    void load()
  }, [currentUser?.is_admin, load])

  const pagination = useClientPagination(posts)

  if (!currentUser?.is_admin) {
    return <Navigate to="/studio" replace />
  }

  const handleDelete = async (postId: number) => {
    if (!window.confirm('Delete this article?')) return
    setError(null)
    setMessage(null)
    try {
      await adminBlogApi.delete(postId)
      setMessage('Article deleted.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete article')
    }
  }

  return (
    <section className={pageSection}>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Blog</h1>
          <p className={pageIntro}>Create and publish Markdown articles for the public site.</p>
        </div>
        <Link to="/admin/blog/new" className={`${btnPrimary} ${btnBase} inline-flex items-center gap-2`}>
          <Plus className="size-4" />
          New article
        </Link>
      </header>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      {loading ? (
        <p className="text-muted-text">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagination.pageItems.map((post) => (
                  <tr key={post.id} className="border-b border-border-subtle">
                    <td className="px-4 py-3">
                      <div className="font-medium">{post.title}</div>
                      <div className="text-xs text-muted">/{post.slug}</div>
                    </td>
                    <td className="px-4 py-3 capitalize">{post.status}</td>
                    <td className="px-4 py-3">{new Date(post.updated_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link to={`/admin/blog/${post.id}`} className={`${btnBase} inline-flex items-center gap-1`}>
                          <Pencil className="size-3.5" />
                          Edit
                        </Link>
                        <button type="button" className={`${btnBase} inline-flex items-center gap-1`} onClick={() => void handleDelete(post.id)}>
                          <Trash2 className="size-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {posts.length === 0 && <p className="p-6 text-muted-text">No articles yet.</p>}
          </div>
          <AdminPagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            from={pagination.from}
            to={pagination.to}
            onPageChange={pagination.setPage}
          />
        </div>
      )}
    </section>
  )
}
