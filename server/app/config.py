"""Validate deployment settings without printing credentials."""

import os
from urllib.parse import urlsplit

from app.security import jwt_secret


def validate_settings() -> None:
    jwt_secret()
    if not os.getenv("DATABASE_URL", "").strip():
        raise RuntimeError("DATABASE_URL must contain your PostgreSQL connection string.")
    if os.getenv("APP_ENV", "development") != "production":
        return
    origin = urlsplit(os.getenv("CLIENT_URL", ""))
    if (origin.scheme != "https" or not origin.hostname or origin.path not in {"", "/"}
            or origin.query or origin.fragment or origin.username or origin.password):
        raise RuntimeError("CLIENT_URL must be the exact HTTPS frontend origin in production.")
    ml_url = urlsplit(os.getenv("ML_SERVICE_URL", ""))
    if ml_url.scheme not in {"http", "https"} or not ml_url.hostname or ml_url.username or ml_url.password:
        raise RuntimeError("ML_SERVICE_URL must point to the deployed model service.")
    if ml_url.scheme == "http" and ml_url.hostname not in {"ml", "ml-service", "localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("Public ML_SERVICE_URL must use HTTPS in production.")
    if len(os.getenv("ML_API_KEY", "").strip()) < 32:
        raise RuntimeError("Use the same ML_API_KEY of at least 32 characters on the API and model service.")
