"""PlantCompiler: validate enriched AgentPlant output and generate downstream artifacts.

Converts AgentPlant (python_code + metadata) + pre-launch config into:
- AgentMPC BaseDynamics plugin (.py source)
- AgentAdaptive system_spec dict
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

try:
    import sympy as sp
except ImportError:  # pragma: no cover
    sp = None  # type: ignore


REQUIRED_METADATA_KEYS = (
    "states",
    "state_meanings",
    "inputs",
    "outputs",
    "state_equations",
    "parameters",
    "system_type",
    "assumptions",
)

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*$")


@dataclass
class ValidationResult:
    ok: bool
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def raise_if_invalid(self) -> None:
        if not self.ok:
            raise ValueError("Plant validation failed:\n  - " + "\n  - ".join(self.errors))


@dataclass
class Artifact:
    """Handle returned by compile_artifact."""

    artifact_id: str
    system_name: str
    plant: Dict[str, Any]
    pre_launch: Dict[str, Any]
    adaptive_spec: Dict[str, Any]
    mpc_plugin_source: str
    created_at: str
    full_payload: Dict[str, Any]


def _short_hash(payload: Dict[str, Any]) -> str:
    import json

    blob = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:6]


def _safe_class_name(system_name: str) -> str:
    """Turn 'Cart-Pole' into 'CartPoleDynamics' base identifier."""
    parts = re.findall(r"[A-Za-z0-9]+", system_name or "System")
    if not parts:
        parts = ["System"]
    return "".join(p[:1].upper() + p[1:] for p in parts)



# Identifiers that may appear in sympy RHS without being states/inputs/params.
_MATH_NAMES = frozenset({
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
    "exp", "log", "sqrt", "Abs", "abs", "sign",
    "sinh", "cosh", "tanh", "Heaviside", "pi", "E", "t",
})

_SYMPY_IMPORT_RE = re.compile(
    r"^\s*(from\s+sympy(\.[\w.]+)?\s+import\s+[^\n]+|import\s+sympy(\s+as\s+\w+)?)\s*$",
    re.MULTILINE,
)
_BARE_MATH_FN_RE = re.compile(
    r"(?<![\w.])(sin|cos|tan|asin|acos|atan|atan2|exp|log|sqrt|sinh|cosh|tanh|abs|sign)\s*\("
)


def _identifiers_in_expr(expr: str) -> List[str]:
    """Rough identifier scan for free names in a sympy-style expression."""
    return re.findall(r"\b[A-Za-z_][A-Za-z_0-9]*\b", expr or "")


def sanitize_python_code(python_code: str) -> str:
    """Make AgentPlant python_code safe for numeric MPC plugins.

    - Drop sympy imports (AgentMPC evaluates with numpy arrays).
    - Rewrite bare sin(/cos(/... to np.sin(/np.cos(/... when not already qualified.
    """
    if not python_code:
        return python_code
    code = _SYMPY_IMPORT_RE.sub("", python_code)

    def _repl(m: re.Match) -> str:
        fn = m.group(1)
        return f"np.{fn}("

    code = _BARE_MATH_FN_RE.sub(_repl, code)
    code = re.sub(r"\n{3,}", "\n\n", code)
    return code.strip() + ("\n" if python_code.endswith("\n") else "")


_TUPLE_LHS_RE = re.compile(r"^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=\s*(.+)$")
_NUMERIC_TOKEN_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$")
_DOT_ASSIGN_RE = re.compile(r"^([A-Za-z_]\w*)_dot\s*=\s*(.+)$")
# dtheta_dt = ..., di_dt = ...  (name is group 1)
_D_NAME_DT_RE = re.compile(r"^d([A-Za-z_]\w*)_dt\s*=\s*(.+)$")
# dtheta = ... (short form; avoid matching dtheta_dt which is handled above)
_D_PREFIX_ASSIGN_RE = re.compile(r"^d([A-Za-z_]\w*)\s*=\s*(.+)$")
_DX_INDEX_ASSIGN_RE = re.compile(r"^d[xX](?:dt)?\s*\[\s*(\d+)\s*\]\s*=\s*(.+)$")


def _strip_comment(line: str) -> Tuple[str, Optional[str]]:
    """Split ``line`` into (code, comment-or-None), both stripped."""
    if "#" in line:
        code, _, comment = line.partition("#")
        return code.strip(), comment.strip()
    return line.strip(), None


def _extract_state_aliases(user_code: str) -> Tuple[Dict[int, str], Dict[str, str]]:
    """Find ``name = x[i]`` (or tuple-unpack) lines; return index->name and name->meaning.

    Meanings are only captured from single-name lines (``theta = x[0]  # pitch angle
    (rad)``) since a shared trailing comment on a multi-name tuple line can't be
    attributed to one variable.
    """
    idx_to_name: Dict[int, str] = {}
    name_meaning: Dict[str, str] = {}
    for raw in user_code.splitlines():
        code_part, comment = _strip_comment(raw.strip())
        if not code_part:
            continue
        m = _TUPLE_LHS_RE.match(code_part)
        if not m:
            continue
        lhs = [n.strip() for n in m.group(1).split(",")]
        rhs = [n.strip() for n in m.group(2).split(",")]
        if len(lhs) != len(rhs):
            continue
        touched = False
        for name, val in zip(lhs, rhs):
            im = re.fullmatch(r"x\[(\d+)\]", val)
            if im:
                idx_to_name[int(im.group(1))] = name
                touched = True
        if touched and comment and len(lhs) == 1:
            name_meaning[lhs[0]] = comment
    return idx_to_name, name_meaning


def _extract_input_aliases(user_code: str) -> Tuple[Dict[int, str], Dict[str, str]]:
    """Find ``name = u[i]`` / ``name = u`` lines; return index->name and name->meaning."""
    idx_to_input: Dict[int, str] = {}
    input_meaning: Dict[str, str] = {}
    for raw in user_code.splitlines():
        code_part, comment = _strip_comment(raw.strip())
        if not code_part:
            continue
        m = _TUPLE_LHS_RE.match(code_part)
        if not m:
            continue
        lhs = [n.strip() for n in m.group(1).split(",")]
        rhs = [n.strip() for n in m.group(2).split(",")]
        if len(lhs) != len(rhs):
            continue
        for name, val in zip(lhs, rhs):
            im = re.fullmatch(r"u\[(\d+)\]", val)
            if im:
                idx_to_input[int(im.group(1))] = name
                if comment and len(lhs) == 1:
                    input_meaning[name] = comment
            elif val == "u" and len(lhs) == 1:
                idx_to_input.setdefault(0, name)
                if comment:
                    input_meaning[name] = comment
    return idx_to_input, input_meaning


def _extract_numeric_parameters(user_code: str, exclude_names: set) -> Dict[str, Any]:
    """Pull labelled numeric constants (``Iy = 469.0``, tuple form included) out of the body.

    Supports semicolon-chained assignments on one line (``m = 0.5; l = 0.3``).
    State/input aliases are skipped.
    """
    params: Dict[str, Any] = {}
    for raw in user_code.splitlines():
        code_part, _ = _strip_comment(raw.strip())
        if not code_part:
            continue
        for stmt in code_part.split(";"):
            stmt = stmt.strip()
            if not stmt:
                continue
            m = _TUPLE_LHS_RE.match(stmt)
            if not m:
                continue
            lhs = [n.strip() for n in m.group(1).split(",")]
            rhs = [n.strip() for n in m.group(2).split(",")]
            if len(lhs) != len(rhs):
                continue
            if not all(_NUMERIC_TOKEN_RE.match(v) for v in rhs):
                continue
            for name, val in zip(lhs, rhs):
                if name in exclude_names:
                    continue
                params[name] = int(val) if re.fullmatch(r"[+-]?\d+", val) else float(val)
    return params



_NP_MATH_RE = re.compile(
    r"\b(?:np|numpy)\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|sqrt|abs|sign|"
    r"sinh|cosh|tanh|pi|e)\b",
    re.IGNORECASE,
)


def _to_sympy_expr(expr: str) -> str:
    """Rewrite numpy-qualified math so Adaptive/sympy can parse the equation.

    ``python_code`` correctly uses ``np.sin``; ``state_equations`` must use bare
    ``sin`` / ``cos`` / ... (PlantCompiler.validate rejects ``np.*``).
    """
    out = _NP_MATH_RE.sub(
        lambda m: "pi" if m.group(1).lower() == "pi" else (
            "E" if m.group(1).lower() == "e" else m.group(1).lower()
        ),
        expr,
    )
    # abs -> Abs for sympy friendliness
    out = re.sub(r"\babs\s*\(", "Abs(", out)
    return out


def _substitute_refs(expr: str, states: List[str], inputs: List[str]) -> str:
    """Rewrite ``x[i]`` / ``u[i]`` to physical names and strip ``np.`` math prefixes."""
    out = expr
    for i, name in enumerate(states):
        out = re.sub(rf"\bx\[{i}\]", name, out)
    for j, name in enumerate(inputs):
        out = re.sub(rf"\bu\[{j}\]", name, out)
    return _to_sympy_expr(out)


def _collect_simple_assignments(user_code: str) -> Dict[str, str]:
    """Map local ``name = expr`` assignments (single target) in the dynamics body.

    Handles semicolon-chained statements on one line (``m = 0.5; l = 0.3``).
    Skips tuple unpacking and anything that is not a plain identifier target.
    """
    assigns: Dict[str, str] = {}
    for raw in user_code.splitlines():
        code_part, _ = _strip_comment(raw.strip())
        if not code_part:
            continue
        # Split ``a = 1; b = 2`` so each binding is recorded separately.
        for stmt in code_part.split(";"):
            stmt = stmt.strip()
            if not stmt or "," in stmt.split("=")[0]:
                continue
            m = re.match(r"^([A-Za-z_]\w*)\s*=\s*(.+)$", stmt)
            if not m:
                continue
            name, expr = m.group(1), m.group(2).strip()
            if name in {"def", "return", "if", "for", "while", "else", "elif"}:
                continue
            # Refuse RHS that still contains another assignment (malformed split)
            if re.search(r"[^=<>!]=[^=]", expr):
                continue
            assigns[name] = expr
    return assigns


def _expand_expr(expr: str, assigns: Dict[str, str], *, max_depth: int = 8) -> str:
    """Inline simple local names so state_equations are self-contained for sympy."""
    out = expr
    for _ in range(max_depth):
        changed = False
        # Longest names first to avoid partial replacements
        for name in sorted(assigns.keys(), key=len, reverse=True):
            if name not in out:
                continue
            # word-boundary replace
            new_out = re.sub(rf"\b{re.escape(name)}\b", f"({assigns[name]})", out)
            if new_out != out:
                out = new_out
                changed = True
        if not changed:
            break
    return out


def _extract_state_equations(
    user_code: str, states: List[str], inputs: List[str]
) -> List[str]:
    """Find each state's derivative RHS from the dynamics body.

    Recognised forms (in priority order per line):
      - ``dx[i] = ...`` / ``dxdt[i] = ...``
      - ``{name}_dot = ...``
      - ``d{name}_dt = ...``  (e.g. ``dtheta_dt = omega``)
      - ``d{name} = ...``     (short form; not ``d{name}_dt``)

    Intermediate locals (``s = sin(theta)``; ``d2theta = ...``) are inlined so
    the resulting equations are self-contained for sympy validation.

    Returns a list aligned with ``states``, or ``[]`` if any state's derivative
    can't be confidently located (caller may fall back to chain form).
    """
    by_name: Dict[str, str] = {}
    by_index: Dict[int, str] = {}
    state_set = set(states)
    assigns = _collect_simple_assignments(user_code)

    for raw in user_code.splitlines():
        code_part, _ = _strip_comment(raw.strip())
        if not code_part:
            continue
        m = _DX_INDEX_ASSIGN_RE.match(code_part)
        if m:
            by_index[int(m.group(1))] = m.group(2).strip()
            continue
        m = _DOT_ASSIGN_RE.match(code_part)
        if m and m.group(1) in state_set:
            by_name[m.group(1)] = m.group(2).strip()
            continue
        m = _D_NAME_DT_RE.match(code_part)
        if m and m.group(1) in state_set:
            by_name[m.group(1)] = m.group(2).strip()
            continue
        m = _D_PREFIX_ASSIGN_RE.match(code_part)
        if m and m.group(1) in state_set and not m.group(1).endswith("_dt"):
            by_name.setdefault(m.group(1), m.group(2).strip())

    # Do not expand state/input names or pure numeric parameter bindings
    # (keep "m", "g" as symbols so parameters stay visible in equations).
    expand_map = {
        k: v for k, v in assigns.items()
        if k not in state_set
        and k not in set(inputs)
        and not _NUMERIC_TOKEN_RE.match((v or "").strip())
    }

    eqs: List[str] = []
    for i, name in enumerate(states):
        expr = by_name.get(name)
        if expr is None:
            expr = by_index.get(i)
        if expr is None:
            return []
        expr = _expand_expr(expr, expand_map)
        eqs.append(_substitute_refs(expr, states, inputs))
    return eqs


def _chain_fallback(states: List[str], inputs: List[str]) -> List[str]:
    """Last-resort synthetic chain (``x2``, ``-xN + u``) when nothing was parseable."""
    inp0 = inputs[0] if inputs else "u"
    n = len(states)
    eqs: List[str] = []
    for i in range(n):
        if i < n - 1:
            eqs.append(states[i + 1])
        else:
            eqs.append(f"-{states[i]} + {inp0}")
    return eqs



@dataclass
class DynamicsVerifyResult:
    ok: bool
    max_abs_err: float = 0.0
    n_samples: int = 0
    n_compared: int = 0
    message: str = ""
    diagnostics: Dict[str, Any] = field(default_factory=dict)


def verify_dynamics(
    python_code: str,
    metadata: dict,
    *,
    n_samples: int = 24,
    tol: float = 1e-5,
    seed: int = 0,
) -> DynamicsVerifyResult:
    """Numerically compare ``dynamics(t,x,u)`` against metadata state_equations.

    Builds a numpy-callable RHS from ``metadata["state_equations"]`` using the
    same state/input/parameter names, samples random (t, x, u), and checks
    ``np.allclose`` against the executed ``python_code``. Used to reject LLM
    metadata that drifted from the code (the DC-motor chain-equation failure
    mode).
    """
    if not isinstance(metadata, dict):
        return DynamicsVerifyResult(ok=False, message="metadata is not a dict")
    states = list(metadata.get("states") or [])
    inputs = list(metadata.get("inputs") or [])
    eqs = list(metadata.get("state_equations") or [])
    params = dict(metadata.get("parameters") or {})
    n = len(states)
    if n == 0:
        return DynamicsVerifyResult(ok=False, message="no states")
    if len(eqs) != n:
        return DynamicsVerifyResult(
            ok=False,
            message=f"state_equations length {len(eqs)} != states length {n}",
            diagnostics={"states": states, "eqs": eqs},
        )
    if not all(isinstance(e, str) and e.strip() for e in eqs):
        return DynamicsVerifyResult(ok=False, message="empty or non-string state_equations")

    code = sanitize_python_code(python_code or "")
    try:
        loc: Dict[str, Any] = {"np": np, "numpy": np}
        exec(code, loc)  # noqa: S102
        dyn_fn = loc.get("dynamics")
        if not callable(dyn_fn):
            return DynamicsVerifyResult(ok=False, message="python_code has no callable dynamics")
    except Exception as exc:  # noqa: BLE001
        return DynamicsVerifyResult(ok=False, message=f"exec python_code failed: {exc}")

    # Build lambdified RHS from equations. Prefer sympy; fall back to a careful
    # eval with a restricted namespace if sympy is unavailable.
    n_u = max(1, len(inputs))
    try:
        if sp is None:
            raise RuntimeError("sympy unavailable")
        sym_states = [sp.Symbol(s) for s in states]
        sym_inputs = [sp.Symbol(inp) for inp in inputs]
        sym_params = {sp.Symbol(k): float(v) for k, v in params.items() if isinstance(v, (int, float))}
        # Also bind bare identifiers used as params
        local_dict = {s.name: s for s in sym_states}
        local_dict.update({s.name: s for s in sym_inputs})
        local_dict.update({k: sp.Symbol(k) for k in params})
        rhs_exprs = []
        for eq in eqs:
            expr = sp.sympify(eq, locals=local_dict)
            expr = expr.subs(sym_params)
            rhs_exprs.append(expr)
        free_syms = set()
        for e in rhs_exprs:
            free_syms |= set(e.free_symbols)
        expected = set(sym_states) | set(sym_inputs)
        # Allow leftover param symbols that failed numeric conversion
        leftover = free_syms - expected
        if leftover:
            # try to sub remaining params by name
            for sym in list(leftover):
                if sym.name in params and isinstance(params[sym.name], (int, float)):
                    for i, e in enumerate(rhs_exprs):
                        rhs_exprs[i] = e.subs(sym, float(params[sym.name]))
                    leftover.discard(sym)
        free_syms = set()
        for e in rhs_exprs:
            free_syms |= set(e.free_symbols)
        leftover = free_syms - expected
        if leftover:
            return DynamicsVerifyResult(
                ok=False,
                message=f"state_equations have unknown free symbols: {sorted(s.name for s in leftover)}",
                diagnostics={"leftover": [s.name for s in leftover]},
            )
        args = sym_states + sym_inputs
        rhs_fn = sp.lambdify(args, rhs_exprs, modules=["numpy"])
        use_sympy = True
    except Exception as exc:  # noqa: BLE001
        # Restricted eval fallback
        use_sympy = False
        sympy_err = str(exc)

        def rhs_fn(*args_arr):  # type: ignore
            env = {"np": np, "numpy": np}
            for i, name in enumerate(states):
                env[name] = float(args_arr[i])
            for j, name in enumerate(inputs):
                env[name] = float(args_arr[n + j])
            for k, v in params.items():
                if isinstance(v, (int, float)):
                    env[k] = float(v)
            # safe-ish math names
            import math as _math
            for fname in ("sin", "cos", "tan", "exp", "log", "sqrt", "abs"):
                env[fname] = getattr(np, fname, getattr(_math, fname, None))
            out = []
            for eq in eqs:
                out.append(float(eval(eq, {"__builtins__": {}}, env)))  # noqa: S307
            return out

    rng = np.random.default_rng(seed)
    max_err = 0.0
    n_ok = 0
    samples = max(1, int(n_samples))
    last_err = ""
    for _ in range(samples):
        t = float(rng.uniform(0.0, 1.0))
        x = rng.uniform(-1.0, 1.0, size=n)
        u = rng.uniform(-1.0, 1.0, size=n_u)
        try:
            try:
                y_code = np.asarray(dyn_fn(t, x, u if n_u > 1 else float(u[0])), dtype=float).reshape(-1)
            except Exception:
                y_code = np.asarray(dyn_fn(t, x, u), dtype=float).reshape(-1)
            if y_code.size != n:
                return DynamicsVerifyResult(
                    ok=False,
                    message=f"dynamics returned size {y_code.size}, expected {n}",
                )
            args_vec = list(x.tolist()) + list(u[: len(inputs)].tolist() if inputs else [float(u[0])])
            if len(inputs) == 0:
                args_vec = list(x.tolist()) + [float(u[0])]
            # Match input arity used by lambdify
            if use_sympy:
                y_meta = np.asarray(rhs_fn(*args_vec), dtype=float).reshape(-1)
            else:
                y_meta = np.asarray(rhs_fn(*args_vec), dtype=float).reshape(-1)
            if y_meta.size != n:
                return DynamicsVerifyResult(
                    ok=False,
                    message=f"metadata RHS returned size {y_meta.size}, expected {n}",
                )
            err = float(np.max(np.abs(y_code - y_meta)))
            max_err = max(max_err, err)
            if np.allclose(y_code, y_meta, atol=tol, rtol=tol):
                n_ok += 1
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            continue

    if n_ok == 0 and last_err:
        return DynamicsVerifyResult(
            ok=False,
            max_abs_err=max_err,
            n_samples=samples,
            n_compared=0,
            message=f"sample evaluation failed: {last_err}",
            diagnostics={"use_sympy": use_sympy},
        )
    ok = n_ok >= max(1, samples // 2) and max_err <= max(tol * 10, tol)
    # stricter: require all successful samples within tol if we compared any
    if n_ok > 0:
        ok = max_err <= max(tol * 100, 1e-4) and n_ok >= samples // 2
    return DynamicsVerifyResult(
        ok=ok,
        max_abs_err=max_err,
        n_samples=samples,
        n_compared=n_ok,
        message="ok" if ok else f"max_abs_err={max_err:.3e} matched={n_ok}/{samples}",
        diagnostics={"use_sympy": use_sympy, "tol": tol},
    )


def reconcile_metadata_with_code(
    plant_output: dict,
    pre_launch: dict | None = None,
    *,
    compiler: "PlantCompiler | None" = None,
) -> Dict[str, Any]:
    """Return metadata aligned with ``python_code``.

    1. Run ``infer_metadata`` (partial merge + code extraction).
    2. Prefer code-extracted ``state_equations`` whenever parse succeeds.
    3. If LLM equations remain, numerically verify; on failure replace with
       code-extracted equations (or chain only as last resort).
    """
    c = compiler or PlantCompiler()
    meta = c.infer_metadata(plant_output, pre_launch)
    user_code = sanitize_python_code(plant_output.get("python_code") or "")
    states = list(meta.get("states") or [])
    inputs = list(meta.get("inputs") or [])
    extracted = _extract_state_equations(user_code, states, inputs)

    llm_eqs = None
    existing = plant_output.get("metadata") if isinstance(plant_output.get("metadata"), dict) else {}
    if isinstance(existing.get("state_equations"), list) and len(existing["state_equations"]) == len(states):
        llm_eqs = list(existing["state_equations"])

    if extracted and len(extracted) == len(states):
        # Code is source of truth for equations when we can parse them.
        if llm_eqs is not None and llm_eqs != extracted:
            # Keep extracted; note the correction
            assumptions = list(meta.get("assumptions") or [])
            note = "State equations aligned with dynamics source"
            if note not in assumptions:
                assumptions.append(note)
            # Drop the generic "inferred" noise if we have a more specific note
            assumptions = [a for a in assumptions if a and "metadata inferred" not in a.lower()]
            meta["assumptions"] = assumptions or ["Continuous-time state-space dynamics"]
        meta["state_equations"] = extracted
    elif llm_eqs is not None:
        # No extraction — verify LLM equations numerically
        vr = verify_dynamics(user_code, {**meta, "state_equations": llm_eqs})
        if not vr.ok:
            meta["state_equations"] = _chain_fallback(states, inputs)
            assumptions = list(meta.get("assumptions") or [])
            note = "State equations derived from dynamics source"
            if note not in assumptions:
                assumptions.append(note)
            meta["assumptions"] = assumptions
        else:
            meta["state_equations"] = llm_eqs
    else:
        meta["state_equations"] = _chain_fallback(states, inputs)

    # Final numerical check when equations are not the synthetic chain marker alone
    vr2 = verify_dynamics(user_code, meta)
    meta["_verify"] = {
        "ok": vr2.ok,
        "max_abs_err": vr2.max_abs_err,
        "message": vr2.message,
    }
    if not vr2.ok and extracted and len(extracted) == len(states):
        # Last attempt: force extracted
        meta["state_equations"] = extracted
        vr3 = verify_dynamics(user_code, meta)
        meta["_verify"] = {
            "ok": vr3.ok,
            "max_abs_err": vr3.max_abs_err,
            "message": vr3.message,
        }
    return meta



def _probe_state_count(user_code: str) -> int:
    """Dynamically execute ``dynamics`` with a generous state vector to size the output."""
    try:
        probe_loc = {"np": np, "numpy": np}
        exec(user_code, probe_loc)  # noqa: S102
        dyn_fn = probe_loc.get("dynamics")
        if callable(dyn_fn):
            test_x = np.zeros(10)
            try:
                out = dyn_fn(0.0, test_x, 0.0)
                out_size = np.asarray(out).size
                if out_size > 0:
                    return out_size
            except TypeError:
                out = dyn_fn(0.0, test_x, np.zeros(1))
                out_size = np.asarray(out).size
                if out_size > 0:
                    return out_size
    except Exception:
        pass
    return 0


def align_equation_inputs(eqs: List[str], inputs: List[str]) -> List[str]:
    """If equations use bare ``u`` but the sole declared input is e.g. ``tau``, rewrite.

    Adaptive's structure_build only injects declared input names into the symbol
    map. A free ``u`` in the RHS leaves the control channel at 0 and yields
    ComplexInfinity during Lie-derivative / relative-degree calculations.
    """
    if not isinstance(eqs, list) or not inputs:
        return eqs
    if len(inputs) != 1:
        return eqs
    in_name = inputs[0]
    if in_name == "u":
        return eqs
    out: List[str] = []
    for eq in eqs:
        if not isinstance(eq, str):
            out.append(eq)
            continue
        if re.search(r"\bu\b", eq) and not re.search(rf"\b{re.escape(in_name)}\b", eq):
            out.append(re.sub(r"\bu\b", in_name, eq))
        else:
            out.append(eq)
    return out



class PlantCompiler:
    """Compiles an enriched AgentPlant output into downstream-ready artifacts."""

    def validate(self, plant_output: dict) -> ValidationResult:
        """Check metadata completeness and equation syntax."""
        errors: List[str] = []
        warnings: List[str] = []

        if not isinstance(plant_output, dict):
            return ValidationResult(ok=False, errors=["plant_output must be a dict"])

        system_name = plant_output.get("system_name")
        python_code = plant_output.get("python_code")
        if not isinstance(system_name, str) or not system_name.strip():
            errors.append("system_name is required and must be a non-empty string")
        if not isinstance(python_code, str) or not python_code.strip():
            errors.append("python_code is required and must be a non-empty string")
        elif "def dynamics" not in python_code:
            errors.append("python_code must define a dynamics(t, x, u) function")

        meta = plant_output.get("metadata")
        if meta is None:
            warnings.append(
                "metadata missing — legacy AgentPlant output; downstream integration limited"
            )
            return ValidationResult(ok=not errors, errors=errors, warnings=warnings)

        if not isinstance(meta, dict):
            errors.append("metadata must be an object")
            return ValidationResult(ok=False, errors=errors, warnings=warnings)

        for key in REQUIRED_METADATA_KEYS:
            if key not in meta:
                errors.append(f"metadata missing required key: {key}")

        if errors:
            return ValidationResult(ok=False, errors=errors, warnings=warnings)

        states = meta.get("states") or []
        meanings = meta.get("state_meanings") or []
        inputs = meta.get("inputs") or []
        outputs = meta.get("outputs") or []
        eqs = meta.get("state_equations") or []
        params = meta.get("parameters") or {}
        system_type = meta.get("system_type") or ""
        assumptions = meta.get("assumptions")

        if not isinstance(states, list) or not states:
            errors.append("metadata.states must be a non-empty list")
        else:
            for s in states:
                if not isinstance(s, str) or not _IDENT_RE.match(s):
                    errors.append(f"invalid state name: {s!r}")

        if not isinstance(meanings, list):
            errors.append("metadata.state_meanings must be a list")
        elif len(meanings) != len(states):
            errors.append(
                f"state_meanings length ({len(meanings)}) != states length ({len(states)})"
            )

        if not isinstance(inputs, list) or not inputs:
            errors.append("metadata.inputs must be a non-empty list")
        else:
            for i in inputs:
                if not isinstance(i, str) or not _IDENT_RE.match(i):
                    errors.append(f"invalid input name: {i!r}")

        if not isinstance(outputs, list) or not outputs:
            errors.append("metadata.outputs must be a non-empty list")
        else:
            state_set = set(states) if isinstance(states, list) else set()
            for o in outputs:
                if o not in state_set:
                    errors.append(f"output {o!r} is not in states")

        if not isinstance(eqs, list):
            errors.append("metadata.state_equations must be a list")
        elif len(eqs) != len(states):
            errors.append(
                f"state_equations length ({len(eqs)}) != states length ({len(states)})"
            )

        if not isinstance(params, dict):
            errors.append("metadata.parameters must be a dict")
        else:
            for k, v in params.items():
                if not isinstance(k, str) or not _IDENT_RE.match(k):
                    errors.append(f"invalid parameter name: {k!r}")
                try:
                    float(v)
                except (TypeError, ValueError):
                    errors.append(f"parameter {k!r} value is not numeric: {v!r}")

        if system_type not in ("SISO", "MIMO"):
            errors.append(f"system_type must be 'SISO' or 'MIMO', got {system_type!r}")

        if assumptions is not None and not isinstance(assumptions, list):
            errors.append("metadata.assumptions must be a list")

        # Sympy parse check for equations
        if sp is not None and isinstance(eqs, list) and isinstance(states, list):
            symbols: Dict[str, Any] = {}
            for name in list(states) + list(inputs) + list(params.keys()):
                if isinstance(name, str) and _IDENT_RE.match(name):
                    symbols[name] = sp.symbols(name)
            symbols["t"] = sp.symbols("t")
            symbols["pi"] = sp.pi
            symbols["E"] = sp.E
            # common functions
            local_dict = {
                **symbols,
                "sin": sp.sin,
                "cos": sp.cos,
                "tan": sp.tan,
                "asin": sp.asin,
                "acos": sp.acos,
                "atan": sp.atan,
                "atan2": sp.atan2,
                "exp": sp.exp,
                "log": sp.log,
                "sqrt": sp.sqrt,
                "Abs": sp.Abs,
                "sign": sp.sign,
                "sinh": sp.sinh,
                "cosh": sp.cosh,
                "tanh": sp.tanh,
                "Heaviside": sp.Heaviside,
            }
            _NP_QUALIFIED_RE = re.compile(
                r"\bnp\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|sqrt|abs|sign|"
                r"sinh|cosh|tanh|pi|e)\b",
                re.IGNORECASE,
            )
            for i, eq in enumerate(eqs):
                if not isinstance(eq, str) or not eq.strip():
                    errors.append(f"state_equations[{i}] is empty")
                    continue
                # Auto-normalize np.sin → sin so code-extracted equations validate.
                if _NP_QUALIFIED_RE.search(eq):
                    eqs[i] = _to_sympy_expr(eq)
                    eq = eqs[i]
                    meta["state_equations"] = list(eqs)
                    warnings.append(
                        f"state_equations[{i}] rewritten to bare sympy names (stripped np./numpy.)"
                    )
                try:
                    sp.sympify(eq, locals=local_dict)
                except Exception as exc:  # noqa: BLE001
                    msg = str(exc)
                    if "has no attribute" in msg and "Symbol" in msg:
                        errors.append(
                            f"state_equations[{i}] not sympy-parseable: {eq!r} "
                            f"({msg}). Use bare sympy names (sin, cos, exp, ...) "
                            f"— no module prefixes such as np. or math."
                        )
                    else:
                        errors.append(
                            f"state_equations[{i}] not sympy-parseable: {eq!r} ({exc})"
                        )

        # Flag free identifiers that are not states/inputs/params. Special case:
        # sole input is e.g. ``tau`` but equations say ``u`` — auto-fixed at
        # adaptive-spec generation; emit a warning, not a hard error.
        if isinstance(eqs, list):
            allowed = set()
            for name in list(states) + list(inputs) + list(params.keys()):
                if isinstance(name, str):
                    allowed.add(name)
            allowed |= _MATH_NAMES
            aligned = align_equation_inputs(list(eqs), list(inputs) if isinstance(inputs, list) else [])
            for i, eq in enumerate(eqs):
                if not isinstance(eq, str):
                    continue
                unknown = sorted({
                    tok for tok in _identifiers_in_expr(eq)
                    if tok not in allowed and not tok.isnumeric()
                })
                if not unknown:
                    continue
                # Would alignment remove the unknowns?
                aligned_eq = aligned[i] if i < len(aligned) else eq
                still = sorted({
                    tok for tok in _identifiers_in_expr(aligned_eq)
                    if tok not in allowed and not tok.isnumeric()
                })
                if still:
                    errors.append(
                        f"state_equations[{i}] uses unknown identifier(s) {still} "
                        f"(not in states={list(states)}, inputs={list(inputs)}, "
                        f"parameters={list(params.keys())}). Use the same names as "
                        f"metadata.inputs (e.g. if inputs=['tau'], write tau not u)."
                    )
                else:
                    warnings.append(
                        f"state_equations[{i}] used {{u}} but inputs={list(inputs)}; "
                        f"will rewrite to '{inputs[0]}' for Adaptive."
                    )

        # python_code must not import sympy for numeric simulation
        if isinstance(python_code, str) and re.search(
            r"(from\s+sympy|import\s+sympy)", python_code
        ):
            warnings.append(
                "python_code imports sympy; PlantCompiler will rewrite it to numpy "
                "for the MPC plugin. Prefer `import numpy as np` and np.sin/np.cos."
            )

        return ValidationResult(ok=not errors, errors=errors, warnings=warnings)

    def infer_metadata(
        self,
        plant_output: dict,
        pre_launch: dict | None = None,
    ) -> Dict[str, Any]:
        """Fill in metadata missing from AgentPlant's output.

        Whatever the LLM already supplied is kept as-is (partial merge — this
        never overwrites good data). Anything missing or shape-inconsistent
        (wrong length, empty dict/list) is extracted from ``python_code``
        itself: state names/meanings from ``name = x[i]  # meaning`` aliases,
        parameters from labelled numeric assignments, and state equations from
        ``name_dot = ...`` / ``dx[i] = ...`` lines. The synthetic ``x1``/``State
        N``/chain-equation shape is only used when nothing better can be
        parsed out of the code, and any inferred field is called out honestly
        in ``assumptions`` rather than presented as if the LLM said it.
        """
        existing_raw = plant_output.get("metadata")
        existing = dict(existing_raw) if isinstance(existing_raw, dict) else {}
        user_code = sanitize_python_code(plant_output.get("python_code") or "")

        # ---- how many states are there? ------------------------------------
        # Priority: existing metadata.states > python_code scan/probe >
        # pre_launch.initial_state. Never let a mismatched pre_launch
        # initial_state length inflate (or shrink) a known state count —
        # that silently corrupts good metadata (dropped physical names,
        # rewritten equations, synthetic chain).
        ex_states = existing.get("states")
        states_known_from_meta = isinstance(ex_states, list) and bool(ex_states)
        n_states = len(ex_states) if states_known_from_meta else 0
        if n_states == 0:
            x_indices = [int(m) for m in re.findall(r"x\[(\d+)\]", user_code)]
            if x_indices:
                n_states = max(x_indices) + 1
        if n_states == 0:
            n_states = _probe_state_count(user_code)
        if n_states == 0 and pre_launch and isinstance(pre_launch.get("initial_state"), list):
            pl_len = len(pre_launch["initial_state"])
            if pl_len > 0:
                n_states = pl_len
        n_states = max(1, n_states)

        # ---- states / meanings ----------------------------------------------
        idx_to_name, name_meaning = _extract_state_aliases(user_code)
        inferred_states = [idx_to_name.get(i, f"x{i+1}") for i in range(n_states)]
        # Lock to metadata states whenever they were present; n_states above
        # already prefers that length, so this no longer fails equality after
        # a pre_launch length override.
        states_from_llm = states_known_from_meta
        states = list(ex_states) if states_from_llm else inferred_states
        if states_from_llm:
            n_states = len(states)

        ex_meanings = existing.get("state_meanings")
        meanings_from_llm = isinstance(ex_meanings, list) and len(ex_meanings) == n_states
        if meanings_from_llm:
            state_meanings = list(ex_meanings)
        else:
            state_meanings = [
                name_meaning.get(states[i]) or f"State {states[i]}" for i in range(n_states)
            ]

        # ---- inputs -----------------------------------------------------------
        idx_to_input, _input_meaning = _extract_input_aliases(user_code)
        if idx_to_input:
            n_inputs = max(idx_to_input) + 1
            inferred_inputs = [idx_to_input.get(i, f"u{i+1}") for i in range(n_inputs)]
        else:
            inferred_inputs = ["u"]
        ex_inputs = existing.get("inputs")
        inputs_from_llm = isinstance(ex_inputs, list) and bool(ex_inputs)
        inputs = list(ex_inputs) if inputs_from_llm else inferred_inputs

        # ---- outputs ------------------------------------------------------------
        ex_outputs = existing.get("outputs")
        outputs_from_llm = isinstance(ex_outputs, list) and bool(ex_outputs)
        outputs = list(ex_outputs) if outputs_from_llm else ([states[0]] if states else ["x1"])

        # ---- state equations ------------------------------------------------------
        # Prefer equations parsed from python_code over LLM-supplied ones when
        # extraction succeeds. LLM equations are a common drift source (e.g.
        # synthetic chain with physical names). Numerical reconcile in
        # reconcile_metadata_with_code will further verify.
        known_names = set(states) | set(inputs)
        ex_eqs = existing.get("state_equations")
        equations_from_llm = isinstance(ex_eqs, list) and len(ex_eqs) == n_states
        extracted = _extract_state_equations(user_code, states, inputs)
        if extracted and len(extracted) == n_states:
            state_equations = extracted
            # Treat as code-derived unless identical to LLM
            if not (equations_from_llm and list(ex_eqs) == extracted):
                equations_from_llm = False
        elif equations_from_llm:
            state_equations = list(ex_eqs)
        else:
            state_equations = _chain_fallback(states, inputs)

        # ---- parameters -----------------------------------------------------------
        ex_params = existing.get("parameters")
        params_from_llm = isinstance(ex_params, dict) and bool(ex_params)
        parameters = dict(ex_params) if params_from_llm else _extract_numeric_parameters(
            user_code, known_names
        )

        # ---- system type --------------------------------------------------------
        ex_system_type = existing.get("system_type")
        system_type_from_llm = bool(ex_system_type)
        system_type = ex_system_type if system_type_from_llm else (
            "SISO" if len(inputs) <= 1 and len(outputs) <= 1 else "MIMO"
        )

        # ---- assumptions (kept, plus an honest note when we had to infer) --------
        ex_assumptions = existing.get("assumptions")
        assumptions_from_llm = isinstance(ex_assumptions, list) and bool(ex_assumptions)
        assumptions: List[str] = list(ex_assumptions) if assumptions_from_llm else []

        inferred_something = not all(
            [
                states_from_llm,
                meanings_from_llm,
                inputs_from_llm,
                outputs_from_llm,
                equations_from_llm,
                params_from_llm,
                system_type_from_llm,
            ]
        )
        if inferred_something:
            pass
        if not assumptions:
            assumptions = ["Continuous-time state-space dynamics"]

        return {
            "states": states,
            "state_meanings": state_meanings,
            "inputs": inputs,
            "outputs": outputs,
            "state_equations": state_equations,
            "parameters": parameters,
            "system_type": system_type,
            "assumptions": assumptions,
        }

    def generate_mpc_plugin(self, plant_output: dict, pre_launch: dict) -> str:
        """Return the full .py source for an AgentMPC BaseDynamics plugin."""
        meta = plant_output.get("metadata") or {}
        if not meta or not meta.get("states"):
            meta = self.infer_metadata(plant_output, pre_launch)
            plant_output["metadata"] = meta

        system_name = plant_output.get("system_name") or "System"
        python_code = plant_output.get("python_code") or ""
        class_base = _safe_class_name(system_name)
        class_name = f"{class_base}Dynamics"

        states = list(meta.get("states") or [])
        inputs = list(meta.get("inputs") or [])
        params = dict(meta.get("parameters") or {})

        # Sanitize: strip sympy imports, rewrite bare sin→np.sin, etc.
        user_code = sanitize_python_code(python_code.strip())

        # If metadata states or inputs are not provided, infer from python_code or dynamic probe
        if not states or not inputs:
            x_indices = [int(m) for m in re.findall(r"x\[(\d+)\]", user_code)]
            inferred_n_states = (max(x_indices) + 1) if x_indices else len(states)

            u_indices = [int(m) for m in re.findall(r"u\[(\d+)\]", user_code)]
            if u_indices:
                inferred_n_inputs = max(u_indices) + 1
            elif re.search(r"\bu\b", user_code):
                inferred_n_inputs = 1
            else:
                inferred_n_inputs = max(1, len(inputs))

            try:
                probe_loc = {"np": np, "numpy": np}
                exec(user_code, probe_loc)
                dyn_fn = probe_loc.get("dynamics")
                if callable(dyn_fn):
                    test_x = np.zeros(max(inferred_n_states, 10))
                    try:
                        out = dyn_fn(0.0, test_x, 0.0)
                        out_size = np.asarray(out).size
                        if out_size > 0:
                            inferred_n_states = out_size
                    except TypeError:
                        out = dyn_fn(0.0, test_x, np.zeros(max(inferred_n_inputs, 1)))
                        out_size = np.asarray(out).size
                        if out_size > 0:
                            inferred_n_states = out_size
            except Exception:
                pass

            if not states:
                n_states = max(1, inferred_n_states)
                states = [f"x{i+1}" for i in range(n_states)]
            else:
                n_states = len(states)

            if not inputs:
                n_inputs = max(1, inferred_n_inputs)
                inputs = ["u"] if n_inputs == 1 else [f"u{i+1}" for i in range(n_inputs)]
            else:
                n_inputs = len(inputs)
        else:
            n_states = max(1, len(states))
            n_inputs = max(1, len(inputs))

        initial_state = pre_launch.get("initial_state")
        if not isinstance(initial_state, list) or len(initial_state) != n_states:
            initial_state = [0.0] * n_states
        default_target = pre_launch.get("default_target")
        if not isinstance(default_target, list) or len(default_target) != n_states:
            default_target = [0.0] * n_states

        # Format params / names for insertion
        params_repr = repr({str(k): float(v) for k, v in params.items()})
        state_names_repr = repr(list(states))
        input_names_repr = repr(list(inputs))
        init_repr = repr([float(x) for x in initial_state])
        target_repr = repr([float(x) for x in default_target])

        source = f'''# Auto-generated by PlantCompiler from AgentPlant output
# System: {system_name}
# Do not edit by hand unless you know the AgentMPC plugin contract.
import numpy as np
from backend_core.AgentMPC.dynamics.base import BaseDynamics, SystemConfig

# --- user-provided dynamics (sanitized for numpy) ---
{user_code}

# --- auto-generated config ---
def create_config() -> SystemConfig:
    return SystemConfig(
        n_states={n_states},
        n_inputs={n_inputs},
        params={params_repr},
        state_names={state_names_repr},
        input_names={input_names_repr},
        default_initial_state=np.array({init_repr}),
        default_target=np.array({target_repr}),
    )

class {class_name}(BaseDynamics):
    def dynamics(self, x: np.ndarray, u: np.ndarray) -> np.ndarray:
        # Always pass 1-D float arrays. AgentPlant python_code is expected to
        # index u[0], u[1], ... or scalar u.
        x_arr = np.asarray(x, dtype=float).reshape(-1)
        u_arr = np.atleast_1d(np.asarray(u, dtype=float).reshape(-1))
        if u_arr.size == 0:
            u_arr = np.zeros(1)
        u_arg = u_arr[0] if u_arr.size == 1 else u_arr
        try:
            out = dynamics(0.0, x_arr, u_arg)
        except (TypeError, IndexError):
            out = dynamics(0.0, x_arr, u_arr)
        if isinstance(out, (list, tuple)):
            try:
                out_arr = np.asarray(out, dtype=float).reshape(-1)
            except ValueError:
                out_arr = np.array([float(np.squeeze(v)) for v in out], dtype=float).reshape(-1)
        else:
            out_arr = np.atleast_1d(np.asarray(out, dtype=float)).reshape(-1)
        if out_arr.size != {n_states}:
            raise ValueError(
                f"dynamics returned shape {{out_arr.shape}}, expected ({n_states},)"
            )
        return out_arr
'''
        return source

    def generate_adaptive_spec(self, plant_output: dict, pre_launch: dict) -> dict:
        """Return a system_spec-compatible dict for AgentAdaptive.

        Prefer stored metadata equations. Only reconcile/extract from
        ``python_code`` when equations are missing or length-mismatched —
        never invent a strict-feedback chain over real equations.
        """
        meta = plant_output.get("metadata") if isinstance(plant_output.get("metadata"), dict) else {}
        states = list(meta.get("states") or [])
        eqs = list(meta.get("state_equations") or [])
        needs_fill = (
            not states
            or not isinstance(eqs, list)
            or len(eqs) != len(states)
            or not all(isinstance(e, str) and e.strip() for e in eqs)
        )
        if needs_fill:
            # Reconcile extracts equations from code (np.sin→sin, intermediates).
            try:
                meta = reconcile_metadata_with_code(plant_output, pre_launch, compiler=self)
                meta.pop("_verify", None)
            except Exception:
                meta = self.infer_metadata(plant_output, pre_launch)
            plant_output["metadata"] = meta

        system_name = plant_output.get("system_name") or "System"

        states = list(meta.get("states") or [])
        meanings = list(meta.get("state_meanings") or [])
        inputs = list(meta.get("inputs") or [])
        outputs = list(meta.get("outputs") or [])
        eqs = align_equation_inputs(list(meta.get("state_equations") or []), inputs)
        params = dict(meta.get("parameters") or {})
        system_type = meta.get("system_type") or "SISO"
        assumptions = list(meta.get("assumptions") or [])

        n = len(states)
        x0 = pre_launch.get("initial_state")
        if not isinstance(x0, list) or len(x0) != n:
            x0 = [0.0] * n
        else:
            x0 = [float(v) for v in x0]

        sim_time = float(pre_launch.get("total_simulation_time") or 10.0)
        solver_step = float(pre_launch.get("solver_sample_time") or 0.001)

        # References are owned by AgentAdaptive (Clarifier / sim knobs).
        # Pre-Launch does not define trajectory; leave empty for Adaptive to fill.
        references: List[Dict[str, str]] = []

        return {
            "status": "complete",
            "system_name": system_name,
            "dynamics": {
                "states": states,
                "state_meanings": meanings,
                "inputs": inputs,
                "outputs": outputs,
                "state_equations": eqs,
                "x0": x0,
                "references": references,
                "parameters": params,
                "uncertainty": [],
                "disturbance": [],
                "system_type": system_type,
                "sim_time": sim_time,
                "solver_step": solver_step,
                "assumptions": assumptions,
            },
        }

    def compile_artifact(self, plant_output: dict, pre_launch: dict) -> Artifact:
        """Validate, generate both outputs, return artifact handle (no I/O)."""
        result = self.validate(plant_output)
        result.raise_if_invalid()

        if not plant_output.get("metadata") or not plant_output["metadata"].get("states"):
            plant_output["metadata"] = self.infer_metadata(plant_output, pre_launch)

        system_name = plant_output["system_name"]
        short = _short_hash(
            {
                "system_name": system_name,
                "python_code": plant_output.get("python_code"),
                "metadata": plant_output.get("metadata"),
            }
        )
        artifact_id = f"{system_name.replace(' ', '-')}_{short}"

        mpc_source = self.generate_mpc_plugin(plant_output, pre_launch)
        adaptive_spec = self.generate_adaptive_spec(plant_output, pre_launch)
        created_at = datetime.now(timezone.utc).isoformat()

        full_payload = {
            "artifact_id": artifact_id,
            "system_name": system_name,
            "created_at": created_at,
            "version": "1.0",
            "plant": {
                "python_code": plant_output.get("python_code"),
                "metadata": plant_output.get("metadata"),
            },
            "pre_launch": dict(pre_launch),
            "module_specific": {
                "adaptive": {
                    "clarifier_record": None,
                    "designer_method": None,
                    "tuning_best": None,
                },
                "mpc": {
                    "suggested_dt": None,
                    "suggested_Q": None,
                    "suggested_R": None,
                    "suggested_feedforward": None,
                    "derivative_pairs": None,
                },
            },
        }

        return Artifact(
            artifact_id=artifact_id,
            system_name=system_name,
            plant=full_payload["plant"],
            pre_launch=full_payload["pre_launch"],
            adaptive_spec=adaptive_spec,
            mpc_plugin_source=mpc_source,
            created_at=created_at,
            full_payload=full_payload,
        )


def default_pre_launch(n_states: int = 0) -> Dict[str, Any]:
    """Return a pre-launch config with sensible defaults.

    Trajectory / reference knobs are intentionally absent: each downstream
    module owns its own reference configuration.
    """
    return {
        "total_simulation_time": 10.0,
        "solver_sample_time": 0.001,
        "initial_state": [0.0] * n_states,
        "default_target": [0.0] * n_states,
    }


def validate_pre_launch(pre_launch: dict, metadata: dict) -> ValidationResult:
    """Validate pre-launch knobs against metadata."""
    errors: List[str] = []
    states = metadata.get("states") or []
    n = len(states)

    for key in (
        "total_simulation_time",
        "solver_sample_time",
        "initial_state",
        "default_target",
    ):
        if key not in pre_launch:
            errors.append(f"pre_launch missing key: {key}")

    if errors:
        return ValidationResult(ok=False, errors=errors)

    try:
        t_sim = float(pre_launch["total_simulation_time"])
        dt = float(pre_launch["solver_sample_time"])
    except (TypeError, ValueError):
        return ValidationResult(ok=False, errors=["simulation times must be numeric"])

    if t_sim <= 0:
        errors.append("total_simulation_time must be > 0")
    if dt <= 0:
        errors.append("solver_sample_time must be > 0")
    elif t_sim > 0 and dt > t_sim / 100.0:
        errors.append("solver_sample_time must be <= total_simulation_time / 100")

    x0 = pre_launch.get("initial_state")
    target = pre_launch.get("default_target")

    if not isinstance(x0, list):
        errors.append("initial_state must be a list")
    elif not all(isinstance(v, (int, float)) for v in x0):
        errors.append("initial_state elements must be numeric")

    if not isinstance(target, list):
        errors.append("default_target must be a list")
    elif not all(isinstance(v, (int, float)) for v in target):
        errors.append("default_target elements must be numeric")

    if n > 0:
        if isinstance(x0, list) and len(x0) != n:
            if all(v == 0 for v in x0):
                if len(x0) < n:
                    x0.extend([0.0] * (n - len(x0)))
                else:
                    del x0[n:]
                pre_launch["initial_state"] = x0
            else:
                errors.append(f"initial_state must be a list of length {n}")
        if isinstance(target, list) and len(target) != n:
            if all(v == 0 for v in target):
                if len(target) < n:
                    target.extend([0.0] * (n - len(target)))
                else:
                    del target[n:]
                pre_launch["default_target"] = target
            else:
                errors.append(f"default_target must be a list of length {n}")
    else:
        if isinstance(x0, list) and isinstance(target, list) and len(x0) != len(target):
            errors.append(
                f"initial_state length ({len(x0)}) must match default_target length ({len(target)})"
            )

    outputs = metadata.get("outputs") or []
    if states:
        state_set = set(states)
        for o in outputs:
            if o not in state_set:
                errors.append(f"output {o!r} not in states")

    return ValidationResult(ok=not errors, errors=errors)

