"""Daily Telegram digest for product analytics."""

from __future__ import annotations

import html
import logging
import threading
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from backend_api.db.session import SessionLocal
from backend_api.http.schemas.analytics import (
    TelegramAnalyticsSettings,
    TelegramAnalyticsTestResult,
)
from backend_api.http.services import analytics_service, api_key_service, plan_service

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN_KEY = "TELEGRAM_BOT_TOKEN"
_TELEGRAM_ENV_ALLOWED = frozenset({TELEGRAM_BOT_TOKEN_KEY})

SETTING_ENABLED = "analytics.telegram.enabled"
SETTING_CHAT_ID = "analytics.telegram.chat_id"
SETTING_SEND_HOUR = "analytics.telegram.send_hour_utc"
SETTING_LAST_SENT = "analytics.telegram.last_sent_date"

# Midnight UTC: report the previous completed UTC day (full 24h).
DEFAULT_SEND_HOUR_UTC = 0
_SCHEDULER_POLL_SECONDS = 60

_stop_event = threading.Event()
_scheduler_thread: threading.Thread | None = None
_scheduler_lock = threading.Lock()

# Fixed display order for the daily digest (icon + label).
MODULE_DISPLAY = (
    ("regularize", "⚙️ Regularizer"),
    ("plant_model", "🤖 Plant Model"),
    ("silo", "🔁 SILO"),
    ("recommender", "📐 Recommender"),
    ("trimmer", "✂️ Trimmer"),
    ("mulo", "🔀 MULO"),
    ("mpc", "🎯 MPC"),
    ("adaptive", "📈 Adaptive"),
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _today_iso() -> str:
    return _utcnow().date().isoformat()


def _truthy(raw: str | None, *, default: bool = False) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _parse_send_hour(raw: str | None) -> int:
    if raw is None or not raw.strip():
        return DEFAULT_SEND_HOUR_UTC
    try:
        hour = int(raw.strip())
    except ValueError:
        return DEFAULT_SEND_HOUR_UTC
    return max(0, min(23, hour))


def _bot_token() -> str:
    """Live token from process env (updated when admin saves)."""
    return api_key_service.current_env_value(TELEGRAM_BOT_TOKEN_KEY)


def bot_token_configured() -> bool:
    return bool(_bot_token())


def get_settings(db: Session) -> TelegramAnalyticsSettings:
    token = _bot_token()
    return TelegramAnalyticsSettings(
        enabled=_truthy(plan_service.get_setting(db, SETTING_ENABLED), default=False),
        chat_id=(plan_service.get_setting(db, SETTING_CHAT_ID) or "").strip(),
        send_hour_utc=_parse_send_hour(plan_service.get_setting(db, SETTING_SEND_HOUR)),
        bot_token_configured=bool(token),
        bot_token_masked=api_key_service.mask_secret(token),
        last_sent_date=(plan_service.get_setting(db, SETTING_LAST_SENT) or "").strip() or None,
    )


def update_settings(
    db: Session,
    *,
    enabled: bool | None = None,
    chat_id: str | None = None,
    send_hour_utc: int | None = None,
    bot_token: str | None = None,
) -> TelegramAnalyticsSettings:
    if enabled is not None:
        plan_service.set_setting(db, SETTING_ENABLED, "true" if enabled else "false")
    if chat_id is not None:
        plan_service.set_setting(db, SETTING_CHAT_ID, chat_id.strip())
    if send_hour_utc is not None:
        hour = max(0, min(23, int(send_hour_utc)))
        plan_service.set_setting(db, SETTING_SEND_HOUR, str(hour))
    if bot_token is not None:
        api_key_service.update_env_keys(
            {TELEGRAM_BOT_TOKEN_KEY: bot_token},
            allowed=_TELEGRAM_ENV_ALLOWED,
        )
    return get_settings(db)


def _format_percent(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.1f}%"


def _format_credits(value: float | int) -> str:
    amount = float(value or 0)
    if amount == int(amount):
        return f"{int(amount):,}"
    return f"{amount:,.2f}"


def _module_counts(extras: dict) -> tuple[int, list[str]]:
    counts = {row["module"]: int(row["count"]) for row in (extras.get("modules") or [])}
    total_runs = 0
    module_lines: list[str] = []
    for key, label in MODULE_DISPLAY:
        count = counts.get(key, 0)
        total_runs += count
        module_lines.append(f"• {label}: {count}")
    return total_runs, module_lines


def _log_24h_digest(extras: dict, *, total_runs: int) -> None:
    """Log the closed 24h window aggregates used for the daily digest."""
    module_summary = {
        str(row["module"]): int(row["count"]) for row in (extras.get("modules") or [])
    }
    logger.info(
        "Telegram 24h digest data report_date=%s window=[%s, %s) "
        "users_total=%s users_new=%s dau=%s mau=%s logins=%s "
        "projects_total=%s projects_new=%s module_runs=%s modules=%s "
        "credits_spent=%s errors=%s bugs=%s feedback=%s "
        "top_llm=%s llms_day=%s",
        extras.get("report_date"),
        extras.get("day_start"),
        extras.get("day_end"),
        extras.get("users_total"),
        extras.get("users_new_today"),
        extras.get("dau"),
        extras.get("mau"),
        extras.get("logins_today"),
        extras.get("projects_total"),
        extras.get("projects_new_today"),
        total_runs,
        module_summary,
        extras.get("credits_spent_today"),
        extras.get("errors_today"),
        extras.get("bugs_today"),
        extras.get("feedback_today"),
        extras.get("most_used_llm_today"),
        extras.get("llms_today") or [],
    )


def format_daily_message(db: Session) -> tuple[str, dict]:
    """Build an HTML digest for the previous completed UTC day (full 24h).

    Returns (message_html, digest_extras).
    """
    extras = analytics_service.get_digest_extras(db)
    # Retention is cohort-based (not window-bound); reuse the admin aggregate.
    retention = analytics_service.get_analytics(db, days=1)
    retention_d7 = retention.get("retention_d7")
    retention_d30 = retention.get("retention_d30")

    report_date = str(extras.get("report_date") or _today_iso())
    total_runs, module_lines = _module_counts(extras)
    _log_24h_digest(extras, total_runs=total_runs)

    lines = [
        "📊 <b>LabCD Daily Analytics</b>",
        f"📅 <i>{html.escape(report_date)} UTC (last 24h)</i>",
        "",
        "👥 <b>Users</b>",
        f"• Total: <b>{extras['users_total']}</b>",
        f"• New (24h): <b>{extras['users_new_today']}</b>",
        f"• DAU (24h): <b>{extras['dau']}</b>",
        f"• MAU (30d): <b>{extras['mau']}</b>",
        f"• Logins (24h): <b>{extras['logins_today']}</b>",
        f"• D7 retention: {_format_percent(retention_d7)}",
        f"• D30 retention: {_format_percent(retention_d30)}",
        "",
        "📁 <b>Projects</b>",
        f"• Total: <b>{extras['projects_total']}</b>",
        f"• Created (24h): <b>{extras['projects_new_today']}</b>",
        "",
        "🧩 <b>Module runs (24h)</b>",
        *module_lines,
        f"• Total: <b>{total_runs}</b>",
        "",
        "🧠 <b>LLM usage</b>",
        "<i>Last 24h</i>",
    ]
    llms_today = extras.get("llms_today") or []
    most_used_today = extras.get("most_used_llm_today")
    if most_used_today:
        lines.append(f"• Top: <code>{html.escape(str(most_used_today))}</code>")
    if not llms_today:
        lines.append("• (none)")
    else:
        for row in llms_today:
            model = html.escape(str(row["model"]))
            lines.append(f"• {model}: {row['count']}")

    lines.append("<i>All time</i>")
    llms_all_time = extras.get("llms_all_time") or []
    most_used_all_time = extras.get("most_used_llm_all_time")
    if most_used_all_time:
        lines.append(f"• Top: <code>{html.escape(str(most_used_all_time))}</code>")
    if not llms_all_time:
        lines.append("• (none)")
    else:
        for row in llms_all_time:
            model = html.escape(str(row["model"]))
            lines.append(f"• {model}: {row['count']}")

    lines.extend(
        [
            "",
            "💳 <b>Credits</b>",
            f"• Spent (24h): <b>{_format_credits(extras['credits_spent_today'])}</b>",
            "",
            "⚠️ <b>Health (24h)</b>",
            f"• Errors: <b>{extras['errors_today']}</b>",
            f"• Bug reports: <b>{extras['bugs_today']}</b>",
            f"• Feedback surveys: <b>{extras['feedback_today']}</b>",
        ]
    )
    return "\n".join(lines), extras


def send_message(chat_id: str, text: str) -> None:
    """Send a Telegram message, or log to console when the bot token is unset."""
    token = _bot_token()
    if not token:
        logger.info(
            "TELEGRAM (console fallback)\nChat: %s\n\n%s",
            chat_id,
            text,
        )
        return

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            url,
            json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
        )
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            description = payload.get("description") or "Telegram API rejected the message"
            raise RuntimeError(description)


def send_daily_report(db: Session, *, force: bool = False) -> TelegramAnalyticsTestResult:
    """Send the daily digest when configured. force=True skips enable/dedupe checks."""
    settings = get_settings(db)
    chat_id = settings.chat_id.strip()
    if not chat_id:
        return TelegramAnalyticsTestResult(ok=False, detail="Telegram chat ID is not configured.")

    if not force and not settings.enabled:
        return TelegramAnalyticsTestResult(ok=False, detail="Telegram daily analytics is disabled.")

    today = _today_iso()
    if not force and settings.last_sent_date == today:
        return TelegramAnalyticsTestResult(
            ok=False,
            detail=f"Daily report already sent for {today}.",
        )

    text, extras = format_daily_message(db)
    try:
        send_message(chat_id, text)
    except Exception as exc:
        logger.exception("Failed to send Telegram analytics digest")
        return TelegramAnalyticsTestResult(ok=False, detail=str(exc))

    plan_service.set_setting(db, SETTING_LAST_SENT, today)
    report_date = extras.get("report_date") or today
    detail = (
        f"Daily 24h report for {report_date} UTC logged to console "
        "(TELEGRAM_BOT_TOKEN unset)."
        if not _bot_token()
        else f"Daily 24h report for {report_date} UTC sent to Telegram."
    )
    return TelegramAnalyticsTestResult(ok=True, detail=detail)


def _scheduler_loop() -> None:
    logger.info("Telegram analytics scheduler started")
    while not _stop_event.wait(_SCHEDULER_POLL_SECONDS):
        db = SessionLocal()
        try:
            settings = get_settings(db)
            if not settings.enabled or not settings.chat_id.strip():
                continue
            now = _utcnow()
            if now.hour < settings.send_hour_utc:
                continue
            if settings.last_sent_date == now.date().isoformat():
                continue
            result = send_daily_report(db, force=False)
            if result.ok:
                logger.info("Telegram analytics digest: %s", result.detail)
            elif "already sent" not in (result.detail or "").lower():
                logger.warning("Telegram analytics digest skipped: %s", result.detail)
        except Exception:
            logger.exception("Telegram analytics scheduler tick failed")
        finally:
            db.close()
    logger.info("Telegram analytics scheduler stopped")


def start_scheduler() -> None:
    """Start the daemon that sends the digest once per UTC day."""
    global _scheduler_thread
    with _scheduler_lock:
        if _scheduler_thread is not None and _scheduler_thread.is_alive():
            return
        _stop_event.clear()
        _scheduler_thread = threading.Thread(
            target=_scheduler_loop,
            name="telegram-analytics",
            daemon=True,
        )
        _scheduler_thread.start()


def stop_scheduler() -> None:
    """Signal the scheduler thread to stop (best-effort on process shutdown)."""
    global _scheduler_thread
    _stop_event.set()
    thread = _scheduler_thread
    if thread is not None and thread.is_alive():
        thread.join(timeout=5.0)
    with _scheduler_lock:
        _scheduler_thread = None
