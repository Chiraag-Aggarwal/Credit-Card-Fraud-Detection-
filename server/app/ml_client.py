"""Bounded retries for the model's read-only inference operations."""

import math
import os
import time

import httpx


def request_model(method: str, path: str, payload=None):
    base = os.getenv("ML_SERVICE_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("ML_SERVICE_URL is not configured.")
    # These model endpoints have no database or payment side effects.
    allowed = {("GET", "/model-info"), ("POST", "/predict"),
               ("POST", "/predict/batch"), ("POST", "/explain")}
    if (method, path) not in allowed:
        raise RuntimeError("Unsupported model operation.")
    try:
        budget = float(os.getenv("ML_TIMEOUT_MS", "60000")) / 1000
    except ValueError:
        raise RuntimeError("ML_TIMEOUT_MS must be a positive number.") from None
    if not math.isfinite(budget) or not 0 < budget <= 75:
        raise RuntimeError("ML_TIMEOUT_MS must be between 1 and 75000 milliseconds.")
    deadline = time.monotonic() + budget
    headers = {"X-API-Key": os.environ["ML_API_KEY"]} if os.getenv("ML_API_KEY") else {}
    for attempt in range(8):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            response = httpx.request(
                method, f"{base}{path}", json=payload, headers=headers,
                timeout=httpx.Timeout(remaining, connect=min(10, remaining)),
                follow_redirects=False,
            )
            if response.status_code not in {502, 503, 504}:
                response.raise_for_status()
                return response.json()
        except (httpx.TimeoutException, httpx.NetworkError):
            pass
        except (httpx.HTTPError, ValueError):
            # Authentication/configuration errors cannot be fixed by retrying.
            raise RuntimeError("The ML service is unavailable.") from None
        if attempt < 7:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(2 ** (attempt + 1), 10, remaining))
    raise RuntimeError("The ML service is unavailable.")
