import type { JourneyComment } from '../../../api/types'
import { cardPanel } from '../../../lib/classes'
import { formatDateTime } from '../../../lib/formatDateTime'

function commentSourceLabel(source: string): string {
  if (source === 'session_comment') return 'Session comment'
  if (source === 'feedback_survey') return 'Feedback survey'
  if (source === 'bug_report') return 'Bug report'
  return source
}

function CommentCard({ comment }: { comment: JourneyComment }) {
  return (
    <article className="rounded-lg border border-border bg-surface/60 p-3">
      <p className="text-sm leading-relaxed text-foreground/90 italic">
        “{comment.text}”
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-text">
        <span>{commentSourceLabel(comment.source)}</span>
        <span>{formatDateTime(comment.timestamp)}</span>
        {comment.rating != null ? <span>Rating {comment.rating} / 5</span> : null}
        {comment.meta ? <span>{comment.meta}</span> : null}
      </div>
    </article>
  )
}

type Props = {
  comments: JourneyComment[]
  loading: boolean
}

export function JourneyComments({ comments, loading }: Props) {
  return (
    <section className={cardPanel}>
      <h2 className="m-0 text-sm font-semibold text-foreground">Voice of user</h2>
      <p className="mt-0.5 text-xs text-muted-text">
        Final comments from design grades, surveys, and bug reports
      </p>
      {loading ? (
        <p className="mt-4 text-sm text-muted-text">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="mt-4 text-sm text-muted-text">No comments for this user.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {comments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} />
          ))}
        </div>
      )}
    </section>
  )
}
