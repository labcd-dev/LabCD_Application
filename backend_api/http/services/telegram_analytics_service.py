"""Daily Telegram digest for product analytics."""

from __future__ import annotations

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

DEFAULT_SEND_HOUR_UTC = 8
_SCHEDULER_POLL_SECONDS = 60

_stop_event = threading.Event()
_scheduler_thread: threading.Thread | None = None
_scheduler_lock = threading.Lock()

MODULE_LABELS = {
    "silo": "Silo",
    "mulo": "Mulo",
    "recommender": "Recommender",
    "trimmer": "Trimmer",
    "regularize": "Regularizer",
}


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


def format_daily_message(db: Session) -> str:
    """Build a plain-text daily digest from analytics aggregates."""
    data = analytics_service.get_analytics(db, days=1)
    today = _today_iso()
    lines = [
        "LabCD daily analytics",
        f"Date (UTC): {today}",
        "",
        f"DAU: {data['dau_today']}",
        f"MAU (30d): {data['mau']}",
        f"D7 retention: {_format_percent(data.get('retention_d7'))}",
        f"D30 retention: {_format_percent(data.get('retention_d30'))}",
        "",
        "Module runs (today):",
    ]
    modules = data.get("modules") or []
    if not modules:
        lines.append("  (none)")
    else:
        for row in modules:
            label = MODULE_LABELS.get(row["module"], row["module"])
            lines.append(f"  {label}: {row['count']}")
    return "\n".join(lines)


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
            json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
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

    text = format_daily_message(db)
    try:
        send_message(chat_id, text)
    except Exception as exc:
        logger.exception("Failed to send Telegram analytics digest")
        return TelegramAnalyticsTestResult(ok=False, detail=str(exc))

    plan_service.set_setting(db, SETTING_LAST_SENT, today)
    detail = (
        "Daily report logged to console (TELEGRAM_BOT_TOKEN unset)."
        if not _bot_token()
        else "Daily report sent to Telegram."
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
