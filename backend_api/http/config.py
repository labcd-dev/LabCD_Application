"""Runtime configuration for the FastAPI service."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RESULTS_DIR = Path(os.getenv("RESULTS_DIR", PROJECT_ROOT / "results"))
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", PROJECT_ROOT / "uploads"))
CASE_STUDIES_DIR = Path(os.getenv("CASE_STUDIES_DIR", PROJECT_ROOT / "case_studies"))

API_PREFIX = "/api/v1"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
    if origin.strip()
]

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://labcd:labcd@localhost:5432/labcd",
)
# Keep pool headroom for API requests while design jobs open short-lived sessions.
DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "10"))
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "20"))
DB_POOL_TIMEOUT = int(os.getenv("DB_POOL_TIMEOUT", "10"))
# Sync route threadpool size (design jobs share the process; login must not starve).
API_THREAD_LIMIT = int(os.getenv("API_THREAD_LIMIT", "64"))

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

# Public app URL used in auth email links (verify / reset password).
APP_PUBLIC_URL = os.getenv("APP_PUBLIC_URL", "http://localhost:5173").rstrip("/")
# Public API origin used to build OAuth redirect URIs (no trailing /api/v1).
API_PUBLIC_URL = os.getenv("API_PUBLIC_URL", "http://localhost:8000").rstrip("/")

# SMTP — when SMTP_HOST is empty, emails are logged to the console (dev fallback).
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_TLS = os.getenv("SMTP_TLS", "true").lower() in {"1", "true", "yes", "on"}
EMAIL_FROM = os.getenv("EMAIL_FROM", "noreply@labcd.local").strip()

EMAIL_VERIFY_EXPIRE_HOURS = int(os.getenv("EMAIL_VERIFY_EXPIRE_HOURS", "24"))
EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS = int(
    os.getenv("EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS", "120")
)
PASSWORD_RESET_EXPIRE_HOURS = int(os.getenv("PASSWORD_RESET_EXPIRE_HOURS", "1"))
LOGIN_FAIL_WINDOW_SECONDS = int(os.getenv("LOGIN_FAIL_WINDOW_SECONDS", "60"))
LOGIN_FAIL_MAX_ATTEMPTS = int(os.getenv("LOGIN_FAIL_MAX_ATTEMPTS", "3"))
LOGIN_LOCKOUT_MINUTES = int(os.getenv("LOGIN_LOCKOUT_MINUTES", "10"))

DEFAULT_LLM_MODELS = [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-4o",
    "gpt-4o-mini",
]

RAG_MODEL_OPTIONS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4o", "gpt-4o-mini"]

RESULTS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
