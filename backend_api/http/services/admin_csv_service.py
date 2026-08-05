"""CSV exports for admin panel modules."""

from __future__ import annotations

import csv
import io
import json
from collections import defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from backend_api.common.csv_utils import rows_to_csv
from backend_api.db.models import ErrorEvent, FeedbackSurveyResponse, Project, User
from backend_api.http.services import (
    error_tracking_service,
    monitoring_service,
    plan_service,
    project_service,
    survey_service,
)
from backend_api.http.services.profile_service import user_out

USER_CSV_FIELDS = [
    "id",
    "email",
    "display_name",
    "is_admin",
    "is_active",
    "plan_id",
    "plan_name",
    "modules",
    "created_at",
]

PROJECT_CSV_FIELDS = [
    "id",
    "user_id",
    "owner_email",
    "title",
    "pipeline_type",
    "pipeline_label",
    "status",
    "file_name",
    "file_type",
    "has_results",
    "job_id",
    "created_at",
    "updated_at",
]

# Project row used in "Download all Data" — identity + inline summary metrics.
OVERVIEW_PROJECT_CSV_FIELDS = [
    *PROJECT_CSV_FIELDS[:-2],
    # Single Loop summary (siloDesign)
    "silo_scenarios_completed",
    "silo_scenarios_total",
    "silo_avg_success_score",
    "silo_total_api_failures",
    "silo_avg_cost_per_success",
    "silo_total_tokens_in",
    "silo_total_tokens_out",
    "silo_total_wall_clock_s",
    "silo_total_cost",
    # Multi Loop — Recommender summary
    "mulo_recommender_success",
    "mulo_recommender_flag",
    "mulo_recommender_best_score",
    "mulo_recommender_cost",
    "mulo_recommender_input_tokens",
    "mulo_recommender_output_tokens",
    "mulo_recommender_total_tokens",
    "mulo_recommender_error",
    # Multi Loop — Trimmer summary
    "mulo_trimmer_success",
    "mulo_trimmer_flag",
    "mulo_trimmer_cost",
    "mulo_trimmer_input_tokens",
    "mulo_trimmer_output_tokens",
    "mulo_trimmer_total_tokens",
    "mulo_trimmer_error",
    "created_at",
    "updated_at",
]

PROFILE_SURVEY_CSV_FIELDS = [
    "user_id",
    "email",
    "university",
    "degree",
    "major",
    "matlab_experience",
    "control_design_experience",
    "completed_at",
]

FEEDBACK_SURVEY_CSV_FIELDS = [
    "user_id",
    "email",
    "pipeline_type",
    "satisfaction",
    "ease_of_use",
    "product_value",
    "confidence",
    "reuse_intention",
    "willingness_to_pay",
    "main_problems",
    "created_at",
]

ERROR_CSV_FIELDS = [
    "id",
    "created_at",
    "source",
    "message",
    "stack_trace",
    "path",
    "method",
    "status_code",
    "user_id",
    "user_agent",
    "page_url",
]


SESSION_SUMMARY_CSV_FIELDS = [
    "project_id",
    "user_id",
    "owner_email",
    "title",
    "pipeline_type",
    "pipeline_label",
    "status",
    "scenarios_completed",
    "scenarios_total",
    "avg_success_score",
    "total_api_failures",
    "avg_cost_per_success",
    "total_tokens_in",
    "total_tokens_out",
    "total_wall_clock_s",
    "total_cost",
    "created_at",
    "updated_at",
]

SCENARIO_SUMMARY_CSV_FIELDS = [
    "project_id",
    "user_id",
    "owner_email",
    "title",
    "pipeline_type",
    "pipeline_label",
    "status",
    "scenario_level",
    "timestamp",
    "controller_type",
    "stable",
    "score",
    "controller_latency_s",
    "api_failures",
    "cost_per_success",
    "tokens_in",
    "tokens_out",
    "time_s",
    "cost",
]

BEST_CONTROLLER_CSV_FIELDS = [
    "project_id",
    "user_id",
    "owner_email",
    "title",
    "pipeline_type",
    "pipeline_label",
    "status",
    "scenario_level",
    "controller_type",
    "stable",
    "score",
    "mse",
    "gains_json",
    "created_at",
    "updated_at",
]


def _pipeline_label(pipeline_type: str) -> str:
    if pipeline_type == "siloDesign":
        return "Single Loop"
    if pipeline_type == "muloDesign":
        return "Multi Loop"
    return pipeline_type or ""


def _blank_overview_summary_fields() -> dict[str, Any]:
    return {key: "" for key in OVERVIEW_PROJECT_CSV_FIELDS if key not in PROJECT_CSV_FIELDS}


def _iso(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.isoformat()


def _join(values: list[str] | None) -> str:
    if not values:
        return ""
    return ";".join(values)


def _user_csv_row(user: User) -> dict[str, Any]:
    out = user_out(user)
    return {
        "id": out.id,
        "email": out.email,
        "display_name": out.display_name or "",
        "is_admin": out.is_admin,
        "is_active": out.is_active,
        "plan_id": out.plan_id if out.plan_id is not None else "",
        "plan_name": out.plan_name or "",
        "modules": _join(out.actions),
        "created_at": _iso(out.created_at),
    }


def _project_csv_row(project: Project) -> dict[str, Any]:
    data = project_service.project_to_summary(project, include_owner=True)
    return {
        "id": data["id"],
        "user_id": data["user_id"],
        "owner_email": data["owner_email"] or "",
        "title": data["title"],
        "pipeline_type": data["pipeline_type"],
        "pipeline_label": _pipeline_label(str(data["pipeline_type"])),
        "status": data["status"],
        "file_name": data["file_name"],
        "file_type": data["file_type"],
        "has_results": data["has_results"],
        "job_id": data["job_id"] or "",
        "created_at": _iso(data["created_at"]),
        "updated_at": _iso(data["updated_at"]),
    }


def _workflow_summary_fields(summary: dict[str, Any] | None, *, prefix: str) -> dict[str, Any]:
    if not summary:
        keys = [
            f"{prefix}_success",
            f"{prefix}_flag",
            f"{prefix}_cost",
            f"{prefix}_input_tokens",
            f"{prefix}_output_tokens",
            f"{prefix}_total_tokens",
            f"{prefix}_error",
        ]
        if prefix.endswith("recommender"):
            keys.insert(2, f"{prefix}_best_score")
        return {key: "" for key in keys}

    tokens = summary.get("token_usage")
    tokens = tokens if isinstance(tokens, dict) else {}
    best_score = summary.get("best_score")
    price = summary.get("price")
    fields: dict[str, Any] = {
        f"{prefix}_success": bool(summary.get("success", False)),
        f"{prefix}_flag": summary.get("flag") or "",
        f"{prefix}_cost": (
            round(float(price), 6)
            if isinstance(price, (int, float)) and not isinstance(price, bool)
            else ""
        ),
        f"{prefix}_input_tokens": int(_num(tokens.get("input_tokens"))),
        f"{prefix}_output_tokens": int(_num(tokens.get("output_tokens"))),
        f"{prefix}_total_tokens": int(_num(tokens.get("total_tokens"))),
        f"{prefix}_error": summary.get("error") or "",
    }
    if prefix.endswith("recommender"):
        fields[f"{prefix}_best_score"] = (
            round(float(best_score), 4)
            if isinstance(best_score, (int, float)) and not isinstance(best_score, bool)
            else ""
        )
    return fields


def _overview_project_csv_row(project: Project) -> dict[str, Any]:
    """Project identity plus inline single/multi-loop summary metrics."""
    row = {**_blank_overview_summary_fields(), **_project_csv_row(project)}

    if project.pipeline_type == "siloDesign":
        history = _scenario_metrics_history(project.results)
        if history:
            aggregates = _session_profiling_aggregates(history)
            row.update(
                {
                    "silo_scenarios_completed": aggregates["scenarios_completed"],
                    "silo_scenarios_total": aggregates["scenarios_total"],
                    "silo_avg_success_score": aggregates["avg_success_score"],
                    "silo_total_api_failures": aggregates["total_api_failures"],
                    "silo_avg_cost_per_success": aggregates["avg_cost_per_success"],
                    "silo_total_tokens_in": aggregates["total_tokens_in"],
                    "silo_total_tokens_out": aggregates["total_tokens_out"],
                    "silo_total_wall_clock_s": aggregates["total_wall_clock_s"],
                    "silo_total_cost": aggregates["total_cost"],
                }
            )
        return row

    if project.pipeline_type == "muloDesign":
        row.update(
            _workflow_summary_fields(
                _workflow_summary_dict(project.results, "recommender_summary"),
                prefix="mulo_recommender",
            )
        )
        row.update(
            _workflow_summary_fields(
                _workflow_summary_dict(project.results, "trimmer_summary"),
                prefix="mulo_trimmer",
            )
        )
    return row


def _profile_survey_csv_row(user: User) -> dict[str, Any]:
    return {
        "user_id": user.id,
        "email": user.email,
        "university": user.university or "",
        "degree": user.degree or "",
        "major": user.major or "",
        "matlab_experience": user.matlab_experience or "",
        "control_design_experience": user.control_design_experience or "",
        "completed_at": _iso(user.profile_survey_completed_at),
    }


def _feedback_survey_csv_row(
    response: FeedbackSurveyResponse,
    user: User,
) -> dict[str, Any]:
    return {
        "user_id": user.id,
        "email": user.email,
        "pipeline_type": response.pipeline_type,
        "satisfaction": response.satisfaction,
        "ease_of_use": response.ease_of_use,
        "product_value": response.product_value,
        "confidence": response.confidence,
        "reuse_intention": response.reuse_intention,
        "willingness_to_pay": response.willingness_to_pay,
        "main_problems": response.main_problems or "",
        "created_at": _iso(response.created_at),
    }


def export_users_csv(db: Session) -> str:
    users = db.query(User).order_by(User.email).all()
    rows = [_user_csv_row(user) for user in users]
    return rows_to_csv(rows, USER_CSV_FIELDS)


def export_plans_csv(db: Session) -> str:
    default_plan = plan_service.get_default_plan(db)
    default_plan_id = default_plan.id if default_plan else None
    fieldnames = [
        "id",
        "name",
        "description",
        "price",
        "is_active",
        "is_default",
        "modules",
        "models",
        "created_at",
    ]
    rows = []
    for plan in plan_service.list_plans(db):
        data = plan_service.plan_out_dict(plan)
        rows.append(
            {
                "id": data["id"],
                "name": data["name"],
                "description": data["description"],
                "price": data["price"],
                "is_active": data["is_active"],
                "is_default": plan.id == default_plan_id,
                "modules": _join(data["actions"]),
                "models": _join(data["models"]),
                "created_at": _iso(data["created_at"]),
            }
        )
    return rows_to_csv(rows, fieldnames)


def export_projects_csv(
    db: Session,
    *,
    user_id: int | None = None,
    pipeline_type: str | None = None,
) -> str:
    projects = project_service.list_all_projects(
        db,
        user_id=user_id,
        pipeline_type=pipeline_type,
    )
    rows = [_project_csv_row(project) for project in projects]
    return rows_to_csv(rows, PROJECT_CSV_FIELDS)


def _scenario_metrics_history(results: Any) -> list[dict[str, Any]]:
    if not isinstance(results, dict):
        return []
    monitor_state = results.get("monitor_state")
    if not isinstance(monitor_state, dict):
        return []
    history = monitor_state.get("scenario_metrics_history")
    if not isinstance(history, list):
        return []
    return [entry for entry in history if isinstance(entry, dict)]


def _scenario_best_results(results: Any) -> dict[str, Any]:
    if not isinstance(results, dict):
        return {}
    monitor_state = results.get("monitor_state")
    if not isinstance(monitor_state, dict):
        return {}

    current_state = monitor_state.get("current_state")
    if isinstance(current_state, dict):
        best = current_state.get("scenario_best_results")
        if isinstance(best, dict) and best:
            return best

    state_history = monitor_state.get("state_history")
    if isinstance(state_history, list) and state_history:
        last = state_history[-1]
        if isinstance(last, dict):
            state = last.get("state")
            if isinstance(state, dict):
                best = state.get("scenario_best_results")
                if isinstance(best, dict) and best:
                    return best
    return {}


def _metrics_dict(entry: dict[str, Any]) -> dict[str, Any]:
    metrics = entry.get("metrics")
    return metrics if isinstance(metrics, dict) else {}


def _num(value: Any, default: float = 0.0) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return default


def _project_identity_fields(project: Project) -> dict[str, Any]:
    data = project_service.project_to_summary(project, include_owner=True)
    pipeline_type = str(data["pipeline_type"])
    return {
        "project_id": data["id"],
        "user_id": data["user_id"],
        "owner_email": data["owner_email"] or "",
        "title": data["title"],
        "pipeline_type": pipeline_type,
        "pipeline_label": _pipeline_label(pipeline_type),
        "status": data["status"],
        "created_at": _iso(data["created_at"]),
        "updated_at": _iso(data["updated_at"]),
    }


def _session_profiling_aggregates(history: list[dict[str, Any]]) -> dict[str, Any]:
    n_total = len(history)
    total_tokens_in = 0.0
    total_tokens_out = 0.0
    total_time = 0.0
    total_cost = 0.0
    total_api_fails = 0.0
    n_successful = 0
    score_sum = 0.0
    successful_costs: list[float] = []

    for entry in history:
        metrics = _metrics_dict(entry)
        total_tokens_in += _num(metrics.get("tokens_in"))
        total_tokens_out += _num(metrics.get("tokens_out"))
        total_time += _num(metrics.get("time"))
        total_cost += _num(metrics.get("cost"))
        total_api_fails += _num(metrics.get("api_failures"))
        score_sum += _num(metrics.get("score"))
        if metrics.get("stable"):
            n_successful += 1
        cps = metrics.get("cost_per_success")
        if isinstance(cps, (int, float)) and not isinstance(cps, bool):
            successful_costs.append(float(cps))

    avg_cost_per_success = (
        sum(successful_costs) / len(successful_costs) if successful_costs else None
    )
    avg_success_score = (score_sum / n_total) if n_total else 0.0

    return {
        "scenarios_completed": n_successful,
        "scenarios_total": n_total,
        "avg_success_score": round(avg_success_score, 4),
        "total_api_failures": int(total_api_fails),
        "avg_cost_per_success": (
            round(avg_cost_per_success, 6) if avg_cost_per_success is not None else ""
        ),
        "total_tokens_in": int(total_tokens_in),
        "total_tokens_out": int(total_tokens_out),
        "total_wall_clock_s": round(total_time, 3),
        "total_cost": round(total_cost, 6),
    }


def _session_summary_row(project: Project, history: list[dict[str, Any]]) -> dict[str, Any]:
    identity = _project_identity_fields(project)
    aggregates = _session_profiling_aggregates(history)
    return {
        "project_id": identity["project_id"],
        "user_id": identity["user_id"],
        "owner_email": identity["owner_email"],
        "title": identity["title"],
        "pipeline_type": identity["pipeline_type"],
        "pipeline_label": identity["pipeline_label"],
        "status": identity["status"],
        **aggregates,
        "created_at": identity["created_at"],
        "updated_at": identity["updated_at"],
    }


def _scenario_summary_rows(
    project: Project,
    history: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    identity = _project_identity_fields(project)
    rows: list[dict[str, Any]] = []
    for entry in history:
        metrics = _metrics_dict(entry)
        cps = metrics.get("cost_per_success")
        latency = metrics.get("controller_latency_s", metrics.get("time", 0))
        rows.append(
            {
                "project_id": identity["project_id"],
                "user_id": identity["user_id"],
                "owner_email": identity["owner_email"],
                "title": identity["title"],
                "pipeline_type": identity["pipeline_type"],
                "pipeline_label": identity["pipeline_label"],
                "status": identity["status"],
                "scenario_level": entry.get("scenario_level", ""),
                "timestamp": entry.get("timestamp", ""),
                "controller_type": metrics.get("controller_type") or "",
                "stable": bool(metrics.get("stable", False)),
                "score": round(_num(metrics.get("score")), 4),
                "controller_latency_s": round(_num(latency), 3),
                "api_failures": int(_num(metrics.get("api_failures"))),
                "cost_per_success": (
                    round(float(cps), 6)
                    if isinstance(cps, (int, float)) and not isinstance(cps, bool)
                    else ""
                ),
                "tokens_in": int(_num(metrics.get("tokens_in"))),
                "tokens_out": int(_num(metrics.get("tokens_out"))),
                "time_s": round(_num(metrics.get("time")), 3),
                "cost": round(_num(metrics.get("cost")), 6),
            }
        )
    return rows


def _best_controller_rows(project: Project) -> list[dict[str, Any]]:
    best_results = _scenario_best_results(project.results)
    if not best_results:
        return []

    identity = _project_identity_fields(project)
    rows: list[dict[str, Any]] = []
    for key in sorted(
        best_results.keys(),
        key=lambda value: int(value) if str(value).isdigit() else str(value),
    ):
        best = best_results.get(key)
        if not isinstance(best, dict):
            rows.append(
                {
                    "project_id": identity["project_id"],
                    "user_id": identity["user_id"],
                    "owner_email": identity["owner_email"],
                    "title": identity["title"],
                    "pipeline_type": identity["pipeline_type"],
                    "pipeline_label": identity["pipeline_label"],
                    "status": identity["status"],
                    "scenario_level": key,
                    "controller_type": "",
                    "stable": False,
                    "score": "",
                    "mse": "",
                    "gains_json": "",
                    "created_at": identity["created_at"],
                    "updated_at": identity["updated_at"],
                }
            )
            continue

        best_params = best.get("best_params")
        gains = {}
        if isinstance(best_params, dict):
            gains = {
                k: v
                for k, v in best_params.items()
                if k != "reasoning" and v is not None
            }
        scen_metrics = best.get("scenario_metrics")
        scen_metrics = scen_metrics if isinstance(scen_metrics, dict) else {}
        best_metrics = best.get("best_metrics")
        best_metrics = best_metrics if isinstance(best_metrics, dict) else {}
        mse = best_metrics.get("mse")
        score = scen_metrics.get("score")
        rows.append(
            {
                "project_id": identity["project_id"],
                "user_id": identity["user_id"],
                "owner_email": identity["owner_email"],
                "title": identity["title"],
                "pipeline_type": identity["pipeline_type"],
                "pipeline_label": identity["pipeline_label"],
                "status": identity["status"],
                "scenario_level": best.get("scenario_level", key),
                "controller_type": best.get("controller_type") or "",
                "stable": bool(scen_metrics.get("stable", False)),
                "score": (
                    round(float(score), 4)
                    if isinstance(score, (int, float)) and not isinstance(score, bool)
                    else ""
                ),
                "mse": (
                    round(float(mse), 6)
                    if isinstance(mse, (int, float)) and not isinstance(mse, bool)
                    else ""
                ),
                "gains_json": json.dumps(gains, separators=(",", ":")) if gains else "",
                "created_at": identity["created_at"],
                "updated_at": identity["updated_at"],
            }
        )
    return rows


def _collect_project_summary_rows(
    projects: list[Project],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    session_rows: list[dict[str, Any]] = []
    scenario_rows: list[dict[str, Any]] = []
    best_rows: list[dict[str, Any]] = []

    for project in projects:
        if project.pipeline_type != "siloDesign":
            continue

        history = _scenario_metrics_history(project.results)
        if history:
            session_rows.append(_session_summary_row(project, history))
            scenario_rows.extend(_scenario_summary_rows(project, history))

        best_rows.extend(_best_controller_rows(project))

    return session_rows, scenario_rows, best_rows


def _workflow_summary_dict(results: Any, key: str) -> dict[str, Any] | None:
    if not isinstance(results, dict):
        return None
    summary = results.get(key)
    return summary if isinstance(summary, dict) else None


def export_project_profiling_csv(
    db: Session,
    *,
    user_id: int | None = None,
    pipeline_type: str | None = None,
) -> str:
    """Export SILO computational profiling as a multi-section CSV.

    Sections:
    - session_summary: one row per project with session-level aggregates
    - per_scenario: one row per scenario with DevOps + token/cost fields
    - best_controllers: best controller selected per scenario (when available)
    """
    effective_pipeline = pipeline_type if pipeline_type else "siloDesign"
    projects = project_service.list_all_projects(
        db,
        user_id=user_id,
        pipeline_type=effective_pipeline,
    )
    session_rows, scenario_rows, best_rows = _collect_project_summary_rows(projects)

    sections = [
        _csv_section(
            "session_summary",
            rows_to_csv(session_rows, SESSION_SUMMARY_CSV_FIELDS),
        ),
        _csv_section(
            "per_scenario",
            rows_to_csv(scenario_rows, SCENARIO_SUMMARY_CSV_FIELDS),
        ),
        _csv_section(
            "best_controllers",
            rows_to_csv(best_rows, BEST_CONTROLLER_CSV_FIELDS),
        ),
    ]
    return "\n".join(sections)


def _project_detail_sections(projects: list[Project]) -> list[str]:
    """Per-scenario / best-controller detail tabs (single-loop only).

    Session-level summary metrics live on the projects row in download-all CSV.
    """
    _, scenario_rows, best_rows = _collect_project_summary_rows(projects)
    return [
        _csv_section(
            "single_loop_scenarios",
            rows_to_csv(scenario_rows, SCENARIO_SUMMARY_CSV_FIELDS),
        ),
        _csv_section(
            "single_loop_best_controllers",
            rows_to_csv(best_rows, BEST_CONTROLLER_CSV_FIELDS),
        ),
    ]


def export_monitoring_csv() -> str:
    snapshot = monitoring_service.collect_snapshot()
    fieldnames = [
        "collected_at",
        "uptime_seconds",
        "cpu_percent",
        "memory_percent",
        "memory_used_bytes",
        "memory_total_bytes",
        "disk_percent",
        "disk_used_bytes",
        "disk_total_bytes",
        "network_sent_rate_bps",
        "network_recv_rate_bps",
        "network_bytes_sent",
        "network_bytes_recv",
        "api_avg_latency_ms",
        "api_p50_latency_ms",
        "api_p95_latency_ms",
        "api_error_rate_percent",
        "api_requests_in_window",
    ]
    rows = []
    for item in snapshot["history"]:
        rows.append(_monitoring_row(item))
    return rows_to_csv(rows, fieldnames)


def _monitoring_row(item: dict[str, Any]) -> dict[str, Any]:
    memory = item["memory"]
    disk = item["disk"]
    network = item["network"]
    api = item["api"]
    return {
        "collected_at": item["collected_at"],
        "uptime_seconds": item["uptime_seconds"],
        "cpu_percent": item["cpu_percent"],
        "memory_percent": memory["percent"],
        "memory_used_bytes": memory["used_bytes"],
        "memory_total_bytes": memory["total_bytes"],
        "disk_percent": disk["percent"],
        "disk_used_bytes": disk["used_bytes"],
        "disk_total_bytes": disk["total_bytes"],
        "network_sent_rate_bps": network["sent_rate_bps"],
        "network_recv_rate_bps": network["recv_rate_bps"],
        "network_bytes_sent": network["bytes_sent"],
        "network_bytes_recv": network["bytes_recv"],
        "api_avg_latency_ms": api["avg_latency_ms"],
        "api_p50_latency_ms": api["p50_latency_ms"],
        "api_p95_latency_ms": api["p95_latency_ms"],
        "api_error_rate_percent": api["error_rate_percent"],
        "api_requests_in_window": api["requests_in_window"],
    }


def _csv_section(name: str, content: str) -> str:
    body = content.strip()
    if not body:
        return f"# section: {name}\n"
    return f"# section: {name}\n{body}\n"


def _overview_summary_csv(db: Session) -> str:
    users = db.query(User).order_by(User.email).all()
    plans = plan_service.list_plans(db)
    projects = project_service.list_all_projects(db)
    default_plan = plan_service.get_default_plan(db)
    active_users = sum(1 for user in users if user.is_active)
    admin_count = sum(1 for user in users if user.is_admin)
    active_plans = sum(1 for plan in plans if plan.is_active)
    max_modules = max((len(plan.action_codes()) for plan in plans), default=0)
    single_loop = sum(1 for project in projects if project.pipeline_type == "siloDesign")
    multi_loop = sum(1 for project in projects if project.pipeline_type == "muloDesign")
    rows = [
        {"metric": "total_users", "value": len(users)},
        {"metric": "active_users", "value": active_users},
        {"metric": "admin_users", "value": admin_count},
        {"metric": "active_plans", "value": active_plans},
        {"metric": "total_plans", "value": len(plans)},
        {"metric": "total_projects", "value": len(projects)},
        {"metric": "single_loop_projects", "value": single_loop},
        {"metric": "multi_loop_projects", "value": multi_loop},
        {"metric": "default_plan_id", "value": default_plan.id if default_plan else ""},
        {"metric": "default_plan_name", "value": default_plan.name if default_plan else ""},
        {"metric": "max_modules_on_plan", "value": max_modules},
    ]
    return rows_to_csv(rows, ("metric", "value"))


def _errors_csv(events: list[ErrorEvent]) -> str:
    rows = [error_tracking_service._event_row(event) for event in events]
    return rows_to_csv(rows, ERROR_CSV_FIELDS)


def _user_block_header(user: User) -> str:
    name = (user.display_name or "").strip() or "(no name)"
    return f"# ===== user: {user.id} | {name} | {user.email} =====\n"


def _user_data_block(
    user: User,
    *,
    projects: list[Project],
    feedback: list[FeedbackSurveyResponse],
    errors: list[ErrorEvent],
) -> str:
    """One user plus nested related data sections."""
    parts = [
        _user_block_header(user),
        _csv_section("user", rows_to_csv([_user_csv_row(user)], USER_CSV_FIELDS)),
        _csv_section(
            "projects",
            rows_to_csv(
                [
                    _overview_project_csv_row(p)
                    for p in sorted(projects, key=lambda item: item.id)
                ],
                OVERVIEW_PROJECT_CSV_FIELDS,
            ),
        ),
        *_project_detail_sections(projects),
    ]

    if user.profile_survey_completed_at is not None:
        parts.append(
            _csv_section(
                "profile_survey",
                rows_to_csv([_profile_survey_csv_row(user)], PROFILE_SURVEY_CSV_FIELDS),
            )
        )
    else:
        parts.append(_csv_section("profile_survey", ""))

    if feedback:
        parts.append(
            _csv_section(
                "feedback_survey",
                rows_to_csv(
                    [_feedback_survey_csv_row(row, user) for row in feedback],
                    FEEDBACK_SURVEY_CSV_FIELDS,
                ),
            )
        )
    else:
        parts.append(_csv_section("feedback_survey", ""))

    parts.append(_csv_section("errors", _errors_csv(errors)))
    return "".join(parts)


def export_overview_csv(db: Session) -> str:
    """Export studio data grouped by user (main workbook sheet content).

    Layout:
    - global sections: summary, plans, monitoring, unassigned_errors
    - then for each user: user info + projects (with inline summary metrics),
      single-loop scenario/best-controller detail tabs, surveys, errors
    """
    users = db.query(User).order_by(User.email).all()
    projects_by_user: dict[int, list[Project]] = defaultdict(list)
    for project in project_service.list_all_projects(db):
        projects_by_user[project.user_id].append(project)

    feedback_by_user: dict[int, list[FeedbackSurveyResponse]] = defaultdict(list)
    for response, user in survey_service.list_feedback_responses(db):
        feedback_by_user[user.id].append(response)

    errors_by_user: dict[int, list[ErrorEvent]] = defaultdict(list)
    unassigned_errors: list[ErrorEvent] = []
    for event in error_tracking_service.list_errors(db, limit=1000):
        if event.user_id is None:
            unassigned_errors.append(event)
        else:
            errors_by_user[event.user_id].append(event)

    sections = [
        _csv_section("summary", _overview_summary_csv(db)),
        _csv_section("plans", export_plans_csv(db)),
        _csv_section("monitoring", export_monitoring_csv()),
        _csv_section("unassigned_errors", _errors_csv(unassigned_errors)),
    ]

    for user in users:
        sections.append(
            _user_data_block(
                user,
                projects=projects_by_user.get(user.id, []),
                feedback=feedback_by_user.get(user.id, []),
                errors=errors_by_user.get(user.id, []),
            )
        )

    return "\n".join(sections)


def _write_csv_text_to_sheet(ws: Any, csv_content: str) -> None:
    """Write a CSV string into an Excel worksheet (one CSV row per sheet row)."""
    text = csv_content.strip()
    if not text:
        return
    for row in csv.reader(io.StringIO(text)):
        ws.append(row)


def export_overview_xlsx(db: Session) -> bytes:
    """Multi-sheet Excel workbook for \"Download all Data\".

    - Sheet ``all_data``: original per-user overview layout (unchanged).
    - Extra sheets: users, plans, projects, surveys, monitoring — selectable
      tabs like a normal Excel workbook.
    """
    from openpyxl import Workbook

    wb = Workbook()
    main = wb.active
    main.title = "all_data"
    _write_csv_text_to_sheet(main, export_overview_csv(db))

    extra_sheets = [
        ("users", export_users_csv(db)),
        ("plans", export_plans_csv(db)),
        ("projects", export_projects_csv(db)),
        ("profile_survey", export_profile_survey_csv(db)),
        ("feedback_survey", export_feedback_survey_csv(db)),
        ("monitoring", export_monitoring_csv()),
    ]
    for name, content in extra_sheets:
        ws = wb.create_sheet(name)
        _write_csv_text_to_sheet(ws, content)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def export_profile_survey_csv(db: Session) -> str:
    rows = [
        _profile_survey_csv_row(user)
        for user in survey_service.list_profile_responses(db)
    ]
    return rows_to_csv(rows, PROFILE_SURVEY_CSV_FIELDS)


def export_feedback_survey_csv(db: Session) -> str:
    rows = [
        _feedback_survey_csv_row(response, user)
        for response, user in survey_service.list_feedback_responses(db)
    ]
    return rows_to_csv(rows, FEEDBACK_SURVEY_CSV_FIELDS)
