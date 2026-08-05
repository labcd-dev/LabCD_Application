"""Send auth emails via SMTP, or log to console when SMTP is unset."""

from __future__ import annotations

import logging
import smtplib
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


def send_email(*, to: str, subject: str, body: str) -> None:
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
