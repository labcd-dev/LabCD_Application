/** Muted, bubble-less record of a HITL choice. No avatar, no message actions. */
export function HitlTraceRow({ text }: { text: string }) {
  return (
    <div className="ap-hitl-trace" role="note">
      <span aria-hidden>↳ </span>
      {text}
    </div>
  )
}
