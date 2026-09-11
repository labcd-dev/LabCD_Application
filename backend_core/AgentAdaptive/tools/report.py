import datetime
import re

from labcd_pdfmaker import Backend, ReportBuilder

from . import model_pricing


def normalize_latex_delimiters(text: str) -> str:
    """Convert \\[...\\] / \\(...\\) to $$...$$ / $...$ for markdown/XeLaTeX path.

    Shared by Streamlit and the Adaptive API so both PDF paths typeset the same.
    """
    if not text:
        return text
    text = re.sub(r"\\\[(.*?)\\\]", lambda m: "$$" + m.group(1) + "$$", text, flags=re.DOTALL)
    text = re.sub(r"\\\((.*?)\\\)", lambda m: "$" + m.group(1) + "$", text, flags=re.DOTALL)
    return text


_ALIGN_ENV_RE = re.compile(
    r"\$?\$?\s*\\begin\{(aligned|align\*?|gather\*?)\}(.*?)\\end\{\1\}\s*\$?\$?",
    re.DOTALL,
)


def sanitize_latex_environments(text: str) -> str:
    """Flatten align/aligned/gather environments into display math lines.

    ReportLab and some markdown→TeX paths mishandle nested align inside $...$;
    Streamlit and the API both apply this before build_pdf_report.
    """
    if not text:
        return text

    def _fix(m):
        body = m.group(2)
        lines = re.split(r"\\\\(?:\[\d+pt\])?", body)
        out = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            line = line.replace("&", "")
            for cmd in (r"\quad", r"\qquad", r"\,", r"\!", r"\bigl", r"\bigr", r"\Bigl", r"\Bigr"):
                line = line.replace(cmd, "")
            out.append("$$" + line.strip() + "$$")
        return "\n\n".join(out)

    return _ALIGN_ENV_RE.sub(_fix, text)


def sanitize_latex_superscripts(text: str) -> str:
    """Sanitize TeX formulas against double-superscript errors like `\\bar w_i'^2`.

    In LaTeX, prime (') expands to `^\\prime`, so an unbracketed `w'^2` causes
    TeX error `! Double superscript.`. Enclosing the base and prime in braces,
    e.g. `{w'}^2` or `{\\bar w_i'}^2`, compiles cleanly.
    """
    if not text:
        return text

    # Fix prime(s) followed by superscript: e.g. \bar w_i'^2 -> {\bar w_i'}^2, w'^2 -> {w'}^2
    text = re.sub(
        r"((?:\\[a-zA-Z]+(?:\s*\{[^}]*\}|\s+)?|[a-zA-Z0-9_\\\}]+)+)('+)\^(\d+|\{[^}]+\}|[a-zA-Z])",
        r"{\1\2}^{\3}",
        text,
    )
    # Generic fallback for any other word/closing brace ending in prime before ^
    text = re.sub(r"([a-zA-Z0-9_\\\}]+)('+)\^(\d+|\{[^}]+\}|[a-zA-Z])", r"{\1\2}^{\3}", text)
    # Fix consecutive unbracketed superscripts: e.g. x^a^b -> x^{a^{b}}
    text = re.sub(r"\^([a-zA-Z0-9])\^([a-zA-Z0-9])", r"^{\1^{\2}}", text)
    return text


def prepare_summary_markdown(text: str) -> str:
    """Apply LaTeX delimiter + environment + superscript sanitization for robust PDF rendering."""
    if not text:
        return text or ""
    sanitized = sanitize_latex_superscripts(sanitize_latex_environments(text))
    return normalize_latex_delimiters(sanitized)


def _pct_cell(value) -> str:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return "n/a"
    if f != f:  # NaN
        return "n/a"
    return "%.1f%%" % f


def _normalize_figure(fig):
    """Accept bytes, (png_bytes, title) tuples, or {"png": ..., "title": ...} dicts."""
    if isinstance(fig, (bytes, bytearray)):
        return bytes(fig), ""
    if isinstance(fig, (tuple, list)) and len(fig) >= 1:
        png = fig[0]
        title = fig[1] if len(fig) > 1 else ""
        return bytes(png) if isinstance(png, (bytes, bytearray)) else png, str(title or "")
    if isinstance(fig, dict):
        png = fig.get("png") or fig.get("bytes") or fig.get("data")
        title = fig.get("title") or fig.get("caption") or ""
        if isinstance(png, (bytes, bytearray)):
            return bytes(png), str(title)
        return png, str(title)
    raise TypeError(
        "figure must be bytes, (bytes, title) tuple, or dict with 'png' key; got %s"
        % type(fig).__name__
    )


def _add_run_scores_section(rb: ReportBuilder, final_metrics) -> None:
    if not isinstance(final_metrics, dict):
        return
    has_success = "success" in final_metrics
    has_tracking = "tracking_pct_headline" in final_metrics
    if not has_success and not has_tracking:
        return

    rb.add_section("Run Verdict and Reference Tracking")

    if has_success:
        success = bool(final_metrics.get("success"))
        if success:
            rb.add_status_badge(True, "RUN VERDICT: PASS")
            target_frac = final_metrics.get("success_target_frac")
            target_str = ("%.1f%%" % (100.0 * target_frac)
                          if isinstance(target_frac, (int, float)) else "the target")
            rb.add_markdown(
                "The closed loop stayed finite and bounded, and every output's "
                "steady-state MSE reached the user's target (%s of the task "
                "scale)." % target_str)
        else:
            reason = str(final_metrics.get("success_reason") or "one of the run checks failed")
            rb.add_status_badge(False, "RUN VERDICT: FAIL: " + reason)
        checks = final_metrics.get("success_checks") or {}
        if isinstance(checks, dict) and checks:
            rows = [[name, "pass" if ok else "FAIL"] for name, ok in checks.items()]
            rb.add_data_table(["Check", "Result"], rows, markdown_cells=False)

    if has_tracking:
        headline = final_metrics.get("tracking_pct_headline")
        mean = final_metrics.get("tracking_pct_mean")
        line = "**Reference tracking: %s** (worst output, steady state)" % _pct_cell(headline)
        if mean is not None:
            line += " -- %s mean over outputs." % _pct_cell(mean)
        rb.add_markdown(line)
        rb.add_markdown(
            "Scored against the RMS error a null controller (one that left "
            "the output frozen at its initial value) would have produced "
            "over the same reference. 100% means the output sits exactly on "
            "the reference; 0% means it tracked no better than not acting at "
            "all. This normalizer, rather than the peak reference magnitude, "
            "is what keeps the score honest for a reference that oscillates "
            "by a little around a large offset, and defined at all for pure "
            "regulation to zero.")

        pct = final_metrics.get("tracking_pct")
        pct = pct if isinstance(pct, dict) else {}
        full = list(pct.get("full") or [])
        steady = list(pct.get("steady") or [])
        transient = list(pct.get("transient") or [])
        trivial = list(final_metrics.get("task_trivial") or [])
        n = max(len(full), len(steady), len(transient))
        if n:
            header = ["Output", "Full run", "Steady state (last 20%)", "Transient (first 20%)"]
            show_trivial = any(trivial)
            if show_trivial:
                header.append("Task")
            rows = []
            for i in range(n):
                row = ["y%d" % (i + 1),
                       _pct_cell(full[i] if i < len(full) else None),
                       _pct_cell(steady[i] if i < len(steady) else None),
                       _pct_cell(transient[i] if i < len(transient) else None)]
                if show_trivial:
                    row.append("stay put" if (i < len(trivial) and trivial[i]) else "tracking")
                rows.append(row)
            rb.add_data_table(header, rows)

    rb.add_markdown(
        "The verdict answers “does this design work at all”; the tuning "
        "target reported in the Parameter Tuning section answers the separate "
        "and stricter question of whether it is good enough. A run can pass "
        "here and still miss that target.")


def _add_clarification_section(rb: ReportBuilder, clarification_record) -> None:
    if not clarification_record:
        return

    rows = []
    for entry in clarification_record:
        if not isinstance(entry, dict):
            continue
        question = str(entry.get("question") or entry.get("id") or "")
        answer = str(entry.get("answer_label") or entry.get("answer_value")
                     or entry.get("default_label") or "")
        # 3 sources, not 2 (text read straight from the user's sentence isn't
        # an "assumed default"): it needs its own bucket, cited in this cell
        source = str(entry.get("source") or ("user" if entry.get("answered") else "default"))
        if source == "description":
            evidence = str(entry.get("evidence") or "").strip()
            source = ("read from your description: “%s”" % evidence
                      if evidence else "read from your description")
        elif source == "user":
            source = "user"
        else:
            source = "assumed default"
        rows.append([question, answer, source])

    if not rows:
        return

    rb.add_section("Clarifications")
    rb.add_markdown(
        "Before extraction, the Clarifier Agent asked about the parts of the "
        "system description that could be read more than one way. The answers "
        "below were treated as authoritative by every later stage. Rows marked "
        "*assumed default* were not answered by the user. The stated "
        "default was applied instead, so those are the assumptions the design "
        "depends on. Rows marked *read from your description* were "
        "never put to the user at all: the description already settled them, "
        "and the sentence it was read from is quoted so the reading can be "
        "checked.")
    # markdown_cells=False: this is literal user/LLM text, an asterisk in it
    # should print literally rather than turn into markdown emphasis.
    rb.add_data_table(["Question", "Answer", "Source"], rows, markdown_cells=False)


def _add_tuning_section(rb: ReportBuilder, tuning_log, tuning_best) -> None:
    if not tuning_log:
        return

    rb.add_section("Parameter Tuning (Tuner Agent)")
    rb.add_markdown(
        "The Tuner Agent never sees or changes the system description, states, "
        "dynamics, or has_delta/has_disturbance; it only reads the "
        "simulation metrics and proposes new tuning parameters, using its "
        "own model/API call, separate from the Design Agent.")

    if len(tuning_log) == 1 and tuning_log[0]["round"] == 0:
        r0 = tuning_log[0].get("reasoning") or ""
        if r0 and r0 != "(initial design, before tuning)":
            rb.add_markdown(r0)

    if tuning_best is not None:
        best_round = tuning_best["round"]
        best_entry = next((e for e in tuning_log if e["round"] == best_round), None)
        if best_round == 0:
            rb.add_markdown("Tuning made no improvement: the Design Agent's original design "
                             "(round 0) is still the best result.")
        else:
            met = bool(best_entry and best_entry.get("met_target"))
            rb.add_status_badge(met, "Target met." if met else
                "Best result reached after %d round(s); target not fully met, "
                "best attempt kept." % best_round)
            if best_entry and best_entry.get("reasoning"):
                rb.add_markdown("**Tuner Agent's reasoning for this final result:** "
                                 + best_entry["reasoning"])

        rb.add_subsection("Final tuning parameter values")
        rb.add_key_value_table([(str(k), str(v)) for k, v in tuning_best["tuning"].items()])

        if best_entry and best_entry.get("report"):
            rb.add_verbatim(best_entry["report"])

    if len(tuning_log) > 1:
        rb.add_subsection("Full tuning round history")
        for entry in tuning_log:
            label = "Round %d" % entry["round"]
            label += " (Design Agent's original design)" if entry["round"] == 0 else " (Tuner Agent's proposal)"
            if entry.get("met_target"):
                label += ", target met"
            rb.add_markdown("**%s**" % label)

            reasoning = entry.get("reasoning")
            if reasoning and reasoning != "(initial design, before tuning)":
                rb.add_markdown(reasoning)

            changed = entry.get("changed") or {}
            if entry["round"] > 0:
                if changed:
                    rb.add_diff_table(changed)
                else:
                    rb.add_markdown("*No tuning parameters were changed this round.*")

            if entry.get("report"):
                rb.add_verbatim(entry["report"], fontsize="footnotesize")


def _add_usage_section(rb: ReportBuilder, usage) -> None:
    if not usage:
        return
    cost_rows, cost_total = model_pricing.run_cost_rows(usage)
    if not cost_rows:
        return

    # 5 cols, not 6: a cached-tokens column would overflow, so it rides in
    # the input cell.
    rows = []
    for r in cost_rows:
        cached = r["cached_input_tokens"]
        input_cell = format(r["input_tokens"], ",")
        if cached:
            input_cell += " (%s cached)" % format(cached, ",")
        rows.append([r["label"], r["model"], input_cell,
                     format(r["output_tokens"], ","),
                     model_pricing.format_cost_plain(r["cost"])])
    rows.append(["Total", "", "",
                 format((usage.get("total") or {}).get("total_tokens", 0), ","),
                 model_pricing.format_cost_plain(cost_total)])

    rb.add_section("Token Usage and Cost")
    rb.add_data_table(["Agent", "Model", "Input tokens", "Output tokens", "Cost (USD)"], rows)
    rb.add_markdown(
        "Cached input is the portion served from the provider's prompt cache "
        "and billed at a reduced rate; it is already counted inside the input "
        "column. Figures are an estimate based on the tokens this run "
        "reported.")


def build_pdf_report(summary_markdown: str, figures,
                      usage=None, log_text=None, tuning_log=None,
                      tuning_best=None, clarification_record=None,
                      final_metrics=None, abstract_markdown=None,
                      prefer_xelatex: bool = True) -> bytes:
    """Build engineering PDF report with XeLaTeX when available and automatic ReportLab fallback."""
    try:
        from labcd_pdfmaker import xelatex_available
        has_xelatex = bool(xelatex_available())
    except Exception:
        has_xelatex = False

    # Ensure robust math sanitization
    clean_summary = prepare_summary_markdown(summary_markdown or "")
    clean_abstract = (
        prepare_summary_markdown(abstract_markdown.strip())
        if (abstract_markdown and abstract_markdown.strip())
        else None
    )

    def _assemble(target_backend: Backend) -> ReportBuilder:
        b = ReportBuilder(
            title="Agentic Nonlinear Control Designer: Report",
            backend=target_backend,
            date=datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        )
        if clean_abstract:
            b.add_abstract(clean_abstract)
        b.add_table_of_contents()
        _add_run_scores_section(b, final_metrics)
        b.add_section("Design Summary", clean_summary)
        _add_clarification_section(b, clarification_record)
        if tuning_log:
            b.add_page_break()
        _add_tuning_section(b, tuning_log, tuning_best)
        _add_usage_section(b, usage)
        if figures:
            b.add_page_break()
            b.add_section("Plots")
            for i, fig in enumerate(figures):
                png_bytes, title = _normalize_figure(fig)
                caption = ("Figure %d. %s" % (i + 1, title)) if title else ("Figure %d." % (i + 1))
                b.add_figure(png_bytes, caption=caption)
        if log_text:
            b.add_page_break()
            b.add_section("Appendix: Full Console Log")
            b.add_verbatim(log_text, fontsize="scriptsize")
        return b

    if prefer_xelatex and has_xelatex:
        rb = _assemble(Backend.XELATEX)
        try:
            return rb.build()
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "XeLaTeX build failed (%s); automatically falling back to ReportLab backend", exc
            )
            rb_fallback = _assemble(Backend.REPORTLAB)
            return rb_fallback.build()
    else:
        rb = _assemble(Backend.AUTO if not prefer_xelatex else Backend.REPORTLAB)
        return rb.build()
