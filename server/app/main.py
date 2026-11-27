"""FastAPI backend for the fraud dashboard, backed by PostgreSQL."""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import logging
import math
import os
from pathlib import Path
import random
import threading
import time
from urllib.parse import urlencode
import uuid

import httpx
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from dotenv import load_dotenv
from starlette.concurrency import run_in_threadpool

from app.schemas import (
    BatchInput,
    CheckoutInput,
    LoginInput,
    PaymentVerification,
    ProfileInput,
    ReauthenticationInput,
    ChangePasswordInput,
    RecoveryInput,
    RegisterInput,
    ReviewInput,
    SimulateInput,
    TransactionFeatures,
)
from app.security import (
    current_user, hash_password, issue_token, issue_session, jwt_secret, public_user,
    verify_password, new_recovery_codes, recovery_digest, session_details,
)
from app.config import validate_settings
from app.middleware import BodySizeLimit
from app.ml_client import request_model
from app.storage import Repository, DuplicateRecordError


load_dotenv(Path(__file__).resolve().parents[1] / ".env")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("fraud_dashboard_api")
RISK_LABELS = ("LOW", "MEDIUM", "HIGH", "UNSCORED")
API_ROOT = "https://api.razorpay.com/v1"
REPLAY_PATH = Path(__file__).resolve().parents[1] / "data" / "replay_samples.json"
with REPLAY_PATH.open(encoding="utf-8") as sample_file:
    REPLAY_SAMPLES = json.load(sample_file)
_rate_limit_lock = threading.Lock()
_rate_limit_windows: dict[tuple[str, str], tuple[float, int]] = {}


def fail(status: int, message: str, code: str) -> None:
    raise HTTPException(status_code=status, detail={"message": message, "code": code})


def serialize_transaction(item: dict) -> dict:
    return {
        "id": str(item.get("_id", item.get("id"))),
        "createdAt": item["createdAt"].astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "displayAmount": float(item["displayAmount"]),
        "currency": item["currency"],
        "source": item["source"],
        "fraudProbability": item.get("fraudProbability"),
        "riskLabel": item.get("riskLabel", "UNSCORED"),
        "isFlagged": bool(item.get("isFlagged", False)),
        "scoringStatus": item.get("scoringStatus", "pending_review"),
        "scoringReason": item.get("scoringReason"),
        "paymentMode": item.get("paymentMode"),
        "modelVersion": item.get("modelVersion", ""),
        "reviewDecision": item.get("reviewDecision"),
        "stripePaymentIntentId": item.get("stripePaymentIntentId"),
        "razorpayPaymentId": item.get("razorpayPaymentId"),
    }


def ml_call(method: str, path: str, payload=None):
    return request_model(method, path, payload)


def score_transaction(features: dict) -> dict:
    return validate_prediction(ml_call("POST", "/predict", features))


def validate_prediction(result: dict) -> dict:
    if not isinstance(result, dict):
        raise RuntimeError("The ML service returned an invalid score.")
    probability = result.get("fraud_probability")
    threshold = result.get("threshold")
    if (
        type(probability) not in (int, float)
        or not math.isfinite(probability)
        or not 0 <= probability <= 1
        or result.get("risk_label") not in {"LOW", "MEDIUM", "HIGH"}
        or not isinstance(result.get("is_fraud"), bool)
        or type(threshold) not in (int, float)
        or not math.isfinite(threshold)
        or not 0 <= threshold <= 1
        or not isinstance(result.get("model_version"), str)
    ):
        raise RuntimeError("The ML service returned an invalid score.")
    return result


def pick_sample(fraud: bool | None = None) -> dict:
    pool = REPLAY_SAMPLES if fraud is None else [row for row in REPLAY_SAMPLES if row.get("Class") == int(fraud)]
    if not pool:
        raise RuntimeError("The training replay dataset has no matching rows.")
    return random.choice(pool)


def save_scored_transaction(request: Request, data: dict, prediction_result=...) -> dict:
    features = data.get("features")
    common = {
        "features": features,
        "displayAmount": float(data["displayAmount"]),
        "currency": data["currency"].lower(),
        "source": data["source"],
        "merchantId": data["merchantId"],
        "groundTruthLabel": data.get("groundTruthLabel"),
        "paymentMode": data.get("paymentMode"),
        "createdAt": datetime.now(timezone.utc),
        "status": "captured" if data["source"] == "razorpay" else "simulated",
        **{
            key: data[key]
            for key in ("razorpayOrderId", "razorpayPaymentId", "razorpayEventId")
            if data.get(key) is not None
        },
    }
    try:
        if not features:
            raise ValueError("This payment has no compatible model features.")
        prediction = score_transaction(features) if prediction_result is ... else validate_prediction(prediction_result)
        record = {
            **common,
            "fraudProbability": float(prediction["fraud_probability"]),
            "riskLabel": prediction["risk_label"],
            "isFlagged": prediction["is_fraud"],
            "scoringStatus": "scored",
            "modelVersion": prediction.get("model_version", ""),
            "scoringReason": None,
        }
    except Exception as error:
        logger.info("Sending transaction for manual review (%s).", type(error).__name__)
        record = {
            **common,
            "fraudProbability": None,
            "riskLabel": "UNSCORED",
            "isFlagged": True,
            "scoringStatus": "pending_review",
            "modelVersion": "",
            "scoringReason": "unsupported_payment_features" if not features else "model_unavailable",
        }
    try:
        record = request.app.state.db.create_transaction(record)
    except DuplicateRecordError:
        if not data.get("razorpayPaymentId"):
            raise
        record = request.app.state.db.get_transaction_by_payment(data["razorpayPaymentId"])
        if not record:
            raise
    if record and (record["riskLabel"] == "HIGH" or record["scoringStatus"] == "pending_review"):
        logger.warning("Fraud alert for merchant %s: transaction %s requires attention.", data["merchantId"], record["_id"])
    return record


def payment_signature_is_valid(order_id: str, payment_id: str, signature: str) -> bool:
    secret = os.getenv("RAZORPAY_KEY_SECRET", "")
    expected = hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return bool(secret) and hmac.compare_digest(expected, signature)


def resolve_captured_payment(request: Request, payment: dict, event_id: str | None = None) -> dict | None:
    order_id = payment.get("order_id")
    payment_id = payment.get("id")
    if not order_id or not payment_id:
        return None
    checkout = request.app.state.db.get_checkout(order_id)
    if not checkout or payment.get("status") != "captured":
        return None
    amount = payment.get("amount")
    currency = str(payment.get("currency", "")).lower()
    if type(amount) is not int or amount != checkout["amountPaise"] or currency != checkout["currency"]:
        logger.error("Razorpay payment amount or currency did not match its order.")
        return None
    existing = request.app.state.db.get_transaction_by_payment(payment_id)
    if existing:
        return existing if existing.get("razorpayOrderId") == order_id else None
    # Provider metadata cannot supply the historical dataset's anonymous PCA
    # features. Never attach another cardholder's sample score to this payment.
    return save_scored_transaction(request, {
        "features": None,
        "displayAmount": amount / 100,
        "currency": currency,
        "source": "razorpay",
        "merchantId": checkout["merchantId"],
        "paymentMode": checkout.get("paymentMode"),
        "razorpayOrderId": order_id,
        "razorpayPaymentId": payment_id,
        "razorpayEventId": event_id,
    })


@asynccontextmanager
async def lifespan(application: FastAPI):
    validate_settings()
    database = Repository(os.environ["DATABASE_URL"])
    try:
        await run_in_threadpool(database.ping)
        await run_in_threadpool(database.check_schema)
        application.state.db = database
        logger.info("Python API connected to PostgreSQL.")
        yield
    finally:
        database.close()
        if hasattr(application.state, "db"):
            del application.state.db


app = FastAPI(title="Fraud Detection API", version="3.0.0", lifespan=lifespan)
app.add_middleware(BodySizeLimit)
client_origin = os.getenv("CLIENT_URL", "http://localhost:5173").rstrip("/")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[client_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Razorpay-Signature"],
    expose_headers=["Retry-After"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, error: RequestValidationError):
    return JSONResponse(status_code=422, content={"error": {"message": "Request validation failed.", "code": "VALIDATION_ERROR"}})


@app.exception_handler(HTTPException)
async def http_error_handler(_request: Request, error: HTTPException):
    detail = error.detail if isinstance(error.detail, dict) else {"message": str(error.detail), "code": "REQUEST_ERROR"}
    return JSONResponse(status_code=error.status_code, content={"error": detail}, headers=error.headers)


@app.exception_handler(Exception)
async def generic_error_handler(_request: Request, error: Exception):
    logger.exception("Unhandled API error (%s)", type(error).__name__)
    return JSONResponse(status_code=500, content={"error": {"message": "The server could not complete the request.", "code": "INTERNAL_ERROR"}})


@app.middleware("http")
async def security_headers(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method != "OPTIONS" and not request.url.path.startswith("/api/webhooks/"):
        now = time.monotonic()
        client_ip = request.client.host if request.client else "unknown"
        limits = [("api", 1200, 15 * 60)]
        if request.url.path in {"/api/auth/login", "/api/auth/register"}:
            limits.append(("auth", 10, 15 * 60))
        if request.url.path == "/api/auth/recover":
            limits.append(("recovery", 5, 15 * 60))
        if request.url.path in {"/api/auth/change-password", "/api/auth/recovery-codes"} or (
            request.url.path == "/api/auth/me" and request.method == "PATCH"
        ):
            limits.append(("account-security", 10, 15 * 60))
        if request.url.path == "/api/transactions/simulate":
            limits.append(("simulate", 10, 15 * 60))
        if request.url.path == "/api/predictions/batch":
            limits.append(("batch", 20, 15 * 60))
        if request.url.path == "/api/payments/checkout-session":
            limits.append(("checkout", 20, 15 * 60))
        retry_after = None
        with _rate_limit_lock:
            for bucket, limit, window_seconds in limits:
                key = (client_ip, bucket)
                started, count = _rate_limit_windows.get(key, (now, 0))
                if now - started >= window_seconds:
                    started, count = now, 0
                if count >= limit:
                    retry_after = max(1, int(window_seconds - (now - started)))
                    break
                _rate_limit_windows[key] = (started, count + 1)
            if len(_rate_limit_windows) > 5000:
                expired_keys = [
                    key for key, state in _rate_limit_windows.items()
                    if now - state[0] >= 15 * 60
                ]
                for key in expired_keys:
                    _rate_limit_windows.pop(key, None)
        if retry_after is not None:
            headers = {"Retry-After": str(retry_after)}
            if request.headers.get("origin") == client_origin:
                headers["Access-Control-Allow-Origin"] = client_origin
                headers["Access-Control-Allow-Credentials"] = "true"
            response = JSONResponse(
                status_code=429,
                content={"error": {"message": "Too many requests. Please wait and try again.", "code": "RATE_LIMITED"}},
                headers=headers,
            )
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "same-origin"
            return response
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/health")
def health(request: Request):
    try:
        request.app.state.db.ping()
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": False})
    return {"status": "ok", "database": True}


@app.post("/api/auth/register", status_code=201)
def register(body: RegisterInput, request: Request):
    recovery_codes = new_recovery_codes()
    user = {
        "name": body.name.strip(),
        "email": str(body.email).lower(),
        "passwordHash": hash_password(body.password),
        "role": "merchant",
        "createdAt": datetime.now(timezone.utc),
    }
    try:
        user = request.app.state.db.create_user(user, recovery_hashes=[recovery_digest(code) for code in recovery_codes])
    except DuplicateRecordError:
        fail(409, "An account with this email already exists.", "EMAIL_EXISTS")
    token = issue_session(request.app.state.db, user)
    if not token:
        fail(409, "The account changed. Please sign in again.", "ACCOUNT_CHANGED")
    return {"token": token, "user": public_user(user), "recoveryCodes": recovery_codes}


@app.post("/api/auth/login")
def login(body: LoginInput, request: Request):
    user = request.app.state.db.get_user_by_email(str(body.email).lower())
    if not user or not verify_password(body.password, user.get("passwordHash", "")):
        fail(401, "Email or password is incorrect.", "INVALID_CREDENTIALS")
    token = issue_session(request.app.state.db, user)
    if not token:
        fail(401, "Email or password is incorrect.", "INVALID_CREDENTIALS")
    return {"token": token, "user": public_user(user)}


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)):
    return {"user": public_user(user)}


@app.patch("/api/auth/me")
def update_profile(body: ProfileInput, request: Request, user: dict = Depends(current_user)):
    if str(body.email).lower() != user["email"]:
        if body.currentPassword is None:
            fail(403, "Enter your current password to change your email address.", "CURRENT_PASSWORD_REQUIRED")
        if not verify_password(body.currentPassword, user["passwordHash"]):
            fail(403, "The current password is incorrect.", "CURRENT_PASSWORD_INVALID")
    try:
        updated = request.app.state.db.update_user(
            user["_id"], name=body.name, email=str(body.email).lower(),
            expected_auth_version=user["authVersion"], expected_password_hash=user["passwordHash"],
            expected_email=user["email"],
        )
    except DuplicateRecordError:
        fail(409, "An account with this email already exists.", "EMAIL_EXISTS")
    if not updated:
        fail(409, "Your profile changed. Refresh the page and try again.", "PROFILE_CHANGED")
    # Tokens identify the immutable user ID, so an email edit preserves the session.
    return {"user": public_user(updated)}


@app.get("/api/auth/security")
def account_security(request: Request, user: dict = Depends(current_user)):
    return {"recoveryCodesRemaining": request.app.state.db.recovery_codes_remaining(user["_id"])}


@app.post("/api/auth/recovery-codes")
def regenerate_recovery_codes(body: ReauthenticationInput, request: Request, user: dict = Depends(current_user)):
    if not verify_password(body.currentPassword, user["passwordHash"]):
        fail(403, "The current password is incorrect.", "CURRENT_PASSWORD_INVALID")
    codes = new_recovery_codes()
    changed = request.app.state.db.replace_recovery_codes(
        user["_id"], [recovery_digest(code) for code in codes],
        expected_password_hash=user["passwordHash"], expected_auth_version=user["authVersion"],
    )
    if not changed:
        fail(401, "The login session is invalid or expired.", "UNAUTHORIZED")
    return {"recoveryCodes": codes}


@app.post("/api/auth/change-password")
def change_password(body: ChangePasswordInput, request: Request, user: dict = Depends(current_user)):
    if not verify_password(body.currentPassword, user["passwordHash"]):
        fail(403, "The current password is incorrect.", "CURRENT_PASSWORD_INVALID")
    session_id, expires_at = session_details()
    updated = request.app.state.db.change_password(
        user["_id"], hash_password(body.newPassword), expected_password_hash=user["passwordHash"],
        expected_auth_version=user["authVersion"], session_id=session_id, expires_at=expires_at,
    )
    if not updated:
        fail(401, "The login session is invalid or expired.", "UNAUTHORIZED")
    return {"token": issue_token(updated["_id"], updated["role"], session_id=session_id,
                                  auth_version=updated["authVersion"], expires_at=expires_at),
            "user": public_user(updated)}


@app.post("/api/auth/recover")
def recover_account(body: RecoveryInput, request: Request):
    # The same work and error shape are used for missing emails and invalid codes.
    recovered = request.app.state.db.recover_password(str(body.email).lower(), recovery_digest(body.recoveryCode),
                                                     hash_password(body.newPassword))
    if not recovered:
        fail(400, "Email or recovery code is incorrect, or the code has already been used.", "INVALID_RECOVERY_CODE")
    return {"message": "Password reset. Sign in with your new password."}


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, user: dict = Depends(current_user)):
    request.app.state.db.revoke_session(user["_id"], request.state.auth_session_id)
    return Response(status_code=204)


@app.post("/api/auth/logout-all", status_code=204)
def logout_all(request: Request, user: dict = Depends(current_user)):
    request.app.state.db.revoke_all_sessions(user["_id"], user["authVersion"])
    return Response(status_code=204)


@app.post("/api/predictions/batch")
def batch_predictions(body: BatchInput, _user: dict = Depends(current_user)):
    try:
        results = ml_call("POST", "/predict/batch", [row.model_dump() for row in body.transactions])
        if not isinstance(results, list) or len(results) != len(body.transactions):
            raise RuntimeError("ML response did not match the submitted batch.")
        items = []
        for index, result in enumerate(results):
            validate_prediction(result)
            probability = float(result["fraud_probability"])
            if not math.isfinite(probability) or not 0 <= probability <= 1:
                raise RuntimeError("ML service returned an invalid prediction.")
            items.append({
                "index": index,
                "fraudProbability": probability,
                "riskLabel": result["risk_label"],
                "isFlagged": bool(result["is_fraud"]),
                "threshold": float(result["threshold"]),
                "modelVersion": result["model_version"],
            })
        return {"count": len(items), "items": items}
    except Exception as error:
        logger.warning("Batch prediction failed (%s).", type(error).__name__)
        fail(503, "The fraud scoring service is unavailable.", "ML_UNAVAILABLE")


@app.get("/api/transactions")
def list_transactions(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    riskLabel: str | None = Query(None, pattern="^(LOW|MEDIUM|HIGH|UNSCORED)$"),
    flagged: bool | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    user: dict = Depends(current_user),
):
    created = {}
    for supplied, operator in ((from_date, "$gte"), (to_date, "$lte")):
        if supplied:
            try:
                parsed = datetime.fromisoformat(supplied.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                created[operator] = parsed.astimezone(timezone.utc)
            except ValueError:
                fail(422, "Date filters must be ISO date-time strings.", "VALIDATION_ERROR")
    if "$gte" in created and "$lte" in created and created["$gte"] > created["$lte"]:
        fail(422, "The from date must be before the to date.", "VALIDATION_ERROR")
    documents, total = request.app.state.db.list_transactions(
        user["_id"], page=page, limit=limit, risk_label=riskLabel, flagged=flagged,
        from_date=created.get("$gte"), to_date=created.get("$lte"),
    )
    return {"items": [serialize_transaction(item) for item in documents], "page": page, "limit": limit, "total": total}


@app.get("/api/transactions/stats")
def transaction_stats(request: Request, user: dict = Depends(current_user)):
    return request.app.state.db.transaction_stats(user["_id"])


@app.get("/api/transactions/score-histogram")
def score_histogram(request: Request, user: dict = Depends(current_user)):
    return request.app.state.db.score_histogram(user["_id"])


@app.post("/api/transactions/simulate", status_code=201)
def simulate(body: SimulateInput, request: Request, user: dict = Depends(current_user)):
    samples = [pick_sample(fraud=True if body.mode == "fraud" else None) for _ in range(body.count)]
    features_batch = [{key: float(value) for key, value in sample.items() if key != "Class"} for sample in samples]
    try:
        predictions = ml_call("POST", "/predict/batch", features_batch)
        if not isinstance(predictions, list) or len(predictions) != body.count:
            raise RuntimeError("Batch size mismatch.")
    except Exception as error:
        logger.warning("Simulation scoring unavailable (%s).", type(error).__name__)
        predictions = [None] * body.count
    created = []
    for sample, features, prediction in zip(samples, features_batch, predictions, strict=True):
        created.append(save_scored_transaction(request, {
            "features": features,
            "displayAmount": features["Amount"],
            "currency": "inr",
            "source": "simulated",
            "merchantId": user["_id"],
            "groundTruthLabel": sample.get("Class"),
        }, prediction_result=prediction))
    return {"created": len(created), "items": [serialize_transaction(item) for item in created]}


@app.patch("/api/transactions/{transaction_id}/review")
def review(transaction_id: str, body: ReviewInput, request: Request, user: dict = Depends(current_user)):
    updated = request.app.state.db.review_transaction(transaction_id, user["_id"], body.decision)
    if not updated:
        fail(404, "Transaction was not found.", "NOT_FOUND")
    return serialize_transaction(updated)


@app.get("/api/transactions/{transaction_id}/explanation")
def explanation(transaction_id: str, request: Request, user: dict = Depends(current_user)):
    item = request.app.state.db.get_transaction(transaction_id, user["_id"])
    if not item:
        fail(404, "Transaction was not found.", "NOT_FOUND")
    if item.get("scoringStatus") != "scored" or not item.get("features"):
        fail(409, "This transaction has no model score to explain.", "NOT_SCORED")
    try:
        result = ml_call("POST", "/explain", item["features"])
    except Exception:
        fail(503, "The fraud explanation service is unavailable.", "ML_UNAVAILABLE")
    return {
        "transactionId": str(item["_id"]),
        "fraudProbability": result["fraud_probability"],
        "threshold": result["threshold"],
        "modelVersion": result["model_version"],
        "method": result["method"],
        "baselineLogOdds": result["baseline_log_odds"],
        "topFactors": result["top_factors"],
    }


@app.get("/api/model-info")
def model_info(_user: dict = Depends(current_user)):
    try:
        return ml_call("GET", "/model-info")
    except Exception:
        fail(503, "The fraud scoring service is unavailable.", "ML_UNAVAILABLE")


@app.get("/api/alerts/unread-count")
def unread_count(request: Request, user: dict = Depends(current_user)):
    count = request.app.state.db.unread_count(user["_id"])
    return {"count": count}


def payment_status() -> dict:
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    reason = None
    mode = "disabled"
    if os.getenv("PAYMENTS_ENABLED", "false").lower() != "true":
        reason = "Payments are not enabled. Account activation and payment keys are required."
    elif not key_id or not secret or "replace_me" in key_id:
        reason = "Razorpay credentials have not been configured."
    elif key_id.startswith("rzp_test_"):
        mode = "test"
    elif key_id.startswith("rzp_live_") and os.getenv("ALLOW_LIVE_PAYMENTS", "false").lower() == "true":
        mode = "live"
    else:
        reason = "Live payments are disabled or the Razorpay key is invalid."
    return {"provider": "razorpay", "mode": mode, "enabled": mode != "disabled", "reason": reason}


@app.get("/api/payments/status")
def get_payment_status(_user: dict = Depends(current_user)):
    return payment_status()


@app.post("/api/payments/checkout-session")
def checkout_session(body: CheckoutInput, request: Request, user: dict = Depends(current_user)):
    availability = payment_status()
    if not availability["enabled"]:
        fail(503, availability["reason"], "PAYMENTS_UNAVAILABLE")
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if body.mode != "normal":
        fail(422, "Use Simulate fraud burst to analyse historical fraud samples. Payments cannot be assigned a demo fraud score.", "VALIDATION_ERROR")
    if body.currency != "inr":
        fail(422, "This checkout accepts INR only.", "VALIDATION_ERROR")
    amount_paise = round(body.amount * 100)
    if not math.isclose(body.amount * 100, amount_paise, rel_tol=0, abs_tol=1e-7):
        fail(422, "Amount must have no more than two decimal places.", "VALIDATION_ERROR")
    try:
        response = httpx.post(
            f"{API_ROOT}/orders",
            auth=(key_id, key_secret),
            json={
                "amount": amount_paise,
                "currency": "INR",
                "receipt": uuid.uuid4().hex[:40],
                "notes": {"merchantId": str(user["_id"]), "demoMode": body.mode},
            },
            timeout=15,
        )
        response.raise_for_status()
        order = response.json()
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("Razorpay order creation failed (%s).", type(error).__name__)
        fail(502, "Razorpay could not create a checkout order.", "PAYMENT_PROVIDER_ERROR")
    order_id = order.get("id") if isinstance(order, dict) else None
    if (not isinstance(order_id, str) or not order_id.startswith("order_")
            or order.get("amount") != amount_paise or order.get("currency") != "INR"):
        fail(502, "Razorpay returned an invalid order.", "PAYMENT_PROVIDER_ERROR")
    now = datetime.now(timezone.utc)
    session_expires = now + timedelta(minutes=20)
    request.app.state.db.create_checkout({
        "razorpayOrderId": order_id,
        "merchantId": user["_id"],
        "amountPaise": amount_paise,
        "currency": "inr",
        "mode": body.mode,
        "paymentMode": availability["mode"],
        # Retain an order long enough for delayed provider webhook retries.
        "expiresAt": now + timedelta(days=90),
        "createdAt": now,
    })
    checkout_token = jwt.encode({
        "sub": str(user["_id"]),
        "type": "checkout",
        "aud": "fraud-checkout",
        "iss": "fraud-api",
        "iat": now,
        "order_id": order_id,
        "amount": amount_paise,
        "currency": "inr",
        "exp": session_expires,
    }, jwt_secret(), algorithm="HS256")
    query = urlencode({
        "order_id": order_id,
        "key_id": key_id,
        "amount": amount_paise,
        "currency": "INR",
        "session_token": checkout_token,
        "mode": availability["mode"],
    })
    return {"url": f"{os.getenv('CLIENT_URL', 'http://localhost:5173').rstrip('/')}/checkout?{query}"}


@app.post("/api/payments/verify")
def verify_payment(body: PaymentVerification, request: Request):
    try:
        session = jwt.decode(
            body.sessionToken, jwt_secret(), algorithms=["HS256"], audience="fraud-checkout",
            issuer="fraud-api", options={"require": ["exp", "iat", "sub", "type", "order_id", "amount", "currency"]},
        )
    except jwt.PyJWTError:
        fail(401, "Checkout session is invalid or expired.", "INVALID_CHECKOUT_SESSION")
    order_id = body.razorpay_order_id
    if session.get("type") != "checkout" or session.get("order_id") != order_id:
        fail(401, "Payment does not match the checkout session.", "INVALID_CHECKOUT_SESSION")
    checkout = request.app.state.db.get_checkout(order_id, merchant_id=session["sub"])
    if not checkout or checkout["expiresAt"] < datetime.now(timezone.utc):
        fail(410, "Checkout session has expired. Start a new payment.", "CHECKOUT_EXPIRED")
    if session.get("amount") != checkout["amountPaise"] or session.get("currency") != checkout["currency"]:
        fail(401, "Checkout session does not match its stored order.", "INVALID_CHECKOUT_SESSION")
    if not payment_signature_is_valid(order_id, body.razorpay_payment_id, body.razorpay_signature):
        fail(400, "Razorpay payment signature is invalid.", "INVALID_PAYMENT_SIGNATURE")
    try:
        response = httpx.get(
            f"{API_ROOT}/payments/{body.razorpay_payment_id}",
            auth=(os.getenv("RAZORPAY_KEY_ID", ""), os.getenv("RAZORPAY_KEY_SECRET", "")),
            timeout=15,
        )
        response.raise_for_status()
        payment = response.json()
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("Razorpay payment verification fetch failed (%s).", type(error).__name__)
        fail(502, "Could not confirm payment status with Razorpay.", "PAYMENT_PROVIDER_ERROR")
    if not isinstance(payment, dict) or payment.get("id") != body.razorpay_payment_id or payment.get("order_id") != order_id:
        fail(400, "Razorpay payment does not belong to this order.", "INVALID_PAYMENT")
    if payment.get("status") != "captured":
        fail(409, "Razorpay has not marked this payment captured yet.", "PAYMENT_NOT_CAPTURED")
    saved = resolve_captured_payment(request, payment)
    if not saved:
        fail(409, "Captured payment details did not match the checkout order.", "PAYMENT_MISMATCH")
    return {"transaction": serialize_transaction(saved)}


@app.post("/api/webhooks/razorpay")
async def razorpay_webhook(request: Request, signature: str | None = Header(default=None, alias="X-Razorpay-Signature")):
    secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    if not secret:
        fail(503, "Razorpay webhook secret is not configured.", "WEBHOOK_UNAVAILABLE")
    raw_body = await request.body()
    if len(raw_body) > 256_000:
        fail(413, "Webhook body is too large.", "PAYLOAD_TOO_LARGE")
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(expected.encode(), signature.encode()):
        fail(400, "Razorpay webhook signature is invalid.", "INVALID_WEBHOOK_SIGNATURE")
    try:
        event = json.loads(raw_body)
    except json.JSONDecodeError:
        fail(400, "Razorpay webhook body is invalid.", "INVALID_WEBHOOK")
    if not isinstance(event, dict):
        fail(400, "Razorpay webhook body must be an object.", "INVALID_WEBHOOK")
    if event.get("event") != "payment.captured":
        return {"received": True}
    try:
        payment = event["payload"]["payment"]["entity"]
    except (KeyError, TypeError):
        fail(400, "Razorpay webhook payment payload is invalid.", "INVALID_WEBHOOK")
    if not isinstance(payment, dict) or not isinstance(payment.get("id"), str) or not isinstance(payment.get("order_id"), str):
        fail(400, "Razorpay webhook payment payload is invalid.", "INVALID_WEBHOOK")
    digest = hashlib.sha256(raw_body).hexdigest()
    event_id = request.headers.get("x-razorpay-event-id") or digest
    if len(event_id) > 255 or not payment["id"] or not payment["order_id"]:
        fail(400, "Razorpay webhook identifiers are invalid.", "INVALID_WEBHOOK")
    try:
        receipt = await run_in_threadpool(
            request.app.state.db.record_webhook, event_id, event["event"], digest, payment_id=payment["id"],
        )
        if receipt["payloadDigest"] != digest:
            fail(409, "Webhook identifier was already used for a different payload.", "WEBHOOK_CONFLICT")
        if receipt["status"] == "completed":
            return {"received": True}
        saved = await run_in_threadpool(resolve_captured_payment, request, payment, event_id)
        if not saved:
            # Non-2xx causes provider retries. Do not silently acknowledge a
            # payment that has not been matched and durably recorded.
            fail(503, "Payment could not yet be matched to its stored order.", "PAYMENT_RECONCILIATION_REQUIRED")
        await run_in_threadpool(request.app.state.db.complete_webhook, event_id, transaction_id=saved["_id"])
    except HTTPException:
        raise
    except Exception as error:
        logger.error("Payment webhook persistence failed (%s).", type(error).__name__)
        fail(503, "Payment notification could not be saved. Please retry.", "WEBHOOK_RETRY")
    return {"received": True}


