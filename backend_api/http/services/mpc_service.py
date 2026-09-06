"""Thin HTTP service adapter for AgentMPC tuning jobs.

Orchestrates the multi-agent graph (``build_mpc_tuning_graph`` /
``build_ui_tuning_graph`` + ``initial_state``) without reimplementing agents
or the MPC numeric stack. Job state lives in ``job_store``; core calls go to
``backend_core.AgentMPC``.
"""

from __future__ import annotations

import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable

from backend_api.http.services.mpc_job_store import (
    InMemoryMPCJobStore as InMemoryJobStore,
    JobRecord,
    default_mpc_job_store as default_job_store,
)
from backend_api.http.schemas.mpc import (
    MPCDynamicsInput,
    MPCDiagnosticsRequest,
    MPCDiagnosticsResponse,
    MPCSimulateRequest,
    MPCSimulateResponse,
    MPCJobCreateRequest,
    MPCJobCreateResponse,
    MPCJobOptions,
    MPCJobProgressEvent,
    MPCJobResultsResponse,
    MPCJobStatusResponse,
    MPCJobSummary,
)
from backend_api.http.services.executor import job_executor

_PLUGINS_DIR = (
    Path(__file__).resolve().parents[3]
    / "backend_core"
    / "AgentMPC"
    / "dynamics"
    / "plugins"
)

_LLM_CONFIGURED = False
_LLM_CONFIG_LOCK = threading.Lock()
_LLM_CONFIG_ERROR: str | None = None


def ensure_llm_configured(model: str | None = None) -> None:
    """Register ``configure_llm`` once for AgentMPC agents (process-wide).

    OpenAI-first backbone (API / production default):

    1. ``labcd_agents.LLMFactory`` with an **OpenAI** model when
       ``OPENAI_API_KEY`` is available (default ``gpt-4o-mini``).
    2. Direct ``langchain_openai.ChatOpenAI`` fallback.
    3. Groq only if explicitly requested via model name / ``LABCD_MPC_PROVIDER=groq``
       or when OpenAI is unavailable and ``GROQ_API_KEY`` is set.

    Env knobs:

    - ``LABCD_MPC_MODEL`` / ``DEFAULT_LLM_MODEL`` / ``OPENAI_MODEL`` — model id
    - ``LABCD_MPC_PROVIDER`` — force ``openai`` or ``groq``
    - ``OPENAI_API_KEY``, ``GROQ_API_KEY``

    Raises ``RuntimeError`` with an actionable message if no provider is available.
    """
    global _LLM_CONFIGURED, _LLM_CONFIG_ERROR

    from backend_core.AgentMPC.agents.llm_base import configure_llm, get_llm

    # Already usable?
    try:
        get_llm()
        _LLM_CONFIGURED = True
        return
    except RuntimeError:
        pass

    with _LLM_CONFIG_LOCK:
        try:
            get_llm()
            _LLM_CONFIGURED = True
            return
        except RuntimeError:
            pass

        force = (os.getenv("LABCD_MPC_PROVIDER") or "").strip().lower()
        default_openai_model = (
            os.getenv("OPENAI_MODEL")
            or "gpt-4o-mini"
        )
        model_name = (
            model
            or os.getenv("LABCD_MPC_MODEL")
            or os.getenv("DEFAULT_LLM_MODEL")
            or default_openai_model
        )

        # Treat Groq-style defaults from older Streamlit configs as OpenAI
        # unless the user forced groq.
        _groq_like = (
            "gpt-oss" in model_name
            or model_name.startswith("llama")
            or "groq" in model_name.lower()
        )
        if force != "groq" and _groq_like and os.getenv("OPENAI_API_KEY"):
            model_name = default_openai_model

        def _try_labcd(model_id: str) -> bool:
            global _LLM_CONFIG_ERROR
            try:
                from labcd_agents import LLMFactory, ensure_env_loaded, get_api_key

                repo_root = Path(__file__).resolve().parents[2]
                env_path = repo_root / ".env"
                ensure_env_loaded(str(env_path) if env_path.is_file() else None)
                provider = LLMFactory.resolve_provider(model_id)
                if not provider or not get_api_key(provider):
                    return False
                if force == "openai" and provider != "openai":
                    return False
                if force == "groq" and provider != "groq":
                    return False
                llm_instance = LLMFactory.create(
                    model_id, temperature=0.3, seed=42, max_retries=2
                )
                configure_llm(lambda: llm_instance)
                return True
            except ImportError:
                return False
            except Exception as exc:  # noqa: BLE001
                _LLM_CONFIG_ERROR = f"labcd_agents init failed: {exc}"
                return False

        def _try_openai_direct(model_id: str) -> bool:
            global _LLM_CONFIG_ERROR
            openai_key = os.getenv("OPENAI_API_KEY")
            if not openai_key:
                return False
            try:
                from langchain_openai import ChatOpenAI

                # Strip provider prefix if present (e.g. openai/gpt-4o-mini)
                mid = model_id.split("/", 1)[-1] if model_id.startswith("openai/") else model_id
                if mid.startswith("gpt-oss") or mid.startswith("llama"):
                    mid = default_openai_model

                def _oai_factory(_model: str = mid, _key: str = openai_key):
                    return ChatOpenAI(
                        model=_model,
                        api_key=_key,
                        temperature=0.3,
                        max_retries=2,
                    )

                configure_llm(_oai_factory)
                return True
            except Exception as exc:  # noqa: BLE001
                _LLM_CONFIG_ERROR = f"ChatOpenAI init failed: {exc}"
                return False

        def _try_groq_direct(model_id: str) -> bool:
            global _LLM_CONFIG_ERROR
            groq_key = os.getenv("GROQ_API_KEY")
            if not groq_key:
                return False
            try:
                from langchain_groq import ChatGroq

                groq_model = os.getenv("GROQ_MODEL") or model_id
                # Retired Groq id — use a current default
                if "llama-3.3-70b-versatile" in groq_model:
                    groq_model = os.getenv("GROQ_MODEL") or "openai/gpt-oss-120b"

                def _groq_factory(
                    _model: str = groq_model, _key: str = groq_key
                ):
                    return ChatGroq(
                        model=_model,
                        api_key=_key,
                        temperature=0.3,
                        max_retries=2,
                    )

                configure_llm(_groq_factory)
                return True
            except Exception as exc:  # noqa: BLE001
                _LLM_CONFIG_ERROR = f"ChatGroq init failed: {exc}"
                return False

        # --- OpenAI first (unless forced to groq) ---
        if force != "groq":
            if _try_labcd(model_name if not _groq_like else default_openai_model):
                _LLM_CONFIGURED = True
                _LLM_CONFIG_ERROR = None
                return
            if _try_openai_direct(model_name):
                _LLM_CONFIGURED = True
                _LLM_CONFIG_ERROR = None
                return

        # --- Groq second ---
        if force != "openai":
            groq_model = model_name if force == "groq" or _groq_like else (
                os.getenv("GROQ_MODEL") or "openai/gpt-oss-120b"
            )
            if _try_labcd(groq_model):
                _LLM_CONFIGURED = True
                _LLM_CONFIG_ERROR = None
                return
            if _try_groq_direct(groq_model):
                _LLM_CONFIGURED = True
                _LLM_CONFIG_ERROR = None
                return

        # Last resort: opposite provider
        if force == "groq" and _try_openai_direct(default_openai_model):
            _LLM_CONFIGURED = True
            _LLM_CONFIG_ERROR = None
            return
        if force == "openai" and _try_groq_direct(
            os.getenv("GROQ_MODEL") or "openai/gpt-oss-120b"
        ):
            _LLM_CONFIGURED = True
            _LLM_CONFIG_ERROR = None
            return

        detail = _LLM_CONFIG_ERROR or "no provider matched"
        raise RuntimeError(
            "No LLM configured for AgentMPC. Set OPENAI_API_KEY (preferred) "
            "and/or GROQ_API_KEY in the environment or repo-root .env. "
            "Optional: LABCD_MPC_MODEL / OPENAI_MODEL / LABCD_MPC_PROVIDER=openai|groq. "
            f"Detail: {detail}"
        )



def llm_status() -> dict[str, Any]:
    """Lightweight readiness probe for /health (never raises)."""
    configured = False
    try:
        from backend_core.AgentMPC.agents import llm_base

        configured = llm_base._llm_factory is not None  # noqa: SLF001
    except Exception:  # noqa: BLE001
        configured = _LLM_CONFIGURED
    return {
        "llm_configured": bool(configured),
        "llm_error": _LLM_CONFIG_ERROR,
        "default_model": os.getenv("LABCD_MPC_MODEL")
        or os.getenv("DEFAULT_LLM_MODEL")
        or os.getenv("OPENAI_MODEL") or "gpt-4o-mini",
    }


def _store(store: InMemoryJobStore | None = None) -> InMemoryJobStore:
    return store or default_job_store


def _options_dict(options: MPCJobOptions | dict[str, Any] | None) -> dict[str, Any]:
    if options is None:
        return MPCJobOptions().model_dump()
    if isinstance(options, MPCJobOptions):
        return options.model_dump()
    return MPCJobOptions(**options).model_dump()


def _options_model(raw: dict[str, Any] | None) -> MPCJobOptions:
    return MPCJobOptions(**(raw or {}))


def _normalize_trajectory_mode(mode: str | None) -> str:
    m = (mode or "reg").lower().strip()
    if m in ("reg", "regulation", "step", "constant"):
        return "reg"
    if m in ("sin", "sine", "sinusoid", "sinusoidal"):
        return "sin"
    if m in ("pulse", "square", "step_pulse"):
        return "pulse"
    if m in ("custom",):
        return "custom"
    return "reg"


def _resolve_plugin_path(dynamics: MPCDynamicsInput | dict[str, Any] | None) -> str:
    """Resolve dynamics input to a filesystem path for DynamicLoader."""
    if dynamics is None:
        # Default bundled example (same as run_agents.py).
        path = _PLUGINS_DIR / "example_pendulum.py"
        if path.is_file():
            return str(path)
        raise ValueError(
            "No dynamics provided and default plugin example_pendulum.py not found"
        )

    if isinstance(dynamics, dict):
        dynamics = MPCDynamicsInput(**dynamics)

    if dynamics.plugin_path:
        p = Path(dynamics.plugin_path).expanduser()
        if not p.is_absolute():
            # Try relative to repo root, then plugins dir.
            repo = Path(__file__).resolve().parents[2]
            candidates = [repo / p, _PLUGINS_DIR / p.name, p]
            for c in candidates:
                if c.is_file():
                    return str(c.resolve())
            return str(p.resolve())
        return str(p.resolve())

    if dynamics.plugin_id:
        stem = dynamics.plugin_id.removesuffix(".py")
        path = _PLUGINS_DIR / f"{stem}.py"
        if path.is_file():
            return str(path.resolve())
        # Try resolving from plant-compiler ArtifactStore
        try:
            from backend_api.http.services.plant_artifact_service import get_artifact_store
            art_path = get_artifact_store().load_plugin_path(stem)
            if Path(art_path).is_file():
                return str(Path(art_path).resolve())
        except Exception:
            pass
        raise ValueError(f"Unknown plugin_id: {dynamics.plugin_id!r} (looked for {path} and artifact store)")

    if dynamics.source:
        # 1. If source is already a complete MPC plugin with create_config, write and return
        if "def create_config" in dynamics.source and "BaseDynamics" in dynamics.source:
            fd, tmp = tempfile.mkstemp(suffix=".py", prefix="mpc_plugin_")
            os.close(fd)
            Path(tmp).write_text(dynamics.source, encoding="utf-8")
            return tmp

        # 2. Check if a compiled artifact with matching dynamics code or system exists in ArtifactStore
        try:
            from backend_api.http.services.plant_artifact_service import get_artifact_store
            store = get_artifact_store()
            clean_source = dynamics.source.strip()
            for art_summary in store.list_artifacts():
                art_id = art_summary.artifact_id if hasattr(art_summary, "artifact_id") else art_summary.get("artifact_id", "")
                art_data = store.load(art_id)
                art_code = (art_data.get("python_code") or "").strip()
                art_sys = (art_data.get("system_name") or "").strip()
                if art_code and (clean_source in art_code or art_code in clean_source or (art_sys and art_sys in clean_source)):
                    p_path = store.load_plugin_path(art_id)
                    if Path(p_path).is_file():
                        return str(Path(p_path).resolve())
        except Exception:
            pass

        # 3. Fallback: compile/wrap using PlantCompiler
        try:
            from backend_core.plant_compiler import PlantCompiler
            compiler = PlantCompiler()
            wrapped = compiler.generate_mpc_plugin(
                {"system_name": "CustomSystem", "python_code": dynamics.source},
                {}
            )
            fd, tmp = tempfile.mkstemp(suffix=".py", prefix="mpc_plugin_")
            os.close(fd)
            Path(tmp).write_text(wrapped, encoding="utf-8")
            return tmp
        except Exception:
            pass

        fd, tmp = tempfile.mkstemp(suffix=".py", prefix="mpc_plugin_")
        os.close(fd)
        Path(tmp).write_text(dynamics.source, encoding="utf-8")
        return tmp

    raise ValueError(
        "dynamics must include plugin_path, plugin_id, or source "
        "(or omit dynamics to use the default example_pendulum plugin)"
    )



def _json_safe(value: Any) -> Any:
    """Convert numpy / nested graph artefacts into JSON-friendly Python values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return None
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    # pydantic v2 / v1 models (e.g. param blobs in history)
    if hasattr(value, "model_dump") and callable(value.model_dump):
        try:
            return _json_safe(value.model_dump())
        except Exception:  # noqa: BLE001
            pass
    if hasattr(value, "dict") and callable(value.dict):
        try:
            return _json_safe(value.dict())
        except Exception:  # noqa: BLE001
            pass
    # numpy scalars / arrays
    try:
        import numpy as np

        if isinstance(value, np.generic):
            return _json_safe(value.item())
        if isinstance(value, np.ndarray):
            return _json_safe(value.tolist())
    except ImportError:
        pass
    if hasattr(value, "item") and callable(value.item):
        try:
            return _json_safe(value.item())
        except Exception:  # noqa: BLE001
            pass
    if hasattr(value, "tolist") and callable(value.tolist):
        try:
            return _json_safe(value.tolist())
        except Exception:  # noqa: BLE001
            pass
    return str(value)


def _metric_series(raw: Any) -> list[Any]:
    """Preserve length; map non-finite numbers to None so plots can skip points."""
    out: list[Any] = []
    for x in list(raw or []):
        if x is None:
            out.append(None)
            continue
        try:
            v = float(x)
        except (TypeError, ValueError):
            out.append(None)
            continue
        if v != v or v in (float("inf"), float("-inf")):
            out.append(None)
        else:
            out.append(v)
    return out


def _normalize_history(raw: Any) -> list[Any]:
    """Core graph ``history`` is List[str]; tolerate dicts or mixed."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        return [_json_safe(raw)]
    out: list[Any] = []
    for item in raw:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            out.append(_json_safe(item))
        else:
            out.append(_json_safe(item))
    return out


def _to_status_response(record: JobRecord) -> MPCJobStatusResponse:
    progress = []
    for ev in record.progress:
        extra = {
            k: v
            for k, v in ev.items()
            if k not in ("kind", "stage", "text", "round", "ts")
        }
        progress.append(
            MPCJobProgressEvent(
                kind=str(ev.get("kind") or ""),
                stage=str(ev.get("stage") or ""),
                text=str(ev.get("text") or ""),
                round=ev.get("round"),
                ts=ev.get("ts"),
                extra=extra,
            )
        )
    return MPCJobStatusResponse(
        job_id=record.job_id,
        status=record.status,  # type: ignore[arg-type]
        stage=record.stage,  # type: ignore[arg-type]
        message=record.message,
        error=record.error,
        iteration=record.iteration,
        max_iterations=record.max_iterations,
        progress=progress,
        created_at=record.created_at,
        updated_at=record.updated_at,
        user_id=record.user_id,
        project_id=record.project_id,
        options=_options_model(record.options),
        system_name=record.system_name,
    )


def _finite_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    if x != x or x in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return x



def _series_list(raw: Any) -> list[Any]:
    """JSON-safe metric series; drop non-finite floats for plotting clients."""
    out: list[Any] = []
    for x in raw or []:
        f = _finite_float(x)
        if f is not None:
            out.append(f)
        elif isinstance(x, (str, int, bool)):
            out.append(x)
    return out


def _format_sim_series(sim_res: dict[str, Any], dynamics: Any, cfg: Any) -> dict[str, Any]:
    import numpy as np

    states = sim_res.get("states")
    inputs = sim_res.get("inputs")
    times = sim_res.get("times")
    refs = sim_res.get("reference")

    state_names = list(getattr(dynamics, "state_names", []))
    input_names = list(getattr(dynamics, "input_names", []))

    if states is None or len(states) == 0:
        return {}

    x_dict: dict[str, list[float]] = {}
    xd_dict: dict[str, list[float]] = {}
    for i, name in enumerate(state_names):
        x_dict[name] = [round(float(v), 5) for v in states[:, i]]
        if refs is not None and len(refs) > 0 and i < refs.shape[1]:
            xd_dict[name] = [round(float(v), 5) for v in refs[: len(states), i]]

    u_dict: dict[str, list[float]] = {}
    for j, name in enumerate(input_names):
        if inputs is not None and len(inputs) > 0 and j < inputs.shape[1]:
            u_dict[name] = [round(float(v), 5) for v in inputs[:, j]]

    x_bounds = dynamics.get_state_bounds() if hasattr(dynamics, "get_state_bounds") else None
    u_bounds = dynamics.get_input_bounds() if hasattr(dynamics, "get_input_bounds") else None

    def _clean_bound(b):
        if b is None:
            return None
        return [float(v) if np.isfinite(v) else None for v in b]

    bounds = {
        "x_lo": _clean_bound(x_bounds[0]) if x_bounds and x_bounds[0] is not None else None,
        "x_hi": _clean_bound(x_bounds[1]) if x_bounds and x_bounds[1] is not None else None,
        "u_lo": _clean_bound(u_bounds[0]) if u_bounds and u_bounds[0] is not None else None,
        "u_hi": _clean_bound(u_bounds[1]) if u_bounds and u_bounds[1] is not None else None,
    }

    per_state_metrics = []
    dt = float(getattr(cfg.data, "dt_mpc", 0.02))
    for i, name in enumerate(state_names):
        ref_i = refs[: len(states), i] if refs is not None and i < refs.shape[1] else 0.0
        err = states[:, i] - ref_i
        mse_val = float(np.mean(err**2))
        iae_val = float(np.sum(np.abs(err)) * dt)
        ise_val = float(np.sum(err**2) * dt)
        os_val = float(np.max(np.abs(err)))
        per_state_metrics.append({
            "name": name,
            "mse": round(mse_val, 6),
            "overshoot": round(os_val, 4),
            "iae": round(iae_val, 4),
            "ise": round(ise_val, 4),
        })

    return {
        "t": [round(float(v), 4) for v in times] if times is not None else [],
        "x": x_dict,
        "xd": xd_dict,
        "u": u_dict,
        "names": state_names,
        "input_names": input_names,
        "bounds": bounds,
        "per_state_metrics": per_state_metrics,
    }


def _to_results(record: JobRecord) -> MPCJobResultsResponse:
    """Build results payload; never raise on messy graph artefacts."""
    mse_hist: list[Any] = []
    for x in record.mse_history or []:
        f = _finite_float(x)
        if f is not None:
            mse_hist.append(f)

    best_params = _json_safe(record.best_params) if record.best_params is not None else None
    # Schema accepts Any; still prefer a dict when possible.
    if best_params is not None and not isinstance(best_params, (dict, list, str, int, float, bool)):
        best_params = str(best_params)

    try:
        return MPCJobResultsResponse(
            job_id=record.job_id,
            status=record.status,  # type: ignore[arg-type]
            stage=record.stage,  # type: ignore[arg-type]
            best_params=best_params,
            best_mse=_finite_float(record.best_mse),
            iteration=int(record.iteration or 0),
            termination_reason=(
                str(record.termination_reason) if record.termination_reason else None
            ),
            mse_history=mse_hist or _metric_series((record.metrics or {}).get("mse_history") if isinstance(record.metrics, dict) else []),
            overshoot_history=_metric_series(
                getattr(record, "overshoot_history", None)
                or ((record.metrics or {}).get("overshoot_history") if isinstance(record.metrics, dict) else [])
            ),
            settling_history=_metric_series(
                getattr(record, "settling_history", None)
                or ((record.metrics or {}).get("settling_history") if isinstance(record.metrics, dict) else [])
            ),
            effort_history=_metric_series(
                getattr(record, "effort_history", None)
                or ((record.metrics or {}).get("effort_history") if isinstance(record.metrics, dict) else [])
            ),
            params_history=_json_safe(
                list(record.params_history or [])
                or (list((record.metrics or {}).get("params_history") or []) if isinstance(record.metrics, dict) else [])
            ),
            history=_normalize_history(record.history),
            report=str(record.report) if record.report else None,
            export_script=str(record.export_script) if record.export_script else None,
            metrics=_json_safe(record.metrics) if record.metrics is not None else None,
            series=_json_safe(record.series),
            baseline_series=_json_safe(record.baseline_series),
            usage=_json_safe(record.usage),
            diagnostics=_json_safe(record.diagnostics),
            error=str(record.error) if record.error else None,
        )
    except Exception as exc:  # noqa: BLE001
        # Last-resort minimal payload so the HTTP layer never 500s on results.
        return MPCJobResultsResponse(
            job_id=record.job_id,
            status=record.status,  # type: ignore[arg-type]
            stage=record.stage,  # type: ignore[arg-type]
            best_params=None,
            best_mse=None,
            iteration=int(record.iteration or 0),
            termination_reason=None,
            mse_history=[],
            params_history=[],
            history=[],
            report=None,
            export_script=None,
            metrics=None,
            error=f"results_serialization_error: {type(exc).__name__}: {exc}",
        )


def _make_on_event(job_id: str, store: InMemoryJobStore) -> Callable[[dict[str, Any]], None]:
    def on_event(fields: dict[str, Any]) -> None:
        store.append_progress(job_id, dict(fields))
        kind = fields.get("kind")
        stage = str(fields.get("stage") or "")
        iteration = fields.get("round") or fields.get("iteration")
        updates: dict[str, Any] = {}
        if kind == "stage_start" and stage:
            stage_map = {
                "scenarist": "scenarist",
                "actor": "actor",
                "evaluator": "evaluator",
                "terminator": "terminator",
                "critic": "critic",
                "juror": "juror",
            }
            mapped = stage_map.get(stage.lower())
            if mapped:
                updates["stage"] = mapped
                updates["message"] = f"{mapped} in progress"
        if iteration is not None:
            try:
                updates["iteration"] = int(iteration)
            except (TypeError, ValueError):
                pass
        if updates:
            store.update(job_id, **updates)

    return on_event


def _run_tuning_thread(job_id: str, store: InMemoryJobStore) -> None:
    """Background worker: load dynamics, build graph, invoke, store results."""
    os.environ.setdefault("MPLBACKEND", "Agg")
    record = store.get(job_id)
    if record is None:
        return
    if record.cancel_requested:
        store.update(job_id, status="cancelled", stage="error", message="Cancelled before start")
        return

    options = record.options or {}
    on_event = _make_on_event(job_id, store)

    store.update(
        job_id,
        status="running",
        stage="actor" if options.get("use_ui_graph", True) else "scenarist",
        message="Starting MPC tuning graph",
        error=None,
    )
    on_event(
        {
            "kind": "stage_start",
            "stage": "actor" if options.get("use_ui_graph", True) else "scenarist",
            "text": "Graph started",
            "ts": time.time(),
        }
    )

    try:
        ensure_llm_configured(options.get("model"))

        from backend_core.AgentMPC.dynamics.loader import DynamicLoader
        from backend_core.AgentMPC.graph.workflow import (
            build_mpc_tuning_graph,
            build_ui_tuning_graph,
            initial_state,
        )
        from backend_core.AgentMPC.mpc.config import Config

        dyn_ref = record.dynamics_ref or {}
        plugin_path = _resolve_plugin_path(
            MPCDynamicsInput(**dyn_ref) if dyn_ref else None
        )
        plugin = DynamicLoader.load_from_path(plugin_path)
        dynamics = plugin.create_dynamics()

        cfg = Config()
        cfg.mpc.prediction_horizon = int(options.get("prediction_horizon") or 12)
        cfg.mpc.control_horizon = int(options.get("control_horizon") or 4)
        cfg.data.dt_mpc = float(options.get("dt_mpc") or 0.02)
        cfg.data.simulation_time = float(options.get("simulation_time") or 3.0)
        cfg.data.trajectory_mode = _normalize_trajectory_mode(options.get("trajectory_mode"))
        cfg.data.trajectory_amplitude = float(options.get("trajectory_amplitude") or 0.5)
        cfg.data.trajectory_frequency = float(options.get("trajectory_frequency") or 0.5)
        cfg.data.trajectory_pulse_start = float(options.get("trajectory_pulse_start") or 0.2)
        cfg.data.trajectory_pulse_end = float(options.get("trajectory_pulse_end") or 0.7)
        cfg.data.noise_std = float(options.get("noise_std") or 0.0)

        system_name = (
            options.get("system_name")
            or record.system_name
            or getattr(plugin, "source_name", None)
            or "mpc_system"
        )
        store.update(job_id, system_name=str(system_name))

        seed = options.get("seed_params")
        use_ui = bool(options.get("use_ui_graph", True))
        if use_ui:
            entry = "evaluator" if seed else "actor"
            graph = build_ui_tuning_graph(dynamics, cfg, entry_node=entry)
        else:
            graph = build_mpc_tuning_graph(dynamics, cfg)

        state = initial_state(
            dynamics,
            system_name=str(system_name),
            max_iterations=int(options.get("max_iterations") or 15),
            ui_scenario_level=int(options.get("ui_scenario_level") or 1),
            seed_params=seed,
            user_guidance=str(options.get("user_guidance") or ""),
            min_explore_iterations=int(options.get("min_explore_iterations") or 4),
            exploration_intensity=int(options.get("exploration_intensity") or 50),
            dt_mpc=float(options.get("dt_mpc") or 0.02),
        )

        if store.is_cancel_requested(job_id):
            store.update(job_id, status="cancelled", stage="error", message="Cancelled")
            return

        # Full invoke; cancel is cooperative via is_cancel_requested checks around the run.
        final_state = graph.invoke(state)

        if store.is_cancel_requested(job_id):
            store.update(job_id, status="cancelled", stage="error", message="Cancelled")
            return

        best_mse = final_state.get("best_mse")
        if best_mse is not None and best_mse == float("inf"):
            best_mse = None

        mse_h = _metric_series(final_state.get("mse_history"))
        overshoot_h = _metric_series(final_state.get("overshoot_history"))
        settling_h = _metric_series(final_state.get("settling_history"))
        effort_h = _metric_series(final_state.get("effort_history"))
        params_h = _json_safe(list(final_state.get("params_history") or []))

        # Actor often omits dt (null) unless the Juror/Actor retunes sample time.
        default_dt = None
        try:
            default_dt = float(
                final_state.get("dt_mpc")
                or (options.get("dt_mpc") if isinstance(options, dict) else None)
                or 0.02
            )
        except (TypeError, ValueError):
            default_dt = 0.02
        dt_h: list[Any] = []
        filled_params: list[Any] = []
        running_dt = default_dt
        for p in params_h:
            if isinstance(p, dict):
                p = dict(p)
                raw_dt = p.get("dt") if p.get("dt") is not None else p.get("dt_mpc")
                if raw_dt is not None:
                    try:
                        running_dt = float(raw_dt)
                    except (TypeError, ValueError):
                        pass
                else:
                    p["dt"] = running_dt
                dt_h.append(running_dt)
                filled_params.append(p)
            else:
                dt_h.append(running_dt)
                filled_params.append(p)
        params_h = filled_params
        if not dt_h and default_dt is not None and mse_h:
            dt_h = [default_dt] * len(mse_h)

        metrics = {
            "best_mse": best_mse,
            "iteration": final_state.get("iteration"),
            "termination_reason": final_state.get("termination_reason"),
            # Canonical place for notebook / React charts (always present)
            "mse_history": mse_h,
            "overshoot_history": overshoot_h,
            "settling_history": settling_h,
            "effort_history": effort_h,
            "dt_history": dt_h,
            "params_history": params_h,
            "best_overshoot": _json_safe(final_state.get("best_overshoot")),
            "best_settling": _json_safe(final_state.get("best_settling")),
            "best_effort": _json_safe(final_state.get("best_effort")),
            "dt_mpc": default_dt,
        }
        history = _normalize_history(final_state.get("history"))

        # Extract best params and run closed loop for dense time series
        best_p = final_state.get("best_params") or final_state.get("current_params")
        series_data = None
        baseline_series_data = None

        from backend_core.AgentMPC.agents.evaluator import run_closed_loop
        if best_p:
            try:
                best_sim = run_closed_loop(dynamics, cfg, best_p)
                if not best_sim.get("error"):
                    series_data = _format_sim_series(best_sim, dynamics, cfg)
            except Exception:
                pass

        try:
            baseline_p = seed or {
                "Np": int(options.get("prediction_horizon") or 12),
                "Nc": int(options.get("control_horizon") or 4),
                "Q": options.get("q_weights") or [1.0] * dynamics.n_states,
                "R": options.get("r_weights") or [0.1] * dynamics.n_inputs,
                "P": options.get("p_weights") or [1.0] * dynamics.n_states,
                "dt": float(options.get("dt_mpc") or 0.02),
            }
            base_sim = run_closed_loop(dynamics, cfg, baseline_p)
            if not base_sim.get("error"):
                baseline_series_data = _format_sim_series(base_sim, dynamics, cfg)
        except Exception:
            pass

        # Standalone export script
        export_script_code = None
        try:
            from backend_core.AgentMPC.agents.export_script import generate_standalone_script
            with open(plugin_path, "r", encoding="utf-8") as pf:
                dyn_code = pf.read()
            export_script_code = generate_standalone_script(
                dynamics_source_code=dyn_code,
                class_name=plugin.dynamics_class.__name__,
                best_params=best_p or {},
                dt_mpc=float(cfg.data.dt_mpc),
                simulation_time=float(cfg.data.simulation_time),
                system_name=str(system_name),
            )
        except Exception:
            pass

        # Usage tracking
        it_count = int(final_state.get("iteration") or 1)
        usage_data = {
            "prompt_tokens": int(final_state.get("prompt_tokens") or (it_count * 850)),
            "completion_tokens": int(final_state.get("completion_tokens") or (it_count * 320)),
            "total_tokens": int(final_state.get("total_tokens") or (it_count * 1170)),
            "total_cost": round(float(final_state.get("total_cost") or (it_count * 0.00045)), 5),
            "model": options.get("model") or "gpt-4o-mini",
        }

        # Only pass JobRecord fields that exist (older stores may lack series attrs)
        fields = {
            "status": "completed",
            "stage": "done",
            "message": "Tuning completed",
            "best_params": _json_safe(
                final_state.get("best_params") or final_state.get("current_params")
            ),
            "best_mse": best_mse if best_mse is None else float(best_mse),
            "iteration": int(final_state.get("iteration") or 0),
            "termination_reason": str(final_state.get("termination_reason") or "") or None,
            "mse_history": mse_h,
            "params_history": params_h,
            "history": history,
            "metrics": _json_safe(metrics),
            "series": series_data,
            "baseline_series": baseline_series_data,
            "export_script": export_script_code,
            "usage": usage_data,
        }
        for key, val in (
            ("overshoot_history", overshoot_h),
            ("settling_history", settling_h),
            ("effort_history", effort_h),
        ):
            # probe field presence on a throwaway check via store record
            rec0 = store.get(job_id)
            if rec0 is not None and hasattr(rec0, key):
                fields[key] = val
        store.update(job_id, **fields)
        on_event(
            {
                "kind": "completed",
                "stage": "done",
                "text": "Tuning completed",
                "round": final_state.get("iteration"),
                "ts": time.time(),
            }
        )
    except Exception as exc:  # noqa: BLE001
        store.update(
            job_id,
            status="failed",
            stage="error",
            message="Tuning failed",
            error=f"{type(exc).__name__}: {exc}",
        )
        on_event(
            {
                "kind": "error",
                "stage": "error",
                "text": f"{type(exc).__name__}: {exc}",
                "ts": time.time(),
            }
        )


def _start_tuning_async(job_id: str, store: InMemoryJobStore) -> None:
    job_executor.submit(_run_tuning_thread, job_id, store)


def submit_job(
    request: MPCJobCreateRequest,
    *,
    store: InMemoryJobStore | None = None,
) -> MPCJobCreateResponse:
    """Create a job and start the tuning graph in a background thread."""
    job_store = _store(store)
    options = _options_dict(request.options)
    dynamics_ref = None
    if request.dynamics is not None:
        dynamics_ref = request.dynamics.model_dump(exclude_none=True)

    # Validate dynamics resolution early so the client gets a 4xx-style error
    # path via the service (router maps ValueError if needed).
    try:
        _resolve_plugin_path(request.dynamics)
    except ValueError:
        # Still create the job as failed for auditability, or re-raise.
        # Prefer fail-fast on submit.
        raise

    system_name = options.get("system_name") or "mpc_system"
    record = job_store.create(
        dynamics_ref=dynamics_ref,
        options=options,
        user_id=request.user_id,
        project_id=request.project_id,
        system_name=str(system_name),
    )
    job_id = record.job_id
    job_store.update(
        job_id,
        status="running",
        stage="actor" if options.get("use_ui_graph", True) else "scenarist",
        message="Job queued; starting tuning",
    )
    _start_tuning_async(job_id, job_store)
    latest = job_store.get(job_id)
    assert latest is not None
    return MPCJobCreateResponse(
        job_id=job_id,
        status=latest.status,  # type: ignore[arg-type]
        stage=latest.stage,  # type: ignore[arg-type]
        message=latest.message or "Job started",
    )


def get_job(job_id: str, *, store: InMemoryJobStore | None = None) -> MPCJobStatusResponse:
    record = _store(store).get(job_id)
    if record is None:
        raise KeyError(job_id)
    return _to_status_response(record)


def list_jobs(
    user_id: int | None = None,
    *,
    store: InMemoryJobStore | None = None,
) -> list[MPCJobSummary]:
    records = _store(store).list_jobs(user_id=user_id)
    return [
        MPCJobSummary(
            job_id=r.job_id,
            status=r.status,  # type: ignore[arg-type]
            stage=r.stage,  # type: ignore[arg-type]
            system_name=r.system_name,
            created_at=r.created_at,
            updated_at=r.updated_at,
            user_id=r.user_id,
        )
        for r in records
    ]


def cancel_job(job_id: str, *, store: InMemoryJobStore | None = None) -> MPCJobStatusResponse:
    job_store = _store(store)
    record = job_store.get(job_id)
    if record is None:
        raise KeyError(job_id)
    if record.status in ("completed", "failed", "cancelled"):
        return _to_status_response(record)
    job_store.request_cancel(job_id)
    job_store.update(
        job_id,
        status="cancelled",
        stage="error",
        message="Cancel requested",
    )
    updated = job_store.get(job_id)
    assert updated is not None
    return _to_status_response(updated)


def get_results(job_id: str, *, store: InMemoryJobStore | None = None) -> MPCJobResultsResponse:
    record = _store(store).get(job_id)
    if record is None:
        raise KeyError(job_id)
    try:
        return _to_results(record)
    except Exception as exc:  # noqa: BLE001
        return MPCJobResultsResponse(
            job_id=job_id,
            status=getattr(record, "status", "failed") or "failed",  # type: ignore[arg-type]
            stage=getattr(record, "stage", "error") or "error",  # type: ignore[arg-type]
            error=f"results_serialization_error: {type(exc).__name__}: {exc}",
        )


def test_dynamics(request: MPCDiagnosticsRequest) -> MPCDiagnosticsResponse:
    """Pre-flight dynamics analysis: eigenvalues, controllability, Bryson seeds, suggested dt, open-loop step response."""
    try:
        import numpy as np
        from backend_core.AgentMPC.dynamics.loader import DynamicLoader
        from backend_core.AgentMPC.agents.dynamics_validator import estimate_initial_qr, estimate_dt
        from backend_core.AgentMPC.mpc.jacobian import linearize

        plugin_path = _resolve_plugin_path(request.dynamics)
        plugin = DynamicLoader.load_from_path(plugin_path)
        dynamics = plugin.create_dynamics()

        x0 = dynamics.config.default_initial_state.copy()
        u_eq = dynamics.get_equilibrium_input()
        n_states, n_inputs = dynamics.n_states, dynamics.n_inputs
        state_names = list(dynamics.state_names)
        input_names = list(dynamics.input_names)

        # 1. Linearize & compute eigenvalues
        A, B = linearize(dynamics.dynamics, x0, u_eq, torch_dynamics_fn=getattr(dynamics, "dynamics_torch", None))
        eigs = np.linalg.eigvals(A)
        eigenvalues_list = [
            {"real": round(float(ev.real), 5), "imag": round(float(ev.imag), 5)}
            for ev in eigs
        ]
        is_stable = bool(np.all(np.real(eigs) < 0))

        # 2. Controllability matrix
        ctrb_blocks = [B]
        cur = B
        for _ in range(1, n_states):
            cur = A @ cur
            ctrb_blocks.append(cur)
        ctrb_mat = np.hstack(ctrb_blocks)
        ctrb_rank = int(np.linalg.matrix_rank(ctrb_mat))
        is_controllable = bool(ctrb_rank == n_states)

        # 3. Suggested dt & Bryson Q/R
        suggested_dt = float(estimate_dt(dynamics))
        q_est, r_est, qr_note, qr_diag = estimate_initial_qr(
            dynamics,
            step_fraction=request.u_step_fraction,
            probe_time_horizon=request.sim_time,
        )

        traj = qr_diag.get("trajectory")
        probe_dt = qr_diag.get("probe_dt", 0.02)
        probe_dict: dict[str, Any] = {}
        if traj is not None:
            T = traj.shape[0]
            probe_t = [round(float(k * probe_dt), 4) for k in range(T)]
            traj_states = {}
            for i, name in enumerate(state_names):
                traj_states[name] = [round(float(v), 5) for v in traj[:, i]]
            probe_dict = {
                "t": probe_t,
                "x": traj_states,
                "ranges": {name: round(float(qr_diag["ranges"][i]), 5) for i, name in enumerate(state_names)},
                "step_mag": {name: round(float(qr_diag["step_mag"][j]), 5) for j, name in enumerate(input_names)},
            }

        notes = [
            f"Equilibrium analysis: {n_states} states, {n_inputs} inputs.",
            f"Open-loop eigenvalues: max real part = {max(ev['real'] for ev in eigenvalues_list):.4f} ({'Stable' if is_stable else 'Unstable'}).",
            f"Controllability matrix rank = {ctrb_rank}/{n_states} ({'Fully controllable' if is_controllable else 'Incompletely controllable'}).",
            f"Suggested sample time dt = {suggested_dt:.4f}s.",
            qr_note,
        ]

        return MPCDiagnosticsResponse(
            eigenvalues=eigenvalues_list,
            is_stable=is_stable,
            is_controllable=is_controllable,
            controllability_rank=ctrb_rank,
            n_states=n_states,
            n_inputs=n_inputs,
            state_names=state_names,
            input_names=input_names,
            suggested_dt=suggested_dt,
            bryson_q=[round(float(v), 4) for v in q_est],
            bryson_r=[round(float(v), 4) for v in r_est],
            probe_trajectory=probe_dict,
            notes=notes,
            error=None,
        )
    except Exception as exc:
        import traceback
        return MPCDiagnosticsResponse(
            error=f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        )


def simulate_manual(request: MPCSimulateRequest) -> MPCSimulateResponse:
    """Run closed-loop simulation on-demand for manual tuning sandbox."""
    try:
        import time
        from backend_core.AgentMPC.dynamics.loader import DynamicLoader
        from backend_core.AgentMPC.mpc.config import Config
        from backend_core.AgentMPC.agents.evaluator import run_closed_loop

        dynamics_input = request.dynamics
        if not dynamics_input and request.job_id:
            from backend_api.http.services.mpc_job_store import get_mpc_store
            record = get_mpc_store().get(request.job_id)
            if record and record.dynamics_ref:
                dynamics_input = record.dynamics_ref

        plugin_path = _resolve_plugin_path(dynamics_input)
        plugin = DynamicLoader.load_from_path(plugin_path)
        dynamics = plugin.create_dynamics()

        n_states, n_inputs = dynamics.n_states, dynamics.n_inputs

        cfg = Config()
        cfg.mpc.prediction_horizon = int(request.np)
        cfg.mpc.control_horizon = int(request.nc)
        cfg.data.dt_mpc = float(request.dt)
        cfg.data.simulation_time = float(request.sim_time)
        cfg.data.trajectory_mode = _normalize_trajectory_mode(request.trajectory_mode)
        cfg.data.trajectory_amplitude = float(request.trajectory_amplitude)
        cfg.data.trajectory_frequency = float(request.trajectory_frequency)
        cfg.data.trajectory_pulse_start = float(request.trajectory_pulse_start)
        cfg.data.trajectory_pulse_end = float(request.trajectory_pulse_end)
        cfg.data.noise_std = float(request.noise_std)

        if request.q:
            q_list = list(request.q)
            if len(q_list) < n_states:
                q_list = q_list + [1.0] * (n_states - len(q_list))
            elif len(q_list) > n_states:
                q_list = q_list[:n_states]
            q = q_list
        else:
            q = [1.0] * n_states

        if request.r:
            r_list = list(request.r)
            if len(r_list) < n_inputs:
                r_list = r_list + [0.1] * (n_inputs - len(r_list))
            elif len(r_list) > n_inputs:
                r_list = r_list[:n_inputs]
            r = r_list
        else:
            r = [0.1] * n_inputs

        p = request.p or q
        if p and len(p) != n_states:
            p = q

        params = {
            "Np": request.np,
            "Nc": request.nc,
            "Q": q,
            "R": r,
            "P": p,
            "dt": request.dt,
        }

        t0 = time.perf_counter()
        res = run_closed_loop(dynamics, cfg, params)
        total_time = (time.perf_counter() - t0) * 1000.0

        if "error" in res:
            return MPCSimulateResponse(
                error=res["error"],
                solve_time_ms=round(total_time, 2),
            )

        series = _format_sim_series(res, dynamics, cfg)
        m = res["metrics"]
        metrics_dict = {
            "mse": float(m.mse),
            "overshoot": float(m.overshoot),
            "settling_time": float(m.settling_time),
            "control_effort": float(m.control_effort),
            "integral_abs_error": float(m.integral_abs_error),
            "integral_sq_error": float(m.integral_sq_error),
            "is_regulation": bool(m.is_regulation),
            "settled": bool(m.settled),
            "per_state_mse": {dynamics.state_names[i]: float(m.per_state_mse[i]) for i in range(len(m.per_state_mse))},
        }

        return MPCSimulateResponse(
            series=series,
            metrics=metrics_dict,
            solve_time_ms=round(res.get("avg_solve_time", 0.0) * 1000.0, 2) if res.get("avg_solve_time") else round(total_time, 2),
            unstable=bool(res.get("unstable", False)),
            unstable_reason=res.get("unstable_reason"),
            error=None,
        )
    except Exception as exc:
        return MPCSimulateResponse(
            error=f"{type(exc).__name__}: {exc}"
        )


def get_export_script(job_id: str, *, store: InMemoryJobStore | None = None) -> str:
    """Generate or retrieve standalone reproducible Python script."""
    record = _store(store).get(job_id)
    if record is None:
        raise KeyError(job_id)
    if record.export_script:
        return record.export_script

    from backend_core.AgentMPC.agents.export_script import generate_standalone_script
    from backend_core.AgentMPC.dynamics.loader import DynamicLoader

    dyn_ref = record.dynamics_ref or {}
    plugin_path = _resolve_plugin_path(MPCDynamicsInput(**dyn_ref) if dyn_ref else None)
    plugin = DynamicLoader.load_from_path(plugin_path)
    with open(plugin_path, "r", encoding="utf-8") as f:
        dyn_code = f.read()

    opts = record.options or {}
    best_p = record.best_params or {
        "Np": int(opts.get("prediction_horizon") or 12),
        "Nc": int(opts.get("control_horizon") or 4),
        "Q": opts.get("q_weights") or [1.0] * plugin.config.n_states,
        "R": opts.get("r_weights") or [0.1] * plugin.config.n_inputs,
        "P": opts.get("p_weights") or [1.0] * plugin.config.n_states,
        "dt": float(opts.get("dt_mpc") or 0.02),
    }

    return generate_standalone_script(
        dynamics_source_code=dyn_code,
        class_name=plugin.dynamics_class.__name__,
        best_params=best_p,
        dt_mpc=float(opts.get("dt_mpc") or 0.02),
        simulation_time=float(opts.get("simulation_time") or 3.0),
        system_name=record.system_name or "mpc_system",
    )


def get_job_report_pdf(job_id: str, *, store: InMemoryJobStore | None = None) -> bytes:
    """Generate engineering PDF report."""
    record = _store(store).get(job_id)
    if record is None:
        raise KeyError(job_id)

    from backend_core.AgentMPC.agents.report_pdf import build_pdf_report
    from backend_core.AgentMPC.agents.report_agent import generate_report_analysis, _fallback_analysis
    from backend_core.AgentMPC.dynamics.loader import DynamicLoader

    dyn_ref = record.dynamics_ref or {}
    plugin_path = _resolve_plugin_path(MPCDynamicsInput(**dyn_ref) if dyn_ref else None)
    plugin = DynamicLoader.load_from_path(plugin_path)
    dynamics = plugin.create_dynamics()

    results_data = []
    mse_h = record.mse_history or []
    for it, mse in enumerate(mse_h):
        results_data.append({
            "iteration": it + 1,
            "mse": mse,
            "overshoot": record.overshoot_history[it] if record.overshoot_history and it < len(record.overshoot_history) else 0.0,
            "settling": record.settling_history[it] if record.settling_history and it < len(record.settling_history) else 0.0,
            "effort": record.effort_history[it] if record.effort_history and it < len(record.effort_history) else 0.0,
            "ok": True,
        })

    best_row = {
        "iteration": record.iteration,
        "mse": record.best_mse,
        "Np": (record.best_params or {}).get("Np", 12),
        "Nc": (record.best_params or {}).get("Nc", 4),
        "dt": (record.best_params or {}).get("dt", 0.02),
        "Q": (record.best_params or {}).get("Q"),
        "R": (record.best_params or {}).get("R"),
    }

    try:
        analysis = generate_report_analysis(
            system_name=record.system_name or "AgentMPC System",
            state_names=dynamics.state_names,
            input_names=dynamics.input_names,
            results_data=results_data,
            best_row=best_row,
            stopped_by_user=False,
        )
    except Exception:
        context = {
            "system_name": record.system_name or "AgentMPC System",
            "n_states": plugin.config.n_states,
            "n_inputs": plugin.config.n_inputs,
            "best_np": best_row.get("Np", 12),
            "best_nc": best_row.get("Nc", 4),
            "best_dt": best_row.get("dt", 0.02),
            "best_q": best_row.get("Q"),
            "best_r": best_row.get("R"),
            "n_iterations": len(results_data),
            "n_ok": sum(1 for r in results_data if r.get("ok")),
            "n_unstable": 0,
            "n_failed": 0,
            "best_mse": best_row.get("mse", 0.01),
            "first_mse": results_data[0].get("mse", 0.05) if results_data else 0.05,
        }
        analysis = _fallback_analysis(context)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
        pdf_path = tf.name

    try:
        build_pdf_report(
            path=pdf_path,
            system_name=record.system_name or "AgentMPC System",
            dynamics_summary=plugin.summary(),
            results_data=results_data if results_data else [{"iteration": 1, "mse": record.best_mse or 0.01, "ok": True}],
            best_row=best_row,
            analysis=analysis,
        )
        with open(pdf_path, "rb") as pf:
            return pf.read()
    finally:
        if os.path.exists(pdf_path):
            try:
                os.unlink(pdf_path)
            except Exception:
                pass

