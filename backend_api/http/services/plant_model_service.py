"""Plant-model chat HTTP service adapter."""

from __future__ import annotations

from typing import Any, Literal

from backend_api.PlantModelChat.agent import (
    PlantModelAgent,
    PlantModelSessionState as AgentSessionState,
    apply_session_state,
    export_session_state,
)
from backend_api.http.schemas.plant_model import (
    PlantModelChatRequest,
    PlantModelChatResponse,
    PlantModelResult,
    PlantModelSessionState,
    TokenUsageOut,
)


def _metadata_is_complete(meta: Any, required_keys: tuple[str, ...]) -> bool:
    """True when ``meta`` already has everything PlantCompiler needs, so
    there's no need to run the (heavier) inference fallback at all.
    """
    if not isinstance(meta, dict):
        return False
    if not all(key in meta for key in required_keys):
        return False

    states = meta.get("states")
    if not isinstance(states, list) or not states:
        return False
    n_states = len(states)
    for key in ("state_meanings", "state_equations"):
        value = meta.get(key)
        if not isinstance(value, list) or len(value) != n_states:
            return False
    if not isinstance(meta.get("inputs"), list) or not meta["inputs"]:
        return False
    if not isinstance(meta.get("outputs"), list) or not meta["outputs"]:
        return False
    if not isinstance(meta.get("parameters"), dict):
        return False
    if not meta.get("system_type"):
        return False
    if not isinstance(meta.get("assumptions"), list) or not meta["assumptions"]:
        return False
    return True


def _resolved_metadata(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return metadata aligned with ``python_code`` for sidebar / complete.

    Always runs ``reconcile_metadata_with_code`` when the compiler is
    available: that partial-merges LLM metadata, extracts equations from
    code (including ``dtheta_dt``-style assignments), and numerically
    verifies so drifted LLM ``state_equations`` cannot pass through.
    """
    if not payload:
        return None
    meta = payload.get("metadata")
    try:
        from backend_core.plant_compiler import reconcile_metadata_with_code
    except Exception:
        return meta if isinstance(meta, dict) else None

    try:
        reconciled = reconcile_metadata_with_code(
            {
                "system_name": payload.get("system_name"),
                "python_code": payload.get("python_code") or "",
                "metadata": meta if isinstance(meta, dict) else None,
            }
        )
        # Internal diagnostics only — not part of the public metadata schema.
        reconciled.pop("_verify", None)
        return reconciled
    except Exception:
        return meta if isinstance(meta, dict) else None


def _to_agent_session_state(
    state: PlantModelSessionState | None,
) -> AgentSessionState | None:
    if state is None:
        return None
    latest = None
    if state.latest_draft is not None:
        latest = {
            "system_name": state.latest_draft.system_name,
            "python_code": state.latest_draft.python_code,
        }
        if state.latest_draft.metadata:
            latest["metadata"] = state.latest_draft.metadata
    return AgentSessionState(draft_count=state.draft_count, latest_draft=latest)


def _from_agent_session_state(state: AgentSessionState) -> PlantModelSessionState:
    latest = None
    if state.latest_draft is not None:
        latest = PlantModelResult(
            system_name=state.latest_draft["system_name"],
            python_code=state.latest_draft["python_code"],
            # Resolved (not just passed through) so the sidebar has usable
            # metadata on drafts too, not only on the final "complete" result.
            metadata=_resolved_metadata(state.latest_draft),
        )
    return PlantModelSessionState(draft_count=state.draft_count, latest_draft=latest)


def _infer_status(
    *,
    prev_draft_count: int,
    draft_count: int,
    final_result: dict | None,
) -> Literal["continue", "draft", "complete"]:
    if final_result is not None:
        return "complete"
    if draft_count > prev_draft_count:
        return "draft"
    return "continue"


def run_plant_model_chat(request: PlantModelChatRequest) -> PlantModelChatResponse:
    from backend_api.http.schemas.plant_model import (
        PlantModelRagChunk,
        PlantModelWebSearch,
    )
    from backend_api.http.services import plant_model_extras as extras

    agent = PlantModelAgent(
        model=request.model,
        max_drafts=request.max_drafts,
        min_user_turns_before_completion=request.min_user_turns_before_completion,
    )
    apply_session_state(agent, _to_agent_session_state(request.session_state))
    prev_draft_count = agent._draft_count

    history = [{"role": m.role, "content": m.content} for m in request.messages]
    user_message = request.user_message.strip()

    from backend_api.http.schemas.plant_model import PlantModelStep

    # RAG: prefer vector-store file_search; fall back to local extracted text.
    steps_acc: list[PlantModelStep] = []
    rag_chunks_out: list[PlantModelRagChunk] = []
    retrieved_context = ""
    try:
        from backend_api.http.services import plant_model_extras as extras_mod

        # Only ground on uploads when the client opts in (first message after attach).
        if not getattr(request, "use_attachments", False):
            attached = []
            summary, chunks = "", []
        else:
            attached = list(getattr(extras_mod, "_attached_files", []) or [])
            summary, chunks = extras.retrieve_attachment_context(user_message)
        retrieved_context = summary or ""
        for ch in chunks or []:
            if hasattr(ch, "file_name"):
                rag_chunks_out.append(
                    PlantModelRagChunk(
                        file_name=getattr(ch, "file_name", "") or "",
                        text=getattr(ch, "text", "") or "",
                        score=getattr(ch, "score", None),
                    )
                )
            elif isinstance(ch, dict):
                rag_chunks_out.append(
                    PlantModelRagChunk(
                        file_name=str(ch.get("file_name") or ""),
                        text=str(ch.get("text") or ""),
                        score=ch.get("score"),
                    )
                )
        if attached or retrieved_context or rag_chunks_out:
            file_label = ", ".join(attached) if attached else "attachment"
            if rag_chunks_out:
                detail = "\n".join(
                    f"{c.file_name} (score={c.score}): {(c.text or '')[:160]}"
                    for c in rag_chunks_out[:5]
                )
            elif retrieved_context:
                detail = (retrieved_context[:400] + "…") if len(retrieved_context) > 400 else retrieved_context
            else:
                detail = "No indexed chunks yet; local text used when available."
            steps_acc.append(
                PlantModelStep(
                    kind="rag",
                    label=f"Searched files: {file_label}",
                    detail=detail,
                    ok=True,
                )
            )
    except Exception as rag_exc:
        retrieved_context = ""
        steps_acc.append(
            PlantModelStep(
                kind="rag",
                label="File search failed",
                detail=str(rag_exc),
                ok=False,
            )
        )

    # Focus-gated web search when the frontend toggle is on.
    web_search_out: PlantModelWebSearch | None = None
    web_context = ""
    if getattr(request, "web_search_enabled", False):
        try:
            ws = extras.run_web_search(
                user_message=user_message,
                history=history,
                retrieved_context=retrieved_context,
                model=request.model,
            )
            web_search_out = PlantModelWebSearch(
                status=str(ws.get("status") or "empty"),
                query=ws.get("query"),
                brief=ws.get("brief"),
                link=ws.get("link"),
                reason=ws.get("reason"),
                links=list(ws.get("links") or []),
                queries=list(ws.get("queries") or []),
            )
            if web_search_out.status == "ok" and web_search_out.brief:
                web_context = web_search_out.brief
                queries = list(web_search_out.queries or []) or [web_search_out.query or "web"]
                for q in queries:
                    steps_acc.append(
                        PlantModelStep(
                            kind="web",
                            label=f"Searched the web: {q}",
                            detail=None,
                            ok=True,
                        )
                    )
                links = list(web_search_out.links or [])
                if links:
                    src_lines = []
                    for lk in links[:10]:
                        title = (lk.get("title") or lk.get("url") or "").strip()
                        url = (lk.get("url") or "").strip()
                        src_lines.append(
                            f"• {title}" + (f"\n  {url}" if url and url != title else "")
                        )
                    steps_acc.append(
                        PlantModelStep(
                            kind="web",
                            label=f"Sources ({len(links)})",
                            detail="\n".join(src_lines),
                            ok=True,
                        )
                    )
                steps_acc.append(
                    PlantModelStep(
                        kind="web",
                        label="Research brief",
                        detail=(web_search_out.brief or "")[:600],
                        ok=True,
                    )
                )
            else:
                steps_acc.append(
                    PlantModelStep(
                        kind="web",
                        label="Web search skipped",
                        detail=web_search_out.reason or web_search_out.query,
                        ok=True,
                    )
                )
        except Exception as exc:
            web_search_out = PlantModelWebSearch(
                status="skipped",
                reason=str(exc),
            )
            steps_acc.append(
                PlantModelStep(
                    kind="web",
                    label="Web search failed",
                    detail=str(exc),
                    ok=False,
                )
            )
    else:
        web_search_out = PlantModelWebSearch(status="empty")

    # Augment only the message copy passed to the agent (do not rewrite stored history).
    agent_user_message = user_message
    context_blocks: list[str] = []
    if retrieved_context:
        context_blocks.append(
            "Attached-file context (use this; do not claim you cannot access attachments):\n"
            f"{retrieved_context}"
        )
    if web_context:
        context_blocks.append(
            "Web search brief (use for specific real-world facts; cite if relevant):\n"
            f"{web_context}"
        )
    if context_blocks:
        agent_user_message = (
            f"{user_message}\n\n---\n" + "\n\n---\n".join(context_blocks) + "\n---"
        )

    reply, final_payload = agent.step(history, agent_user_message)

    # NOTE: this also resolves metadata for session_state.latest_draft (via
    # _from_agent_session_state), so the sidebar has real metadata to show
    # while a draft is still in progress, not only once the plant is confirmed.
    session_state = _from_agent_session_state(export_session_state(agent))
    status = _infer_status(
        prev_draft_count=prev_draft_count,
        draft_count=agent._draft_count,
        final_result=final_payload,
    )

    final_result = None
    if final_payload is not None:
        final_result = PlantModelResult(
            system_name=final_payload["system_name"],
            python_code=final_payload["python_code"],
            metadata=_resolved_metadata(final_payload),
        )

    usage_totals = agent.total_usage
    usage = TokenUsageOut(
        input_tokens=usage_totals.input_tokens,
        output_tokens=usage_totals.output_tokens,
        estimated_cost=agent.total_cost,
    )

    return PlantModelChatResponse(
        reply=reply,
        status=status,
        final_result=final_result,
        session_state=session_state,
        usage=usage,
        steps=steps_acc,
        rag_chunks=rag_chunks_out,
        web_search=web_search_out,
    )
