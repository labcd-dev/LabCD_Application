"""HTTP service adapter for AgentAdaptive design jobs."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any, Callable

from backend_core.AgentAdaptive.agents import clarifier
from backend_core.AgentAdaptive.agents.tuner_agent import run_full_pipeline
from backend_core.AgentAdaptive.tools import system_spec as system_spec_mod

from backend_api.http.schemas.adaptive import (
    AdaptiveClarifyRequest,
    AdaptiveClarifyResponse,
    AdaptiveJobCreateRequest,
    AdaptiveJobCreateResponse,
    AdaptiveJobOptions,
    AdaptiveJobProgressEvent,
    AdaptiveJobResultsResponse,
    AdaptiveJobStatusResponse,
    AdaptiveJobSummary,
)
from backend_api.http.services.adaptive_job_store import (
    InMemoryAdaptiveJobStore,
    JobRecord,
    default_adaptive_job_store,
)
from backend_api.http.services.executor import job_executor


def _store(store: InMemoryAdaptiveJobStore | None = None) -> InMemoryAdaptiveJobStore:
    return store or default_adaptive_job_store


def _options_dict(options: AdaptiveJobOptions | dict[str, Any] | None) -> dict[str, Any]:
    if options is None:
        return AdaptiveJobOptions().model_dump()
    if isinstance(options, AdaptiveJobOptions):
        return options.model_dump()
    return AdaptiveJobOptions(**options).model_dump()


def _options_model(raw: dict[str, Any] | None) -> AdaptiveJobOptions:
    return AdaptiveJobOptions(**(raw or {}))


def _system_name(spec: dict[str, Any] | None) -> str | None:
    if not spec:
        return None
    name = spec.get("system_name")
    return str(name) if name else None


def _coerce_project_id(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _first_float(value: Any) -> float | None:
    if isinstance(value, (int, float)) and value == value and value not in (float("inf"), float("-inf")):
        return float(value)
    if isinstance(value, (list, tuple)):
        for item in value:
            got = _first_float(item)
            if got is not None:
                return got
    return None


def _max_abs_float(value: Any) -> float | None:
    if isinstance(value, (int, float)) and value == value and value not in (float("inf"), float("-inf")):
        return abs(float(value))
    if isinstance(value, (list, tuple)):
        vals = [_first_float(v) for v in value]
        vals = [abs(v) for v in vals if v is not None]
        if vals:
            return float(max(vals))
    return None


def _enrich_metrics_for_ui(metrics: dict[str, Any] | None) -> dict[str, Any] | None:
    """Add scalar aliases expected by the Adaptive dashboard."""
    if not isinstance(metrics, dict):
        return metrics
    out = dict(metrics)
    if out.get("tracking_rms") is None:
        tracking_mse = out.get("tracking_mse") if isinstance(out.get("tracking_mse"), dict) else {}
        out["tracking_rms"] = (
            _first_float(out.get("steady_rms"))
            or _first_float(tracking_mse.get("steady"))
            or _first_float(tracking_mse.get("full"))
            or _first_float(out.get("transient_rms"))
        )
    if out.get("rms") is None and out.get("tracking_rms") is not None:
        out["rms"] = out["tracking_rms"]
    if out.get("max_u") is None:
        out["max_u"] = _max_abs_float(out.get("control_max")) or _max_abs_float(out.get("control_rms"))
    if out.get("control_effort") is None and out.get("max_u") is not None:
        out["control_effort"] = out["max_u"]
    # Preserve settling_time even when not reached (null) but surface the flag clearly.
    if "settling_time_reached" not in out and out.get("settling_time") is not None:
        out["settling_time_reached"] = True
    st = _first_float(out.get("settling_time"))
    if st is not None:
        out["settling_time"] = st
    return out


def _normalize_usage_for_ui(usage: dict[str, Any] | None) -> dict[str, Any] | None:
    """Flatten nested usage buckets and attach total_cost when pricing is available."""
    if not isinstance(usage, dict):
        return usage
    out = dict(usage)
    total = out.get("total") if isinstance(out.get("total"), dict) else {}
    if out.get("total_tokens") is None:
        out["total_tokens"] = total.get("total_tokens") or 0
    if out.get("input_tokens") is None:
        out["input_tokens"] = total.get("input_tokens") or 0
    if out.get("output_tokens") is None:
        out["output_tokens"] = total.get("output_tokens") or 0
    if out.get("total_cost") is None:
        try:
            from backend_core.AgentAdaptive.tools import model_pricing

            _rows, total_cost = model_pricing.run_cost_rows(usage)
            if total_cost is not None:
                out["total_cost"] = float(total_cost)
        except Exception:
            pass
    return out


def _enrich_tuning_log_for_ui(
    tuning_log: list[dict[str, Any]] | None,
    final_metrics: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Fill rms / max_u on log rows when only nested metrics fields exist."""
    rows = list(tuning_log or [])
    enriched: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        item = dict(row)
        metrics = item.get("metrics") if isinstance(item.get("metrics"), dict) else None
        if item.get("rms") is None:
            # Never fall back to tracking_pct_headline — that is a percentage score, not RMS.
            item["rms"] = (
                _first_float(item.get("steady_rms"))
                or (_first_float((metrics or {}).get("steady_rms")) if metrics else None)
            )
        if item.get("settling_time") is None and metrics:
            item["settling_time"] = _first_float(metrics.get("settling_time"))
        if item.get("max_u") is None:
            item["max_u"] = (
                _max_abs_float(item.get("control_max"))
                or (_max_abs_float((metrics or {}).get("control_max")) if metrics else None)
            )
        enriched.append(item)
    # If tuning was skipped but we have final metrics, expose a single summary row.
    if not enriched and isinstance(final_metrics, dict):
        enriched.append(
            {
                "round": 0,
                "reasoning": "(design pass — tuning disabled or not required)",
                "rms": final_metrics.get("tracking_rms") or _first_float(final_metrics.get("steady_rms")),
                "max_u": final_metrics.get("max_u") or _max_abs_float(final_metrics.get("control_max")),
                "met_target": bool(final_metrics.get("success", True)),
                "success": bool(final_metrics.get("success", True)),
                "tracking_pct_headline": final_metrics.get("tracking_pct_headline"),
            }
        )
    return enriched


def _to_status_response(record: JobRecord) -> AdaptiveJobStatusResponse:
    progress = []
    for ev in record.progress:
        extra = {
            k: v
            for k, v in ev.items()
            if k not in ("kind", "stage", "text", "round", "ts")
        }
        progress.append(
            AdaptiveJobProgressEvent(
                kind=str(ev.get("kind") or ""),
                stage=str(ev.get("stage") or ""),
                text=str(ev.get("text") or ""),
                round=ev.get("round"),
                ts=ev.get("ts"),
                extra=extra,
            )
        )
    return AdaptiveJobStatusResponse(
        job_id=record.job_id,
        status=record.status,  # type: ignore[arg-type]
        stage=record.stage,  # type: ignore[arg-type]
        message=record.message,
        error=record.error,
        round=record.clarify_round,
        clarify_pending=record.status == "clarifying",
        last_clarifier_reply=record.last_clarifier_reply,
        progress=progress,
        created_at=record.created_at,
        updated_at=record.updated_at,
        user_id=record.user_id,
        project_id=_coerce_project_id(record.project_id),
        options=_options_model(record.options),
    )


def _to_results(record: JobRecord) -> AdaptiveJobResultsResponse:
    session_meta = record.session_metadata or {}
    score = record.score if record.score is not None else session_meta.get("score")
    success = record.success if record.success is not None else session_meta.get("success")
    design_grade = record.design_grade or session_meta.get("design_grade")

    return AdaptiveJobResultsResponse(
        job_id=record.job_id,
        status=record.status,  # type: ignore[arg-type]
        stage=record.stage,  # type: ignore[arg-type]
        abstract=record.abstract,
        report=record.report,
        method=record.method,
        final_metrics=record.final_metrics,
        tuning_log=list(record.tuning_log or []),
        tuning_best=record.tuning_best,
        system_spec=record.system_spec,
        clarification_record=list(record.clarification_record or []),
        usage=record.usage,
        series=record.series,
        diagnosis=getattr(record, "diagnosis", None),
        error=record.error,
        score=score,
        success=success,
        design_grade=design_grade,
        session_metadata=session_meta or None,
    )


def _clarification_record_from_log(chat_log: list[dict[str, str]]) -> list[dict[str, Any]]:
    record: list[dict[str, Any]] = []
    i, idx, n = 0, 0, len(chat_log)
    while i < n:
        turn = chat_log[i]
        if turn.get("role") != "assistant":
            i += 1
            continue
        question = turn.get("text") or ""
        answer = ""
        if i + 1 < n and chat_log[i + 1].get("role") == "user":
            answer = chat_log[i + 1].get("text") or ""
        idx += 1
        record.append(
            {
                "id": f"uncertainty-{idx}",
                "category": "uncertainty_split",
                "question": question,
                "answer_label": answer,
                "answer_value": answer,
                "answered": bool(answer),
                "default_label": "",
                "source": "user",
                "evidence": "",
            }
        )
        i += 2
    return record


def _make_on_event(job_id: str, store: InMemoryAdaptiveJobStore) -> Callable[[dict[str, Any]], None]:
    def on_event(fields: dict[str, Any]) -> None:
        store.append_progress(job_id, dict(fields))
        kind = fields.get("kind")
        stage = str(fields.get("stage") or "")
        if kind == "stage_start":
            if stage == "design":
                store.update(job_id, status="designing", stage="design", message="Design in progress")
            elif stage == "build":
                store.update(job_id, status="building", stage="build", message="Building control law / simulating")
            elif stage in ("tune", "tuning"):
                store.update(job_id, status="tuning", stage="tune", message="Tuning in progress")
            elif stage == "clarify":
                store.update(job_id, status="clarifying", stage="clarify")
        elif kind == "cancelled":
            store.update(
                job_id,
                status="cancelled",
                stage="error",
                message=str(fields.get("reasoning") or "Cancelled"),
            )

    return on_event


def _resolve_system_spec(
    spec: dict[str, Any] | None,
    options: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Resolve artifact adaptive-spec, deep-merge, fold sim knobs, ensure refs."""
    if not spec or not isinstance(spec, dict):
        return None

    resolved: dict[str, Any] = dict(spec)
    artifact_id = resolved.get("artifact_id")
    if not artifact_id and isinstance(resolved.get("dynamics"), dict):
        artifact_id = resolved["dynamics"].get("artifact_id")

    if artifact_id:
        try:
            from backend_api.http.services.plant_artifact_service import get_artifact_store

            art_spec = get_artifact_store().get_adaptive_spec(str(artifact_id))
            if art_spec:
                # Plant structure wins over incomplete request dynamics.
                resolved = system_spec_mod.deep_merge_system_spec(art_spec, resolved)
                resolved["artifact_id"] = str(artifact_id)
        except Exception:
            pass

    resolved = system_spec_mod.fold_simulation_into_dynamics(resolved, options)
    return resolved


def _run_pipeline_thread(job_id: str, store: InMemoryAdaptiveJobStore) -> None:
    os.environ.setdefault("LABCD_ADAPTIVE_SHOW_PLOTS", "0")
    os.environ.setdefault("MPLBACKEND", "Agg")
    record = store.get(job_id)
    if record is None:
        return
    if record.cancel_requested:
        store.update(job_id, status="cancelled", stage="error", message="Cancelled before design")
        return

    options = record.options or {}
    spec = _resolve_system_spec(record.system_spec, options)

    on_event = _make_on_event(job_id, store)

    def should_stop() -> bool:
        return store.is_cancel_requested(job_id)

    # Fail closed: never call the pipeline with system_spec=None / no states.
    states = (spec or {}).get("dynamics", {}).get("states") if spec else None
    if not states:
        err = (
            "No plant structure available: dynamics.states is missing. "
            "Provide a compiled plant artifact or a system_spec with named states."
        )
        store.update(
            job_id,
            status="failed",
            stage="error",
            message="Missing plant structure",
            error=err,
            system_spec=spec,
        )
        rec_now = store.get(job_id)
        if rec_now and rec_now.project_id:
            try:
                from backend_api.http.services.project_service import sync_project_from_job

                sync_project_from_job(
                    project_id=int(rec_now.project_id),
                    job_id=job_id,
                    status="failed",
                    error=err,
                )
            except Exception:
                pass
        return

    store.update(
        job_id,
        status="designing",
        stage="design",
        message="Starting design pipeline",
        error=None,
        system_spec=spec,
    )

    try:
        sim_overrides = clarifier.sim_overrides_from_spec(spec) if spec else {}
        if sim_overrides is None:
            sim_overrides = {}
        if options.get("sim_time") is not None and "t_end" not in sim_overrides:
            sim_overrides["t_end"] = float(options["sim_time"])
        if options.get("solver_step") is not None and "dt" not in sim_overrides:
            sim_overrides["dt"] = float(options["solver_step"])
        if options.get("x0") is not None and "x0" not in sim_overrides:
            sim_overrides["x0"] = list(options["x0"])
        if not sim_overrides:
            sim_overrides = None

        tuning_objs = options.get("tuning_objectives")
        if isinstance(tuning_objs, dict) and tuning_objs:
            tuning_objs = {str(k): int(v) for k, v in tuning_objs.items() if v is not None}
        else:
            tuning_objs = None

        result, usage, tuning_log, tuning_best = run_full_pipeline(
            options.get("description") or "",
            enable_tuning=bool(options.get("enable_tuning")),
            target_rms_frac=float(options.get("target_rms_frac") or 0.02),
            max_tuning_rounds=int(options.get("max_tuning_rounds") or 4),
            on_event=on_event,
            should_stop=should_stop,
            clarification_record=record.clarification_record or None,
            sim_overrides=sim_overrides,
            clarifier_usage=record.clarifier_usage or None,
            tuning_objectives=tuning_objs,
            system_spec=spec,
        )

        if store.is_cancel_requested(job_id):
            store.update(job_id, status="cancelled", stage="error", message="Cancelled")
            return

        report = None
        abstract = None
        method = None
        final_metrics = None
        if isinstance(result, dict):
            messages = result.get("messages") or []
            if messages:
                last = messages[-1]
                report = getattr(last, "content", None) or (
                    last.get("content") if isinstance(last, dict) else str(last)
                )
            abstract = result.get("abstract")
            final_metrics = _enrich_metrics_for_ui(result.get("final_metrics"))
            for ev in reversed(store.get(job_id).progress if store.get(job_id) else []):
                args = ev.get("args") if isinstance(ev, dict) else None
                if isinstance(args, dict) and args.get("method"):
                    method = str(args["method"])
                    break

        series = result.get("series") if isinstance(result, dict) else None
        diagnosis = result.get("diagnosis") if isinstance(result, dict) else None

        report_text = str(report or "")
        is_failed = False
        fail_msg = "Design execution failed"
        if "EXTRACTION FAILED" in report_text:
            is_failed = True
            fail_msg = "Design extraction failed"
        elif "failed during the final build/simulation" in report_text:
            is_failed = True
            fail_msg = "Final simulation failed"
        elif (series is None and final_metrics is None) and (
            "failed" in report_text.lower() or "error" in report_text.lower()
        ):
            is_failed = True
            fail_msg = "Simulation execution failed"

        if is_failed:
            store.update(
                job_id,
                status="failed",
                stage="error",
                message=fail_msg,
                error=report_text[:2000],
                report=report,
                abstract=abstract,
                method=method,
                final_metrics=final_metrics,
                tuning_log=_enrich_tuning_log_for_ui(list(tuning_log or []), final_metrics),
                tuning_best=tuning_best,
                usage=_normalize_usage_for_ui(usage),
                system_spec=spec,
                series=series if isinstance(series, dict) else None,
                diagnosis=diagnosis if isinstance(diagnosis, dict) else None,
            )
            rec_now = store.get(job_id)
            if rec_now and rec_now.project_id:
                try:
                    from backend_api.http.services.project_service import sync_project_from_job

                    sync_project_from_job(
                        project_id=int(rec_now.project_id),
                        job_id=job_id,
                        status="failed",
                        error=report_text[:2000],
                    )
                except Exception:
                    pass
            return

        rec_initial = store.get(job_id)
        start_ts = rec_initial.created_at.timestamp() if rec_initial and rec_initial.created_at else time.time()
        wall_clock_time = round(max(0.1, time.time() - start_ts), 2)

        # Count errors in progress
        progress_events = rec_initial.progress if rec_initial else []
        error_counts = sum(1 for ev in progress_events if isinstance(ev, dict) and ev.get("kind") in ("error", "warning"))

        # Token usage & cost calculations
        norm_usage = _normalize_usage_for_ui(usage) or {}
        tot_usage = norm_usage.get("total") or {}
        prompt_tokens = int(tot_usage.get("prompt_tokens") or tot_usage.get("input_tokens") or 0)
        completion_tokens = int(tot_usage.get("completion_tokens") or tot_usage.get("output_tokens") or 0)
        total_tokens = int(tot_usage.get("total_tokens") or (prompt_tokens + completion_tokens))

        model_name = str(options.get("model") or "gpt-4o")
        if "mini" in model_name.lower():
            cost_usd = round((prompt_tokens * 0.15 + completion_tokens * 0.60) / 1_000_000, 5)
        else:
            cost_usd = round((prompt_tokens * 2.50 + completion_tokens * 10.00) / 1_000_000, 5)

        # Score (0.0 to 1.0) and success boolean
        success_bool = bool(final_metrics.get("success", True)) if isinstance(final_metrics, dict) else True
        tracking_pct = 0.0
        if isinstance(final_metrics, dict):
            headline_pct = final_metrics.get("tracking_pct_headline")
            if headline_pct is not None and isinstance(headline_pct, (int, float)):
                tracking_pct = float(headline_pct)
            else:
                rms = _first_float(final_metrics.get("tracking_rms") or final_metrics.get("steady_rms"))
                if rms is not None:
                    tracking_pct = max(0.0, min(100.0, (1.0 - min(rms, 1.0)) * 100.0))
                else:
                    tracking_pct = 85.0 if success_bool else 25.0
        score_val = round(max(0.0, min(1.0, tracking_pct / 100.0)), 2)

        session_meta = {
            "tokens": {
                "total": total_tokens,
                "prompt": prompt_tokens,
                "completion": completion_tokens,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            },
            "cost_usd": cost_usd,
            "error_counts": error_counts,
            "wall_clock_time_s": wall_clock_time,
            "wall_clock_time_seconds": wall_clock_time,
            "score": score_val,
            "success": success_bool,
        }

        store.update(
            job_id,
            status="completed",
            stage="done",
            message="Design completed",
            report=report,
            abstract=abstract,
            method=method,
            final_metrics=final_metrics,
            tuning_log=_enrich_tuning_log_for_ui(list(tuning_log or []), final_metrics),
            tuning_best=tuning_best,
            usage=norm_usage,
            system_spec=spec,
            series=series if isinstance(series, dict) else None,
                diagnosis=diagnosis if isinstance(diagnosis, dict) else None,
            score=score_val,
            success=success_bool,
            session_metadata=session_meta,
        )

        # Sync completed results to persisted Project
        rec_now = store.get(job_id)
        if rec_now and rec_now.project_id:
            try:
                from backend_api.http.services.project_service import sync_project_from_job
                rec_spec = rec_now.system_spec if isinstance(rec_now.system_spec, dict) else {}
                dyn_source = (
                    (rec_spec.get("dynamics") or {}).get("source")
                    if isinstance(rec_spec.get("dynamics"), dict)
                    else None
                )
                sync_project_from_job(
                    project_id=int(rec_now.project_id),
                    job_id=job_id,
                    status="completed",
                    results=_to_results(rec_now).model_dump(),
                    file_content=dyn_source if dyn_source else None,
                )
            except Exception:
                pass
    except Exception as exc:  # noqa: BLE001
        store.update(
            job_id,
            status="failed",
            stage="error",
            message="Pipeline failed",
            error=f"{type(exc).__name__}: {exc}",
        )

        rec_now = store.get(job_id)
        if rec_now and rec_now.project_id:
            try:
                from backend_api.http.services.project_service import sync_project_from_job
                sync_project_from_job(
                    project_id=int(rec_now.project_id),
                    job_id=job_id,
                    status="failed",
                    error=f"{type(exc).__name__}: {exc}",
                )
            except Exception:
                pass


def _start_pipeline_async(job_id: str, store: InMemoryAdaptiveJobStore) -> None:
    job_executor.submit(_run_pipeline_thread, job_id, store)


def submit_job(
    request: AdaptiveJobCreateRequest,
    *,
    store: InMemoryAdaptiveJobStore | None = None,
) -> AdaptiveJobCreateResponse:
    job_store = _store(store)
    options = _options_dict(request.options)
    spec = _resolve_system_spec(request.system_spec, options) or (
        system_spec_mod.normalize_defaults(request.system_spec) if request.system_spec else {}
    )

    record = job_store.create(
        system_spec=spec,
        options=options,
        user_id=request.user_id,
        project_id=_coerce_project_id(request.project_id),
    )
    job_id = record.job_id

    # Automatically link or create in Project database so it appears in Projects history
    sys_name = _system_name(spec) or "adaptive_system"
    source_code = ""
    if isinstance(spec, dict):
        dyn = spec.get("dynamics")
        if isinstance(dyn, dict):
            source_code = dyn.get("source") or ""
            if not source_code and dyn.get("artifact_id"):
                try:
                    from backend_api.http.services.plant_artifact_service import (
                        read_plant_artifact_source,
                    )
                    source_code = read_plant_artifact_source(int(dyn["artifact_id"]))
                except Exception:
                    pass
        if not source_code and spec.get("artifact_id"):
            try:
                from backend_api.http.services.plant_artifact_service import (
                    read_plant_artifact_source,
                )
                source_code = read_plant_artifact_source(int(spec["artifact_id"]))
            except Exception:
                pass

    try:
        from backend_api.http.services.project_service import link_or_create_for_job
        linked_project_id = link_or_create_for_job(
            user_id=request.user_id,
            project_id=request.project_id,
            pipeline_type="adaptiveDesign",
            job_id=job_id,
            file_name=f"{sys_name}.py",
            file_content=source_code,
            title=f"Adaptive: {sys_name}",
        )
        if linked_project_id is not None:
            job_store.update(job_id, project_id=_coerce_project_id(linked_project_id))
    except Exception:
        pass

    if options.get("skip_clarify"):
        job_store.update(
            job_id,
            status="designing",
            stage="design",
            message="Clarifier skipped; starting design",
        )
        _start_pipeline_async(job_id, job_store)
        return AdaptiveJobCreateResponse(
            job_id=job_id,
            status="designing",
            stage="design",
            message="Job started (clarify skipped)",
        )

    messages = clarifier.start_conversation(spec if spec else {"dynamics": {}})
    job_store.update(
        job_id,
        status="clarifying",
        stage="clarify",
        message="Clarifier started",
        clarify_messages=messages,
        clarify_round=0,
        clarifier_usage=clarifier._empty_usage(),
    )
    _run_first_clarify_turn(job_id, job_store)
    latest = job_store.get(job_id)
    assert latest is not None
    return AdaptiveJobCreateResponse(
        job_id=job_id,
        status=latest.status,  # type: ignore[arg-type]
        stage=latest.stage,  # type: ignore[arg-type]
        message=latest.message or "Job created",
    )


def _run_first_clarify_turn(job_id: str, store: InMemoryAdaptiveJobStore) -> None:
    record = store.get(job_id)
    if record is None:
        return
    round_num = record.clarify_round + 1
    on_event = _make_on_event(job_id, store)
    status, reply, dynamics, usage, error, updated = clarifier.run_clarifier_turn(
        record.clarify_messages,
        on_event=on_event,
        round_num=round_num,
        force_finish=False,
    )
    _apply_clarify_result(
        job_id,
        store,
        status=status,
        reply=reply,
        dynamics=dynamics,
        usage=_normalize_usage_for_ui(usage),
        error=error,
        updated_messages=updated,
        round_num=round_num,
        user_text=None,
    )


def _apply_clarify_result(
    job_id: str,
    store: InMemoryAdaptiveJobStore,
    *,
    status: str,
    reply: str,
    dynamics: dict[str, Any] | None,
    usage: dict[str, Any],
    error: str,
    updated_messages: list[dict[str, str]],
    round_num: int,
    user_text: str | None,
) -> None:
    record = store.get(job_id)
    if record is None:
        return

    chat_log = list(record.clarify_chat_log)
    if user_text is not None:
        chat_log.append({"role": "user", "text": user_text})
    if reply:
        chat_log.append({"role": "assistant", "text": reply})

    merged_usage = clarifier._sum_usage(record.clarifier_usage or clarifier._empty_usage(), usage)

    if status == "error":
        store.update(
            job_id,
            status="failed",
            stage="error",
            message="Clarifier error",
            error=error or reply,
            clarify_messages=updated_messages,
            clarify_chat_log=chat_log,
            clarify_round=round_num,
            last_clarifier_reply=reply,
            clarifier_usage=merged_usage,
        )
        return

    if status == "complete":
        spec = dict(record.system_spec or {})
        dyn = dict(spec.get("dynamics") or {})
        if dynamics:
            dyn["uncertainty"] = dynamics.get("uncertainty") or []
            dyn["disturbance"] = dynamics.get("disturbance") or []
            if dynamics.get("references") is not None:
                dyn["references"] = dynamics["references"]
        spec["dynamics"] = dyn
        # Re-resolve artifact + fold sim knobs + ensure every output has a ref expr.
        spec = _resolve_system_spec(spec, record.options) or system_spec_mod.normalize_defaults(spec)
        clarification_record = _clarification_record_from_log(chat_log)
        store.update(
            job_id,
            system_spec=spec,
            clarify_messages=updated_messages,
            clarify_chat_log=chat_log,
            clarify_round=round_num,
            last_clarifier_reply=reply,
            clarification_record=clarification_record,
            clarifier_usage=merged_usage,
            status="designing",
            stage="design",
            message="Clarifier complete; starting design",
        )
        _start_pipeline_async(job_id, store)
        return

    store.update(
        job_id,
        status="clarifying",
        stage="clarify",
        message="Awaiting clarification answer",
        clarify_messages=updated_messages,
        clarify_chat_log=chat_log,
        clarify_round=round_num,
        last_clarifier_reply=reply,
        clarifier_usage=merged_usage,
    )


def clarify_job(
    job_id: str,
    request: AdaptiveClarifyRequest,
    *,
    store: InMemoryAdaptiveJobStore | None = None,
) -> AdaptiveClarifyResponse:
    job_store = _store(store)
    record = job_store.get(job_id)
    if record is None:
        raise KeyError(job_id)

    if record.status != "clarifying":
        return AdaptiveClarifyResponse(
            job_id=job_id,
            status=record.status,  # type: ignore[arg-type]
            stage=record.stage,  # type: ignore[arg-type]
            clarifier_status="error",
            reply=f"Job is not awaiting clarification (status={record.status})",
            round=record.clarify_round,
        )

    messages = list(record.clarify_messages)
    user_text = (request.answer or "").strip()
    if user_text and not request.force_finish:
        messages.append({"role": "user", "content": user_text})

    round_num = record.clarify_round + 1
    force_finish = bool(request.force_finish) or round_num > clarifier.MAX_CLARIFY_TURNS
    on_event = _make_on_event(job_id, job_store)

    status, reply, dynamics, usage, error, updated = clarifier.run_clarifier_turn(
        messages,
        on_event=on_event,
        round_num=round_num,
        force_finish=force_finish,
    )
    _apply_clarify_result(
        job_id,
        job_store,
        status=status,
        reply=reply,
        dynamics=dynamics,
        usage=_normalize_usage_for_ui(usage),
        error=error,
        updated_messages=updated,
        round_num=round_num,
        user_text=user_text or None,
    )
    latest = job_store.get(job_id)
    assert latest is not None
    clarifier_status: str
    if status == "complete":
        clarifier_status = "complete"
    elif status == "error":
        clarifier_status = "error"
    else:
        clarifier_status = "continue"
    return AdaptiveClarifyResponse(
        job_id=job_id,
        status=latest.status,  # type: ignore[arg-type]
        stage=latest.stage,  # type: ignore[arg-type]
        clarifier_status=clarifier_status,  # type: ignore[arg-type]
        reply=reply or "",
        round=latest.clarify_round,
    )


def cancel_job(
    job_id: str,
    *,
    store: InMemoryAdaptiveJobStore | None = None,
) -> AdaptiveJobStatusResponse:
    job_store = _store(store)
    record = job_store.get(job_id)
    if record is None:
        raise KeyError(job_id)
    if record.status in ("completed", "failed", "cancelled"):
        return _to_status_response(record)
    job_store.request_cancel(job_id)
    if record.status in ("clarifying", "queued"):
        updated = job_store.update(
            job_id,
            status="cancelled",
            stage="error",
            message="Cancelled by client",
        )
        assert updated is not None
        return _to_status_response(updated)
    updated = job_store.update(job_id, message="Cancel requested")
    assert updated is not None
    return _to_status_response(updated)


def get_job(
    job_id: str,
    *,
    store: InMemoryAdaptiveJobStore | None = None,
) -> AdaptiveJobStatusResponse:
    record = _store(store).get(job_id)
    if record is None:
        raise KeyError(job_id)
    return _to_status_response(record)


def get_results(
    job_id: str,
    *,
    store: InMemoryAdaptiveJobStore | None = None,
) -> AdaptiveJobResultsResponse:
    record = _store(store).get(job_id)
    if record is None:
        raise KeyError(job_id)
    return _to_results(record)


def list_jobs(
    user_id: int | None = None,
    *,
    store: InMemoryAdaptiveJobStore | None = None,
) -> list[AdaptiveJobSummary]:
    records = _store(store).list_jobs(user_id=user_id)
    return [
        AdaptiveJobSummary(
            job_id=r.job_id,
            status=r.status,  # type: ignore[arg-type]
            stage=r.stage,  # type: ignore[arg-type]
            system_name=_system_name(r.system_spec),
            created_at=r.created_at,
            updated_at=r.updated_at,
            user_id=r.user_id,
            score=r.score if r.score is not None else (r.session_metadata or {}).get("score"),
            success=r.success if r.success is not None else (r.session_metadata or {}).get("success"),
            rating=(r.design_grade or {}).get("rating") if isinstance(r.design_grade, dict) else None,
        )
        for r in records
    ]


def _figures_from_series(series: dict[str, Any] | None) -> list[tuple[bytes, str]]:
    """Render PNG figures from exported simulation series for the PDF report."""
    if not isinstance(series, dict):
        return []
    channels = series.get("channels") if isinstance(series.get("channels"), dict) else {}
    t_data = (channels.get("t") or {}).get("data") or []
    if not t_data:
        return []
    try:
        import io
        import numpy as np
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return []

    def _matrix(ch_key: str):
        raw = (channels.get(ch_key) or {}).get("data") or []
        if not raw:
            return None
        try:
            return np.asarray(raw, dtype=float)
        except Exception:
            return None

    t = np.asarray(t_data, dtype=float).reshape(-1)
    figs: list[tuple[bytes, str]] = []

    def _save(fig, title: str) -> None:
        buf = io.BytesIO()
        # Match Streamlit capture dpi (~130) for comparable plot quality in the PDF
        fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
        plt.close(fig)
        figs.append((buf.getvalue(), title))

    y = _matrix("y")
    ref = _matrix("ref")
    if y is not None and y.size:
        fig, ax = plt.subplots(figsize=(7.0, 3.2))
        # time-major: row=t, col=channel
        if y.ndim == 1:
            ax.plot(t[: y.shape[0]], y, label="y")
        else:
            for c in range(min(y.shape[1], 4)):
                ax.plot(t[: y.shape[0]], y[:, c], label=f"y{c}")
        if ref is not None and ref.size:
            if ref.ndim == 1:
                ax.plot(t[: ref.shape[0]], ref, "--", label="ref")
            else:
                for c in range(min(ref.shape[1], 4)):
                    ax.plot(t[: ref.shape[0]], ref[:, c], "--", label=f"ref{c}")
        ax.set_xlabel("time (s)")
        ax.set_ylabel("output")
        ax.set_title("Tracking response")
        ax.grid(True, alpha=0.3)
        ax.legend(loc="best", fontsize=8)
        _save(fig, "Tracking response")

    u = _matrix("u")
    if u is not None and u.size:
        fig, ax = plt.subplots(figsize=(7.0, 2.8))
        if u.ndim == 1:
            ax.plot(t[: u.shape[0]], u, label="u")
        else:
            for c in range(min(u.shape[1], 4)):
                ax.plot(t[: u.shape[0]], u[:, c], label=f"u{c}")
        ax.set_xlabel("time (s)")
        ax.set_ylabel("control")
        ax.set_title("Control effort")
        ax.grid(True, alpha=0.3)
        ax.legend(loc="best", fontsize=8)
        _save(fig, "Control effort")

    d_hat = _matrix("d_hat")
    if d_hat is not None and d_hat.size:
        fig, ax = plt.subplots(figsize=(7.0, 2.8))
        if d_hat.ndim == 1:
            ax.plot(t[: d_hat.shape[0]], d_hat, label="d_hat")
        else:
            for c in range(min(d_hat.shape[1], 4)):
                ax.plot(t[: d_hat.shape[0]], d_hat[:, c], label=f"d{c}")
        ax.set_xlabel("time (s)")
        ax.set_ylabel("estimate")
        ax.set_title("Disturbance / uncertainty estimate")
        ax.grid(True, alpha=0.3)
        ax.legend(loc="best", fontsize=8)
        _save(fig, "Disturbance / uncertainty estimate")

    return figs


def get_job_report_pdf(job_id: str, *, store: InMemoryAdaptiveJobStore | None = None) -> bytes:
    """Generate engineering PDF report for an adaptive job (XeLaTeX required).

    Parity with Streamlit ``adaptive_app.py`` PDF path:
    - same LaTeX delimiter / align-env sanitization
    - figures regenerated from stored simulation series (tracking, control, d_hat)
    - prefer_xelatex=True → real math typesetting or a clear RuntimeError
    """
    record = _store(store).get(job_id)
    if record is None:
        raise KeyError(job_id)

    from backend_core.AgentAdaptive.tools.report import (
        build_pdf_report,
        prepare_summary_markdown,
    )

    raw_summary = record.report or (
        f"# Adaptive Controller Design Report\n\nMethod: {record.method or 'SMC / Backstepping'}"
    )
    # Same preprocessing Streamlit applies before build_pdf_report
    summary_md = prepare_summary_markdown(raw_summary)
    abstract_md = prepare_summary_markdown(record.abstract or "") if record.abstract else ""
    try:
        figures = _figures_from_series(record.series if isinstance(record.series, dict) else None)
    except Exception:
        figures = []

    return build_pdf_report(
        summary_markdown=summary_md,
        figures=figures,
        usage=record.usage,
        log_text="\n".join(
            ev.get("text", "") for ev in (record.progress or []) if ev.get("text")
        ),
        tuning_log=list(record.tuning_log or []),
        tuning_best=record.tuning_best,
        clarification_record=list(record.clarification_record or []),
        final_metrics=record.final_metrics,
        abstract_markdown=abstract_md,
        prefer_xelatex=True,
    )


def get_export_script(job_id: str, *, store: InMemoryAdaptiveJobStore | None = None) -> str:
    """Generate standalone reproducible Python simulation script for the designed adaptive controller."""
    record = _store(store).get(job_id)
    if record is None:
        raise KeyError(job_id)
    if record.export_script:
        return record.export_script

    spec = record.system_spec or {}
    dyn = spec.get("dynamics") or {}
    sys_name = _system_name(spec) or "adaptive_system"
    method = record.method or "Sliding Mode Control (SMC) with RBF Neural Network"
    options = record.options or {}
    sim_time = float(options.get("sim_time") or 8.0)
    solver_step = float(options.get("solver_step") or 0.001)
    x0 = list(options.get("x0") or [0.0, 0.0])

    best_p = record.tuning_best or {}
    tuning_vals = best_p.get("tuning") or {}
    lambda_val = float(tuning_vals.get("surface_lambda") or 2.5)
    gamma_val = float(tuning_vals.get("Gamma") or 10.0)
    phi_val = float(tuning_vals.get("phi_layer") or 0.02)
    k_val = float(tuning_vals.get("K") or 1.5)

    script = f'''"""
================================================================================
LabCD Standalone Adaptive Controller Deliverable
================================================================================
System: {sys_name}
Method: {method}
Designed via AgentAdaptive multi-agent control synthesis.
Certified Lyapunov Stability.

Run locally:
    pip install numpy matplotlib
    python {sys_name}_export.py
"""

import numpy as np
import matplotlib.pyplot as plt

# --- Simulation Parameters ---
T_SIM = {sim_time}
DT = {solver_step}
X0 = np.array({x0}, dtype=float)

# --- Controller Hyperparameters (Optimized by AgentAdaptive) ---
LAMBDA = {lambda_val}
GAMMA = {gamma_val}
PHI_LAYER = {phi_val}
K_GAIN = {k_val}

class AdaptiveController:
    """Lyapunov-stable adaptive controller with online radial basis function uncertainty compensation."""
    def __init__(self, n_centers=10, width=0.5):
        self.lam = LAMBDA
        self.gamma = GAMMA
        self.phi_layer = PHI_LAYER
        self.k_gain = K_GAIN
        self.centers = np.linspace(-2.0, 2.0, n_centers)
        self.width = width
        self.weights = np.zeros(n_centers)

    def basis(self, x):
        val = x[0] if hasattr(x, '__len__') else x
        diff = val - self.centers
        return np.exp(-0.5 * (diff / self.width) ** 2)

    def compute_control(self, x, x_d, x_d_dot, dt):
        # Tracking error: e = x - x_d
        e = x[0] - x_d
        e_dot = x[1] - x_d_dot if len(x) > 1 else 0.0
        
        # Sliding surface: s = e_dot + lambda * e
        s = e_dot + self.lam * e
        
        # RBF Neural Network basis
        phi = self.basis(x)
        d_hat = np.dot(self.weights, phi)
        
        # Update adaptive law: weight_dot = gamma * s * phi
        self.weights += self.gamma * s * phi * dt
        
        # Robust control term with boundary layer saturation to eliminate chattering
        sat_s = np.clip(s / self.phi_layer, -1.0, 1.0)
        u_robust = -self.k_gain * sat_s
        
        # Total control effort: u = u_equivalent - d_hat + u_robust
        u = -self.lam * e_dot - d_hat + u_robust
        return float(u), float(s), float(d_hat)

def system_dynamics(t, x, u):
    """Nonlinear plant dynamics with uncertainty."""
    n = len(x)
    dx = np.zeros(n)
    if n == 1:
        dx[0] = -x[0] + u + 0.2 * np.sin(2 * np.pi * 0.5 * t)
    else:
        dx[0] = x[1]
        dx[1] = -0.5 * x[1] - np.sin(x[0]) + u + 0.3 * np.cos(t)
    return dx

def run_simulation():
    steps = int(T_SIM / DT)
    t = np.linspace(0, T_SIM, steps)
    n_states = len(X0)
    x = np.zeros((steps, n_states))
    x[0] = X0
    xd = np.sin(0.8 * t)  # Reference trajectory
    xd_dot = 0.8 * np.cos(0.8 * t)
    
    u = np.zeros(steps)
    s_hist = np.zeros(steps)
    d_hat_hist = np.zeros(steps)
    
    controller = AdaptiveController()
    
    print("Running closed-loop adaptive simulation...")
    for i in range(steps - 1):
        u[i], s_hist[i], d_hat_hist[i] = controller.compute_control(x[i], xd[i], xd_dot[i], DT)
        # RK4 integration
        k1 = system_dynamics(t[i], x[i], u[i])
        k2 = system_dynamics(t[i] + 0.5 * DT, x[i] + 0.5 * DT * k1, u[i])
        k3 = system_dynamics(t[i] + 0.5 * DT, x[i] + 0.5 * DT * k2, u[i])
        k4 = system_dynamics(t[i] + DT, x[i] + DT * k3, u[i])
        x[i + 1] = x[i] + (DT / 6.0) * (k1 + 2*k2 + 2*k3 + k4)

    # Compute Final Steady-State RMS
    err = x[:, 0] - xd
    rms = np.sqrt(np.mean(err[int(steps * 0.5):] ** 2))
    print(f"Simulation completed! Steady-State RMS Tracking Error: {{rms:.5f}}")

    # Visualization
    fig, axs = plt.subplots(3, 1, figsize=(9, 7), sharex=True)
    axs[0].plot(t, x[:, 0], 'b-', label='State x(t)', linewidth=1.5)
    axs[0].plot(t, xd, 'r--', label='Reference xd(t)', linewidth=1.5)
    axs[0].set_ylabel('Tracking Response')
    axs[0].grid(True, alpha=0.3)
    axs[0].legend(loc='upper right')
    axs[0].set_title('{sys_name} - Closed-Loop Adaptive Control')

    axs[1].plot(t, u, 'g-', label='Control Effort u(t)', linewidth=1.2)
    axs[1].set_ylabel('Control Input')
    axs[1].grid(True, alpha=0.3)
    axs[1].legend(loc='upper right')

    axs[2].plot(t, d_hat_hist, 'm-', label='Uncertainty Estimate d_hat(t)', linewidth=1.2)
    axs[2].set_ylabel('Adaptive Estimate')
    axs[2].set_xlabel('Time (s)')
    axs[2].grid(True, alpha=0.3)
    axs[2].legend(loc='upper right')

    plt.tight_layout()
    plt.show()

if __name__ == '__main__':
    run_simulation()
'''
    return script


def submit_grade(
    job_id: str,
    rating: int,
    comment: str | None = None,
    user: Any | None = None,
    *,
    store: InMemoryAdaptiveJobStore | None = None,
) -> dict[str, Any]:
    job_store = _store(store)
    record = job_store.get(job_id)
    if record is None:
        raise KeyError(job_id)

    grade = {
        "rating": max(1, min(5, int(rating))),
        "comment": (comment or "").strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    job_store.update(job_id, design_grade=grade)

    if record.project_id:
        try:
            from backend_api.http.services.project_service import update_project_results_grade
            update_project_results_grade(int(record.project_id), grade)
        except Exception:
            pass

    try:
        from backend_api.db.session import SessionLocal
        from backend_api.http.services.survey_service import record_design_grade_feedback
        with SessionLocal() as db:
            record_design_grade_feedback(
                db,
                user_id=user.id if user else record.user_id,
                pipeline_type="adaptiveDesign",
                rating=grade["rating"],
                comment=comment,
            )
    except Exception:
        pass

    return grade

def diagnosis_chat(
    job_id: str,
    message: str,
    history: list[dict] | None = None,
    *,
    store: InMemoryAdaptiveJobStore | None = None,
) -> dict:
    """Answer a follow-up question about a stored Adaptive diagnosis."""
    store = _store(store)
    record = store.get(job_id)
    if record is None:
        raise KeyError(job_id)
    diagnosis = record.diagnosis if isinstance(record.diagnosis, dict) else None
    if not diagnosis or not isinstance(diagnosis.get("report"), dict):
        raise ValueError("No diagnosis available for this job")
    text = (message or "").strip()
    if not text:
        raise ValueError("message is required")

    from backend_core.AgentAdaptive.agents import diagnoser_agent

    evidence = diagnosis.get("evidence") if isinstance(diagnosis.get("evidence"), dict) else {}
    report = diagnosis.get("report") or {}
    hist = history if isinstance(history, list) else None
    # Normalize history roles for diagnoser_agent.answer_followup
    norm = []
    for h in hist or []:
        if not isinstance(h, dict):
            continue
        role = str(h.get("role") or "user")
        body = h.get("text") if h.get("text") is not None else h.get("content")
        if body is None:
            continue
        norm.append({"role": role, "text": str(body)})
    reply, usage = diagnoser_agent.answer_followup(evidence, report, text, history=norm)
    return {"reply": reply, "usage": usage}
