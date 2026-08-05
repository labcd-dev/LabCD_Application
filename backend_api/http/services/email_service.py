"""Send auth emails via SMTP, or log to console when SMTP is unset.

Delivery runs on a background worker thread so HTTP handlers return immediately.
"""

from __future__ import annotations

import logging
import queue
import smtplib
import threading
from email.message import EmailMessage

from backend_api.http.config import (
    APP_PUBLIC_URL,
    EMAIL_FROM,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_TLS,
    SMTP_USER,
)

logger = logging.getLogger(__name__)

_EmailJob = tuple[str, str, str]  # to, subject, body
_email_queue: queue.Queue[_EmailJob] = queue.Queue()
_worker_lock = threading.Lock()
_worker_started = False


def _deliver_email(*, to: str, subject: str, body: str) -> None:
    """Deliver email through SMTP or print to logs for local development."""
    if not SMTP_HOST:
        logger.info(
            "EMAIL (console fallback)\nTo: %s\nSubject: %s\n\n%s",
            to,
            subject,
            body,
        )
        return

    message = EmailMessage()
    message["From"] = EMAIL_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    if SMTP_TLS:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            smtp.starttls()
            if SMTP_USER:
                smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            if SMTP_USER:
                smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(message)


def _email_worker() -> None:
    while True:
        to, subject, body = _email_queue.get()
        try:
            _deliver_email(to=to, subject=subject, body=body)
        except Exception:
            logger.exception("Failed to send email to %s (subject=%r)", to, subject)
        finally:
            _email_queue.task_done()


def _ensure_worker() -> None:
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        thread = threading.Thread(target=_email_worker, name="email-queue", daemon=True)
        thread.start()
        _worker_started = True


def send_email(*, to: str, subject: str, body: str) -> None:
    """Queue email for background delivery; returns immediately."""
    _ensure_worker()
    _email_queue.put((to, subject, body))


def send_verification_email(*, to: str, token: str) -> None:
    link = f"{APP_PUBLIC_URL}/verify-email?token={token}"
    body = (
        "Welcome to LabCD.\n\n"
        "Please verify your email by opening this link (valid for 24 hours):\n"
        f"{link}\n\n"
        "If you did not create an account, you can ignore this message.\n"
    )
    send_email(to=to, subject="Verify your LabCD email", body=body)


def send_password_reset_email(*, to: str, token: str) -> None:
    link = f"{APP_PUBLIC_URL}/reset-password?token={token}"
    body = (
        "You requested a password reset for your LabCD account.\n\n"
        "Open this link to choose a new password (valid for 1 hour):\n"
        f"{link}\n\n"
        "If you did not request this, you can ignore this message.\n"
    )
    send_email(to=to, subject="Reset your LabCD password", body=body)
